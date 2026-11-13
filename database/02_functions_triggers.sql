-- =====================================================================
--  Money Ghosts - functions and triggers
-- =====================================================================

-- Access control helper: 'owner' | 'contributor' | 'read_only' | NULL (no access).
-- Every API route asks the database who may see / change an account.
CREATE OR REPLACE FUNCTION user_access_level(p_user INT, p_account INT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM accounts WHERE account_id = p_account AND owner_id = p_user) THEN 'owner'
           ELSE (SELECT access_level FROM account_members WHERE account_id = p_account AND user_id = p_user)
         END;
$$;

-- Next expected charge date for a cadence (monthly = +1 calendar month).
CREATE OR REPLACE FUNCTION next_due(p_from DATE, p_cadence TEXT) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from + CASE p_cadence
                     WHEN 'weekly'    THEN INTERVAL '7 days'
                     WHEN 'monthly'   THEN INTERVAL '1 month'
                     WHEN 'quarterly' THEN INTERVAL '3 months'
                     ELSE                  INTERVAL '1 year'
                   END)::date;
$$;

-- =====================================================================
--  TRIGGERS
-- =====================================================================

-- T1. Price creep: when a subscription's amount changes, log it and raise an alert.
CREATE OR REPLACE FUNCTION trg_log_price_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO price_changes (sub_id, old_amount, new_amount, effective_date)
  VALUES (OLD.sub_id, OLD.current_amount, NEW.current_amount,
          CASE WHEN NEW.last_charge > OLD.last_charge THEN NEW.last_charge ELSE CURRENT_DATE END)
  ON CONFLICT (sub_id, effective_date) DO NOTHING;
  IF NEW.current_amount > OLD.current_amount THEN
    NEW.price_alert := true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER subscription_price_change
BEFORE UPDATE OF current_amount ON subscriptions
FOR EACH ROW WHEN (OLD.current_amount IS DISTINCT FROM NEW.current_amount)
EXECUTE FUNCTION trg_log_price_change();

-- T2. The owner of an account cannot also be added as a "member" of it.
CREATE OR REPLACE FUNCTION trg_member_not_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE account_id = NEW.account_id AND owner_id = NEW.user_id) THEN
    RAISE EXCEPTION 'This person already owns the account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_member_not_owner
BEFORE INSERT OR UPDATE ON account_members
FOR EACH ROW EXECUTE FUNCTION trg_member_not_owner();

-- T3. Only people who can see the account can be part of a cost split.
CREATE OR REPLACE FUNCTION trg_split_needs_access() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_account INT;
BEGIN
  SELECT account_id INTO v_account FROM subscriptions WHERE sub_id = NEW.sub_id;
  IF user_access_level(NEW.user_id, v_account) IS NULL THEN
    RAISE EXCEPTION 'User % has no access to this account, so cannot share its cost', NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER split_share_needs_access
BEFORE INSERT OR UPDATE ON split_shares
FOR EACH ROW EXECUTE FUNCTION trg_split_needs_access();

-- T4. Auto-categorisation by vector similarity: a new transaction takes the category of the
--     nearest labelled example merchant (cosine distance). Far from everything -> 'Other'.
CREATE OR REPLACE FUNCTION trg_txn_autocategorize() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_cat SMALLINT; v_sim FLOAT;
BEGIN
  IF NEW.embedding IS NULL OR NEW.category_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT e.category_id, 1 - (e.embedding <=> NEW.embedding) INTO v_cat, v_sim
  FROM category_examples e WHERE e.embedding IS NOT NULL
  ORDER BY e.embedding <=> NEW.embedding
  LIMIT 1;
  IF v_sim IS NULL OR v_sim < 0.40 THEN
    SELECT category_id INTO v_cat FROM categories WHERE name = 'Other';
  END IF;
  NEW.category_id := v_cat;
  RETURN NEW;
END $$;

CREATE TRIGGER transaction_autocategorize
BEFORE INSERT ON transactions
FOR EACH ROW EXECUTE FUNCTION trg_txn_autocategorize();

