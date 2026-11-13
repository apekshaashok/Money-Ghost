# Data dictionary

Generated from the live PostgreSQL catalog by `scripts/gen-data-dictionary.mjs`.
Key: **PK** primary key · **FK** foreign key · **UK** unique · **GEN** generated column.

## users

Application users.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| user_id | integer | NOT NULL | `nextval('users_user_id_seq'::regclass)` | PK |
| email | citext | NOT NULL |  | UK |
| password_hash | text | NOT NULL |  |  |
| full_name | character varying(120) | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| last_login_at | timestamp with time zone | null |  |  |

**CHECK constraints**

- `users_email_format`: `CHECK ((email ~ '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$'::citext))`
- `users_full_name_check`: `CHECK ((length(TRIM(BOTH FROM full_name)) >= 2))`
- `users_password_is_bcrypt`: `CHECK ((password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'::text))`

## accounts

A bank account, credit card or wallet owned by one user.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| account_id | integer | NOT NULL | `nextval('accounts_account_id_seq'::regclass)` | PK |
| owner_id | integer | NOT NULL |  | FK → users, UK (owner_id, name) |
| name | character varying(80) | NOT NULL |  | UK (owner_id, name) |
| bank_name | character varying(80) | null |  |  |
| account_type | character varying(12) | NOT NULL | `'savings'::character varying` |  |
| currency | character(3) | NOT NULL | `'INR'::bpchar` |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**CHECK constraints**

- `accounts_account_type_check`: `CHECK (((account_type)::text = ANY ((ARRAY['savings'::character varying, 'current'::character varying, 'credit_card'::character varying, 'wallet'::character varying])::text[])))`
- `accounts_currency_check`: `CHECK ((currency ~ '^[A-Z]{3}$'::text))`
- `accounts_name_check`: `CHECK ((length(TRIM(BOTH FROM name)) > 0))`

## account_members

Shared/family access to another user's account (M:N between users and accounts).

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| account_id | integer | NOT NULL |  | FK → accounts, PK |
| user_id | integer | NOT NULL |  | FK → users, PK |
| access_level | character varying(12) | NOT NULL |  |  |
| added_at | timestamp with time zone | NOT NULL | `now()` |  |

**CHECK constraints**

- `account_members_access_level_check`: `CHECK (((access_level)::text = ANY ((ARRAY['read_only'::character varying, 'contributor'::character varying])::text[])))`

**Triggers**

- `account_member_not_owner`: BEFORE INSERT OR UPDATE ON public.account_members FOR EACH ROW EXECUTE FUNCTION trg_member_not_owner()

## categories

Spending categories.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| category_id | smallint | NOT NULL | `nextval('categories_category_id_seq'::regclass)` | PK |
| name | character varying(40) | NOT NULL |  | UK |
| description | text | NOT NULL |  |  |
| is_essential | boolean | NOT NULL | `false` |  |

## category_examples

Labelled example merchants with embeddings - the k-NN knowledge base for auto-categorisation.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| example_id | integer | NOT NULL | `nextval('category_examples_example_id_seq'::regclass)` | PK |
| category_id | smallint | NOT NULL |  | FK → categories |
| example_text | character varying(80) | NOT NULL |  | UK |
| embedding | vector(384) | null |  |  |

**CHECK constraints**

- `category_examples_example_text_check`: `CHECK ((length(TRIM(BOTH FROM example_text)) > 0))`

## imports

One row per uploaded statement file; links to the raw document in MongoDB.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| import_id | integer | NOT NULL | `nextval('imports_import_id_seq'::regclass)` | PK |
| account_id | integer | NOT NULL |  | FK → accounts, UK (account_id, file_hash) |
| user_id | integer | null |  | FK → users |
| filename | character varying(255) | NOT NULL |  |  |
| file_hash | character(64) | NOT NULL |  | UK (account_id, file_hash) |
| bank_profile | character varying(40) | NOT NULL |  |  |
| mongo_doc_id | character(24) | null |  |  |
| rows_total | integer | NOT NULL |  |  |
| rows_inserted | integer | NOT NULL | `0` |  |
| rows_skipped | integer | NOT NULL | `0` |  |
| imported_at | timestamp with time zone | NOT NULL | `now()` |  |

**CHECK constraints**

- `imports_file_hash_check`: `CHECK ((file_hash ~ '^[0-9a-f]{64}$'::text))`
- `imports_mongo_doc_id_check`: `CHECK ((mongo_doc_id ~ '^[0-9a-f]{24}$'::text))`
- `imports_row_counts`: `CHECK (((rows_inserted + rows_skipped) <= rows_total))`
- `imports_rows_inserted_check`: `CHECK ((rows_inserted >= 0))`
- `imports_rows_skipped_check`: `CHECK ((rows_skipped >= 0))`
- `imports_rows_total_check`: `CHECK ((rows_total >= 0))`

