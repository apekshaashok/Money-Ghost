-- =====================================================================
--  Money Ghosts - views
-- =====================================================================

-- Who can see which account, and how (owner / contributor / read_only).
CREATE OR REPLACE VIEW user_accounts AS
  SELECT a.owner_id AS user_id, a.account_id, 'owner'::text AS access_level FROM accounts a
  UNION ALL
  SELECT m.user_id, m.account_id, m.access_level FROM account_members m;

-- Monthly spend per account.
CREATE OR REPLACE VIEW monthly_summary AS
  SELECT account_id,
         date_trunc('month', txn_date)::date AS month,
         SUM(amount)                         AS total_spend,
         COUNT(*)                            AS txn_count
  FROM transactions
  GROUP BY account_id, date_trunc('month', txn_date);

-- Monthly spend per account and category (category roll-up).
CREATE OR REPLACE VIEW category_monthly_spend AS
  SELECT t.account_id,
         date_trunc('month', t.txn_date)::date AS month,
         COALESCE(c.name, 'Uncategorised')     AS category,
         SUM(t.amount)                         AS total_spend,
         COUNT(*)                              AS txn_count
  FROM transactions t
  LEFT JOIN categories c USING (category_id)
  GROUP BY t.account_id, date_trunc('month', t.txn_date), COALESCE(c.name, 'Uncategorised');

-- Subscriptions with category, monthly-equivalent cost and the latest price change.
CREATE OR REPLACE VIEW subscription_overview AS
  SELECT s.sub_id, s.account_id, s.merchant_key, s.display_name, s.cadence,
         s.current_amount, s.first_charge, s.last_charge, s.charge_count, s.status, s.price_alert,
         c.name AS category,
         ROUND(s.current_amount * CASE s.cadence WHEN 'weekly' THEN 52.0/12 WHEN 'monthly' THEN 1
                                                 WHEN 'quarterly' THEN 1.0/3 ELSE 1.0/12 END, 2) AS monthly_equivalent,
         pc.old_amount AS previous_amount, pc.pct_change AS last_pct_change, pc.effective_date AS price_changed_on
  FROM subscriptions s
  LEFT JOIN categories c USING (category_id)
  LEFT JOIN LATERAL (SELECT old_amount, pct_change, effective_date
                     FROM price_changes p WHERE p.sub_id = s.sub_id
                     ORDER BY effective_date DESC LIMIT 1) pc ON true;

-- Monthly / yearly cost of active subscriptions, per account.
CREATE OR REPLACE VIEW subscription_cost_view AS
  SELECT account_id,
         COUNT(*)                               AS active_subscriptions,
         SUM(monthly_equivalent)                AS monthly_total,
         ROUND(SUM(monthly_equivalent) * 12, 2) AS yearly_total
  FROM subscription_overview
  WHERE status = 'active'
  GROUP BY account_id;

-- "Financial deja vu": same merchant, same amount, twice within 2 days
-- (for amounts of 1000+ or for a known subscription).
CREATE OR REPLACE VIEW duplicate_charges AS
  SELECT txn_id, account_id, txn_date, raw_description, amount, merchant_key, prev_date
  FROM (
    SELECT t.txn_id, t.account_id, t.txn_date, t.raw_description, t.amount, t.merchant_key,
           LAG(t.txn_id)   OVER w AS prev_txn_id,
           LAG(t.txn_date) OVER w AS prev_date
    FROM transactions t
    WINDOW w AS (PARTITION BY t.account_id, t.merchant_key, t.amount ORDER BY t.txn_date, t.txn_id)
  ) x
  WHERE prev_txn_id IS NOT NULL
    AND merchant_key <> ''
    AND txn_date - prev_date <= 2
    AND (amount >= 1000 OR EXISTS (SELECT 1 FROM subscriptions s
                                   WHERE s.account_id = x.account_id AND s.merchant_key = x.merchant_key));

-- The same service paid for in two different accounts (self-join on merchant).
CREATE OR REPLACE VIEW household_duplicate_subscriptions AS
  SELECT a.sub_id, a.account_id, b.sub_id AS other_sub_id, b.account_id AS other_account_id,
         a.display_name, a.current_amount, b.current_amount AS other_amount
  FROM subscriptions a
  JOIN subscriptions b ON a.merchant_key = b.merchant_key AND a.account_id < b.account_id
  WHERE a.status = 'active' AND b.status = 'active';

-- Budget vs this month's spend in the user's own accounts.
CREATE OR REPLACE VIEW budget_status AS
  SELECT b.budget_id, b.user_id, b.category_id, c.name AS category, b.monthly_limit,
         COALESCE(sp.spent, 0) AS spent_this_month,
         ROUND(COALESCE(sp.spent, 0) * 100 / b.monthly_limit, 1) AS pct_used,
         CASE WHEN COALESCE(sp.spent, 0) > b.monthly_limit THEN 'over' ELSE 'ok' END AS state
  FROM budgets b
  JOIN categories c USING (category_id)
  LEFT JOIN LATERAL (
    SELECT SUM(t.amount) AS spent
    FROM transactions t JOIN accounts a USING (account_id)
    WHERE a.owner_id = b.user_id AND t.category_id = b.category_id
      AND t.txn_date >= date_trunc('month', CURRENT_DATE)
  ) sp ON true;
