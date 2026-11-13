-- =====================================================================
--  Money Ghosts - PostgreSQL schema (DDL)
--  Run order: 01_schema.sql -> 02_functions_triggers.sql -> 03_views.sql
--             -> 04_reference_data.sql      (npm run db:setup does this)
--  The file is re-runnable: it DROPs the old objects first.
-- =====================================================================

-- ---------- DROP (clean re-run) ----------
DROP MATERIALIZED VIEW IF EXISTS mv_merchant_popularity CASCADE;
DROP TABLE IF EXISTS settlements, split_shares, price_changes, subscription_charges,
                     subscriptions, budgets, transactions, imports, category_examples, categories,
                     account_members, accounts, users CASCADE;
DROP DOMAIN   IF EXISTS positive_amount CASCADE;
DROP FUNCTION IF EXISTS normalize_merchant(TEXT) CASCADE;
-- routines from earlier versions of the project
DROP FUNCTION  IF EXISTS generate_settlements(INT, DATE) CASCADE;
DROP PROCEDURE IF EXISTS settle_payment(INT, INT) CASCADE;

-- ---------- Extensions ----------
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector: embeddings + similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram index for fuzzy merchant filter
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive e-mail addresses

-- ---------- Domain: every money value in the system is > 0 ----------
CREATE DOMAIN positive_amount AS NUMERIC(12,2) CHECK (VALUE > 0);