## transactions

Normalised debit transactions with merchant key, category and embedding.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| txn_id | bigint | NOT NULL | `nextval('transactions_txn_id_seq'::regclass)` | PK |
| account_id | integer | NOT NULL |  | FK → accounts, UK (account_id, txn_date, raw_description, amount) |
| import_id | integer | null |  | FK → imports |
| txn_date | date | NOT NULL |  | UK (account_id, txn_date, raw_description, amount) |
| raw_description | text | NOT NULL |  | UK (account_id, txn_date, raw_description, amount) |
| merchant_key | text | null | GEN: `normalize_merchant(raw_description)` |  |
| amount | positive_amount (domain) | NOT NULL |  | UK (account_id, txn_date, raw_description, amount) |
| category_id | smallint | null |  | FK → categories |
| embedding | vector(384) | null |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**CHECK constraints**

- `transactions_raw_description_check`: `CHECK (((length(TRIM(BOTH FROM raw_description)) >= 1) AND (length(TRIM(BOTH FROM raw_description)) <= 300)))`
- `transactions_txn_date_check`: `CHECK (((txn_date >= '2000-01-01'::date) AND (txn_date <= (CURRENT_DATE + 1))))`

**Triggers**

- `transaction_autocategorize`: BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION trg_txn_autocategorize()

## subscriptions

Recurring charges found by detect_subscriptions().

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| sub_id | integer | NOT NULL | `nextval('subscriptions_sub_id_seq'::regclass)` | PK |
| account_id | integer | NOT NULL |  | FK → accounts, UK (account_id, merchant_key) |
| merchant_key | text | NOT NULL |  | UK (account_id, merchant_key) |
| display_name | character varying(80) | NOT NULL | `'Unknown merchant'::character varying` |  |
| category_id | smallint | null |  | FK → categories |
| cadence | character varying(10) | NOT NULL |  |  |
| interval_days | smallint | NOT NULL |  |  |
| current_amount | positive_amount (domain) | NOT NULL |  |  |
| first_charge | date | NOT NULL |  |  |
| last_charge | date | NOT NULL |  |  |
| charge_count | integer | NOT NULL |  |  |
| status | character varying(10) | NOT NULL | `'active'::character varying` |  |
| price_alert | boolean | NOT NULL | `false` |  |
| detected_at | timestamp with time zone | NOT NULL | `now()` |  |

**CHECK constraints**

- `subs_dates_in_order`: `CHECK ((last_charge >= first_charge))`
- `subscriptions_cadence_check`: `CHECK (((cadence)::text = ANY ((ARRAY['weekly'::character varying, 'monthly'::character varying, 'quarterly'::character varying, 'yearly'::character varying])::text[])))`
- `subscriptions_charge_count_check`: `CHECK ((charge_count >= 2))`
- `subscriptions_interval_days_check`: `CHECK (((interval_days >= 5) AND (interval_days <= 400)))`
- `subscriptions_merchant_key_check`: `CHECK ((merchant_key <> ''::text))`
- `subscriptions_status_check`: `CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'dormant'::character varying])::text[])))`

**Triggers**

- `subscription_price_change`: BEFORE UPDATE OF current_amount ON public.subscriptions FOR EACH ROW WHEN (((old.current_amount)::numeric IS DISTINCT FROM (new.current_amount)::numeric)) EXECUTE FUNCTION trg_log_price_change()

## subscription_charges

Which transactions belong to which subscription.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| txn_id | bigint | NOT NULL |  | FK → transactions, PK |
| sub_id | integer | NOT NULL |  | FK → subscriptions |

## price_changes

Price history of subscriptions (trigger + detection).

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| change_id | integer | NOT NULL | `nextval('price_changes_change_id_seq'::regclass)` | PK |
| sub_id | integer | NOT NULL |  | FK → subscriptions, UK (sub_id, effective_date) |
| old_amount | positive_amount (domain) | NOT NULL |  |  |
| new_amount | positive_amount (domain) | NOT NULL |  |  |
| pct_change | numeric(7,2) | null | GEN: `round(((((new_amount)::numeric - (old_amount)::numeric) * 100.0) / (old_amount)::numeric), 2)` |  |
| effective_date | date | NOT NULL |  | UK (sub_id, effective_date) |
| detected_at | timestamp with time zone | NOT NULL | `now()` |  |

**CHECK constraints**

- `price_really_changed`: `CHECK (((old_amount)::numeric <> (new_amount)::numeric))`

## split_shares

Percentage of a subscription each household member pays.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| sub_id | integer | NOT NULL |  | FK → subscriptions, PK |
| user_id | integer | NOT NULL |  | FK → users, PK |
| share_percent | numeric(5,2) | NOT NULL |  |  |

**CHECK constraints**

- `split_shares_share_percent_check`: `CHECK (((share_percent > (0)::numeric) AND (share_percent <= (100)::numeric)))`