-- =====================================================================
--  STORED FUNCTION: leak-detection engine
--  detect_subscriptions(account) -> number of subscriptions found in the account
-- =====================================================================
CREATE OR REPLACE FUNCTION detect_subscriptions(p_account INT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  -- Step 1: find recurring clusters with window functions.
  --   LAG() gives the gap (days) between consecutive charges of the same merchant.
  --   A cluster is "recurring" when the average gap matches a cadence, the gaps are
  --   regular (small standard deviation) and the amount takes only a few values.
  DROP TABLE IF EXISTS _clusters;
  CREATE TEMP TABLE _clusters ON COMMIT DROP AS
  WITH gaps AS (
    SELECT merchant_key, txn_date, amount, category_id,
           txn_date - LAG(txn_date) OVER w AS gap
    FROM transactions
    WHERE account_id = p_account AND merchant_key <> ''
    WINDOW w AS (PARTITION BY merchant_key ORDER BY txn_date)
  ), stats AS (
    SELECT merchant_key,
           COUNT(*)                                      AS cnt,
           AVG(gap)                                      AS avg_gap,
           COALESCE(STDDEV_SAMP(gap), 0)                 AS sd_gap,
           MIN(txn_date)                                 AS first_d,
           MAX(txn_date)                                 AS last_d,
           (ARRAY_AGG(amount ORDER BY txn_date DESC))[1] AS latest_amt,
           COUNT(DISTINCT amount)                        AS n_amounts,
           MODE() WITHIN GROUP (ORDER BY category_id)    AS category_id
    FROM gaps
    GROUP BY merchant_key
  ), classified AS (
    SELECT s.*,
           CASE WHEN avg_gap BETWEEN 6   AND 8   THEN 'weekly'
                WHEN avg_gap BETWEEN 26  AND 35  THEN 'monthly'
                WHEN avg_gap BETWEEN 85  AND 95  THEN 'quarterly'
                WHEN avg_gap BETWEEN 350 AND 380 THEN 'yearly'
           END AS cadence
    FROM stats s
  )
  SELECT * FROM classified
  WHERE cadence IS NOT NULL
    AND sd_gap <= GREATEST(3, avg_gap * 0.12)
    AND cnt >= CASE WHEN cadence = 'yearly' THEN 2 ELSE 3 END
    AND n_amounts <= GREATEST(2, cnt / 3);

  -- Step 2: forget subscriptions whose charges have disappeared.
  DELETE FROM subscriptions s
  WHERE s.account_id = p_account
    AND NOT EXISTS (SELECT 1 FROM _clusters c WHERE c.merchant_key = s.merchant_key);

  -- Step 3: upsert. An UPDATE that changes current_amount fires trigger T1 (price creep).
  --         'dormant' = the next expected charge is overdue by more than a grace period.
  INSERT INTO subscriptions AS s
        (account_id, merchant_key, display_name, category_id, cadence, interval_days,
         current_amount, first_charge, last_charge, charge_count, status)
  SELECT p_account, c.merchant_key, left(initcap(c.merchant_key), 80), c.category_id, c.cadence,
         ROUND(c.avg_gap)::smallint, c.latest_amt, c.first_d, c.last_d, c.cnt,
         CASE WHEN next_due(c.last_d, c.cadence) < CURRENT_DATE - GREATEST(7, ROUND(c.avg_gap * 0.5)::int)
              THEN 'dormant' ELSE 'active' END
  FROM _clusters c
  ON CONFLICT (account_id, merchant_key) DO UPDATE SET
       current_amount = EXCLUDED.current_amount,
       cadence        = EXCLUDED.cadence,
       interval_days  = EXCLUDED.interval_days,
       first_charge   = EXCLUDED.first_charge,
       last_charge    = EXCLUDED.last_charge,
       charge_count   = EXCLUDED.charge_count,
       category_id    = COALESCE(s.category_id, EXCLUDED.category_id),
       status         = EXCLUDED.status;

  -- Step 4: link every charge to its subscription.
  INSERT INTO subscription_charges (sub_id, txn_id)
  SELECT s.sub_id, t.txn_id
  FROM subscriptions s
  JOIN transactions t ON t.account_id = s.account_id AND t.merchant_key = s.merchant_key
  WHERE s.account_id = p_account
  ON CONFLICT (txn_id) DO UPDATE SET sub_id = EXCLUDED.sub_id;

  -- Step 5: price history from the charges themselves (LAG over amount),
  --         so a price rise inside a single imported file is also caught.
  INSERT INTO price_changes (sub_id, old_amount, new_amount, effective_date)
  SELECT sub_id, prev_amount, amount, txn_date
  FROM (
    SELECT sc.sub_id, t.amount, t.txn_date,
           LAG(t.amount) OVER (PARTITION BY sc.sub_id ORDER BY t.txn_date) AS prev_amount
    FROM subscription_charges sc
    JOIN transactions  t USING (txn_id)
    JOIN subscriptions s USING (sub_id)
    WHERE s.account_id = p_account
  ) history
  WHERE prev_amount IS NOT NULL AND prev_amount <> amount
  ON CONFLICT (sub_id, effective_date) DO NOTHING;

  -- Step 6: alert flag = the price has gone up at some point.
  UPDATE subscriptions s
  SET price_alert = EXISTS (SELECT 1 FROM price_changes p WHERE p.sub_id = s.sub_id AND p.new_amount > p.old_amount)
  WHERE s.account_id = p_account;

  SELECT COUNT(*) INTO n FROM subscriptions WHERE account_id = p_account;
  RETURN n;
END $$;

-- =====================================================================
--  RECURSIVE QUERY: upcoming charges for the next N days
-- =====================================================================
CREATE OR REPLACE FUNCTION forecast_charges(p_account INT, p_days INT DEFAULT 30)
RETURNS TABLE (sub_id INT, display_name VARCHAR, due_date DATE, amount NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE schedule AS (
    SELECT s.sub_id, s.display_name, s.cadence,
           next_due(s.last_charge, s.cadence) AS due_date,
           s.current_amount::numeric          AS amount
    FROM subscriptions s
    WHERE s.account_id = p_account AND s.status = 'active'
    UNION ALL
    SELECT sc.sub_id, sc.display_name, sc.cadence, next_due(sc.due_date, sc.cadence), sc.amount
    FROM schedule sc
    WHERE next_due(sc.due_date, sc.cadence) <= CURRENT_DATE + p_days
  )
  SELECT sub_id, display_name, due_date, amount
  FROM schedule
  WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + p_days
  ORDER BY due_date, display_name;
$$;

-- =====================================================================
--  TRANSACTION: replace the cost split of a subscription - all or nothing.
--  A bad total, or a user without access (trigger T3), rolls the whole call back.
-- =====================================================================
CREATE OR REPLACE FUNCTION set_split(p_sub INT, p_users INT[], p_percents NUMERIC[]) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_total NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE sub_id = p_sub) THEN
    RAISE EXCEPTION 'Subscription % not found', p_sub;
  END IF;
  IF COALESCE(array_length(p_users, 1), 0) = 0 THEN        -- empty list = remove the split
    DELETE FROM split_shares WHERE sub_id = p_sub;
    RETURN 0;
  END IF;
  IF array_length(p_users, 1) <> COALESCE(array_length(p_percents, 1), 0) THEN
    RAISE EXCEPTION 'Each person needs exactly one share';
  END IF;
  SELECT SUM(x) INTO v_total FROM unnest(p_percents) x;
  IF v_total <> 100 THEN
    RAISE EXCEPTION 'Shares must add up to 100 percent (they add up to %)', v_total;
  END IF;

  DELETE FROM split_shares WHERE sub_id = p_sub;
  INSERT INTO split_shares (sub_id, user_id, share_percent)
  SELECT p_sub, t.u, t.p FROM unnest(p_users, p_percents) AS t(u, p);
  RETURN array_length(p_users, 1);
END $$;