-- ---------- Merchant normaliser ----------
-- Bank descriptions are noisy: "SQ *COFFEE4821", "SPOTIFY P1A2B", "UPI/SWIGGY/98765/PAYMENT".
-- This turns them into a stable merchant key ("coffee", "spotify", "swiggy") so that
-- repeated charges from the same merchant group together.
--   1. lower-case and split on anything that is not a letter or digit
--   2. strip leading/trailing digits from each token  (COFFEE4821 -> coffee)
--   3. drop tokens that still contain digits (P1A2B), short codes that had digits (KZCJ3),
--      card masks (xxxx), 1-letter tokens
--      and payment-rail noise words (upi, pos, com, payment ...)
--   4. keep the first three remaining tokens
CREATE FUNCTION normalize_merchant(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(string_agg(tok, ' ' ORDER BY ord), '')
  FROM (
    SELECT tok, ord, row_number() OVER (ORDER BY ord) AS rn
    FROM (
      SELECT regexp_replace(w, '^[0-9]+|[0-9]+$', '', 'g') AS tok, (w ~ '[0-9]') AS had_digit, ord
      FROM regexp_split_to_table(lower(t), '[^a-z0-9]+') WITH ORDINALITY AS s(w, ord)
    ) cleaned
    WHERE length(tok) >= 2
      AND tok !~ '[0-9]'
      AND NOT (had_digit AND length(tok) <= 4)
      AND tok !~ '^x+$'
      AND tok NOT IN ('com','www','in','co','net','org','pos','upi','ach','nach','ecs','sq','tst',
                      'payment','pay','purchase','debit','credit','card','ref','txn','inr','bill',
                      'autopay','online','india','pvt','ltd','si','mandate','imps','neft','rtgs',
                      'from','to','by','via','ok','dr','cr','recurring','charge','subscription')
  ) kept
  WHERE rn <= 3;
$$;

-- =====================================================================
--  TABLES
-- =====================================================================

-- Application users.
CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  email          CITEXT NOT NULL UNIQUE
                 CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$'),
  -- Only a bcrypt hash can ever be stored here: plain-text passwords are rejected by the DB.
  password_hash  TEXT NOT NULL
                 CONSTRAINT users_password_is_bcrypt CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'),
  full_name      VARCHAR(120) NOT NULL CHECK (length(trim(full_name)) >= 2),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- A bank account / credit card / wallet owned by one user.
CREATE TABLE accounts (
  account_id    SERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name          VARCHAR(80) NOT NULL CHECK (length(trim(name)) > 0),
  bank_name     VARCHAR(80),
  account_type  VARCHAR(12) NOT NULL DEFAULT 'savings'
                CHECK (account_type IN ('savings','current','credit_card','wallet')),
  currency      CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT accounts_unique_name_per_owner UNIQUE (owner_id, name)
);

-- Shared / family access to someone else's account (M:N users <-> accounts).
CREATE TABLE account_members (
  account_id    INT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
  access_level  VARCHAR(12) NOT NULL CHECK (access_level IN ('read_only','contributor')),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

-- Spending categories.
CREATE TABLE categories (
  category_id   SMALLSERIAL PRIMARY KEY,
  name          VARCHAR(40) NOT NULL UNIQUE,
  description   TEXT NOT NULL,
  is_essential  BOOLEAN NOT NULL DEFAULT false
);

-- Labelled example merchants per category ("knowledge base"). Each example is embedded;
-- a new transaction takes the category of its nearest example (k-NN, cosine distance).
CREATE TABLE category_examples (
  example_id    SERIAL PRIMARY KEY,
  category_id   SMALLINT NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
  example_text  VARCHAR(80) NOT NULL UNIQUE CHECK (length(trim(example_text)) > 0),
  embedding     vector(384)
);

-- One row per uploaded statement file. The full raw file lives in MongoDB (mongo_doc_id).
CREATE TABLE imports (
  import_id      SERIAL PRIMARY KEY,
  account_id     INT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  user_id        INT REFERENCES users(user_id) ON DELETE SET NULL,
  filename       VARCHAR(255) NOT NULL,
  file_hash      CHAR(64) NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of the file
  bank_profile   VARCHAR(40) NOT NULL,
  mongo_doc_id   CHAR(24) CHECK (mongo_doc_id ~ '^[0-9a-f]{24}$'),
  rows_total     INT NOT NULL CHECK (rows_total >= 0),
  rows_inserted  INT NOT NULL DEFAULT 0 CHECK (rows_inserted >= 0),
  rows_skipped   INT NOT NULL DEFAULT 0 CHECK (rows_skipped  >= 0),
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT imports_same_file_once UNIQUE (account_id, file_hash),
  CONSTRAINT imports_row_counts CHECK (rows_inserted + rows_skipped <= rows_total)
);

-- Normalised debit transactions (credits/refunds are skipped at import).
CREATE TABLE transactions (
  txn_id           BIGSERIAL PRIMARY KEY,
  account_id       INT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  import_id        INT REFERENCES imports(import_id) ON DELETE CASCADE,   -- undo an import = delete it
  txn_date         DATE NOT NULL CHECK (txn_date BETWEEN DATE '2000-01-01' AND CURRENT_DATE + 1),
  raw_description  TEXT NOT NULL CHECK (length(trim(raw_description)) BETWEEN 1 AND 300),
  merchant_key     TEXT GENERATED ALWAYS AS (normalize_merchant(raw_description)) STORED,
  amount           positive_amount NOT NULL,
  category_id      SMALLINT REFERENCES categories(category_id) ON DELETE SET NULL,
  embedding        vector(384),                         -- all-MiniLM-L6-v2 embedding of the merchant text
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT txn_no_duplicate UNIQUE (account_id, txn_date, raw_description, amount)
);

-- A detected recurring charge (cluster of transactions with the same merchant + regular gap).
CREATE TABLE subscriptions (
  sub_id          SERIAL PRIMARY KEY,
  account_id      INT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  merchant_key    TEXT NOT NULL CHECK (merchant_key <> ''),
  display_name    VARCHAR(80) NOT NULL,
  category_id     SMALLINT REFERENCES categories(category_id) ON DELETE SET NULL,
  cadence         VARCHAR(10) NOT NULL CHECK (cadence IN ('weekly','monthly','quarterly','yearly')),
  interval_days   SMALLINT NOT NULL CHECK (interval_days BETWEEN 5 AND 400),
  current_amount  positive_amount NOT NULL,
  first_charge    DATE NOT NULL,
  last_charge     DATE NOT NULL,
  charge_count    INT NOT NULL CHECK (charge_count >= 2),
  -- active: still charging      dormant: the expected charge did not come (stopped / forgotten?)
  status          VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','dormant')),
  price_alert     BOOLEAN NOT NULL DEFAULT false,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subs_one_per_merchant UNIQUE (account_id, merchant_key),
  CONSTRAINT subs_dates_in_order   CHECK (last_charge >= first_charge)
);

-- Which transactions belong to which subscription (1 subscription : N transactions).
CREATE TABLE subscription_charges (
  txn_id  BIGINT PRIMARY KEY REFERENCES transactions(txn_id) ON DELETE CASCADE,
  sub_id  INT NOT NULL REFERENCES subscriptions(sub_id) ON DELETE CASCADE
);

-- Price history of a subscription (filled by trigger + by detect_subscriptions()).
CREATE TABLE price_changes (
  change_id       SERIAL PRIMARY KEY,
  sub_id          INT NOT NULL REFERENCES subscriptions(sub_id) ON DELETE CASCADE,
  old_amount      positive_amount NOT NULL,
  new_amount      positive_amount NOT NULL,
  pct_change      NUMERIC(7,2) GENERATED ALWAYS AS (ROUND((new_amount - old_amount) * 100.0 / old_amount, 2)) STORED,
  effective_date  DATE NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT price_change_once_per_day UNIQUE (sub_id, effective_date),
  CONSTRAINT price_really_changed CHECK (old_amount <> new_amount)
);

-- How a shared subscription's cost is split between household members.
CREATE TABLE split_shares (
  sub_id         INT NOT NULL REFERENCES subscriptions(sub_id) ON DELETE CASCADE,
  user_id        INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  share_percent  NUMERIC(5,2) NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),
  PRIMARY KEY (sub_id, user_id)
);

-- Monthly budget per user and category.
CREATE TABLE budgets (
  budget_id      SERIAL PRIMARY KEY,
  user_id        INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id    SMALLINT NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
  monthly_limit  positive_amount NOT NULL,
  CONSTRAINT budget_once_per_category UNIQUE (user_id, category_id)
);

-- =====================================================================
--  ALTER / DROP demonstrations (schema evolution)
-- =====================================================================
ALTER TABLE accounts     ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE subscriptions ALTER COLUMN display_name SET DEFAULT 'Unknown merchant';

-- A staging table that an earlier design used, created and then dropped again.
CREATE TABLE import_staging_old (line_no INT, raw_line TEXT);
DROP TABLE import_staging_old;

-- =====================================================================
--  INDEXES
-- =====================================================================
-- B-tree: the most common filter is "this account, this date range"
CREATE INDEX idx_txn_account_date     ON transactions (account_id, txn_date DESC);
-- B-tree: leak detection partitions by merchant inside an account
CREATE INDEX idx_txn_account_merchant ON transactions (account_id, merchant_key, txn_date);
CREATE INDEX idx_txn_category         ON transactions (category_id);
CREATE INDEX idx_txn_import           ON transactions (import_id);
-- HNSW (pgvector): approximate nearest-neighbour search with cosine distance
CREATE INDEX idx_txn_embedding_hnsw   ON transactions USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_example_embedding    ON category_examples USING hnsw (embedding vector_cosine_ops);
-- GIN full-text index for keyword search over descriptions
CREATE INDEX idx_txn_fts              ON transactions USING gin (to_tsvector('simple', raw_description));
-- GIN trigram index for "merchant contains ..." filters (ILIKE '%net%')
CREATE INDEX idx_txn_merchant_trgm    ON transactions USING gin (merchant_key gin_trgm_ops);
-- Partial index: dashboards only ever look at live subscriptions
CREATE INDEX idx_subs_active          ON subscriptions (account_id, current_amount DESC)
                                       WHERE status = 'active';
CREATE INDEX idx_subs_merchant        ON subscriptions (merchant_key);
CREATE INDEX idx_subcharges_sub       ON subscription_charges (sub_id);
CREATE INDEX idx_price_changes_sub    ON price_changes (sub_id, effective_date DESC);
CREATE INDEX idx_members_user         ON account_members (user_id);
CREATE INDEX idx_accounts_owner       ON accounts (owner_id);