**Triggers**

- `split_share_needs_access`: BEFORE INSERT OR UPDATE ON public.split_shares FOR EACH ROW EXECUTE FUNCTION trg_split_needs_access()

## budgets

Monthly spending limit per user and category.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| budget_id | integer | NOT NULL | `nextval('budgets_budget_id_seq'::regclass)` | PK |
| user_id | integer | NOT NULL |  | FK → users, UK (user_id, category_id) |
| category_id | smallint | NOT NULL |  | FK → categories, UK (user_id, category_id) |
| monthly_limit | positive_amount (domain) | NOT NULL |  |  |

## Indexes

| Table | Index | Definition |
|---|---|---|
| account_members | account_members_pkey | `UNIQUE USING btree (account_id, user_id)` |
| account_members | idx_members_user | `USING btree (user_id)` |
| accounts | accounts_pkey | `UNIQUE USING btree (account_id)` |
| accounts | accounts_unique_name_per_owner | `UNIQUE USING btree (owner_id, name)` |
| accounts | idx_accounts_owner | `USING btree (owner_id)` |
| budgets | budget_once_per_category | `UNIQUE USING btree (user_id, category_id)` |
| budgets | budgets_pkey | `UNIQUE USING btree (budget_id)` |
| categories | categories_name_key | `UNIQUE USING btree (name)` |
| categories | categories_pkey | `UNIQUE USING btree (category_id)` |
| category_examples | category_examples_example_text_key | `UNIQUE USING btree (example_text)` |
| category_examples | category_examples_pkey | `UNIQUE USING btree (example_id)` |
| category_examples | idx_example_embedding | `USING hnsw (embedding vector_cosine_ops)` |
| imports | imports_pkey | `UNIQUE USING btree (import_id)` |
| imports | imports_same_file_once | `UNIQUE USING btree (account_id, file_hash)` |
| price_changes | idx_price_changes_sub | `USING btree (sub_id, effective_date DESC)` |
| price_changes | price_change_once_per_day | `UNIQUE USING btree (sub_id, effective_date)` |
| price_changes | price_changes_pkey | `UNIQUE USING btree (change_id)` |
| split_shares | split_shares_pkey | `UNIQUE USING btree (sub_id, user_id)` |
| subscription_charges | idx_subcharges_sub | `USING btree (sub_id)` |
| subscription_charges | subscription_charges_pkey | `UNIQUE USING btree (txn_id)` |
| subscriptions | idx_subs_active | `USING btree (account_id, current_amount DESC) WHERE ((status)::text = 'active'::text)` |
| subscriptions | idx_subs_merchant | `USING btree (merchant_key)` |
| subscriptions | subs_one_per_merchant | `UNIQUE USING btree (account_id, merchant_key)` |
| subscriptions | subscriptions_pkey | `UNIQUE USING btree (sub_id)` |
| transactions | idx_txn_account_date | `USING btree (account_id, txn_date DESC)` |
| transactions | idx_txn_account_merchant | `USING btree (account_id, merchant_key, txn_date)` |
| transactions | idx_txn_category | `USING btree (category_id)` |
| transactions | idx_txn_embedding_hnsw | `USING hnsw (embedding vector_cosine_ops)` |
| transactions | idx_txn_fts | `USING gin (to_tsvector('simple'::regconfig, raw_description))` |
| transactions | idx_txn_import | `USING btree (import_id)` |
| transactions | idx_txn_merchant_trgm | `USING gin (merchant_key gin_trgm_ops)` |
| transactions | transactions_pkey | `UNIQUE USING btree (txn_id)` |
| transactions | txn_no_duplicate | `UNIQUE USING btree (account_id, txn_date, raw_description, amount)` |
| users | users_email_key | `UNIQUE USING btree (email)` |
| users | users_pkey | `UNIQUE USING btree (user_id)` |

## Views

- `budget_status`
- `category_monthly_spend`
- `duplicate_charges`
- `household_duplicate_subscriptions`
- `monthly_summary`
- `subscription_cost_view`
- `subscription_overview`
- `user_accounts`

## Functions, procedures and trigger functions

| Name | Kind | Arguments | Returns |
|---|---|---|---|
| detect_subscriptions | function | p_account integer | integer |
| forecast_charges | function | p_account integer, p_days integer DEFAULT 30 | TABLE(sub_id integer, display_name character varying, due_date date, amount numeric) |
| next_due | function | p_from date, p_cadence text | date |
| normalize_merchant | function | t text | text |
| set_split | function | p_sub integer, p_users integer[], p_percents numeric[] | integer |
| trg_log_price_change | function | — | trigger |
| trg_member_not_owner | function | — | trigger |
| trg_split_needs_access | function | — | trigger |
| trg_txn_autocategorize | function | — | trigger |
| user_access_level | function | p_user integer, p_account integer | text |
