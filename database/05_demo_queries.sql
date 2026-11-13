-- =====================================================================
--  Money Ghosts - important queries for the demonstration
--  Run after `npm run db:seed`:
--    docker exec -i moneyghosts-postgres psql -U moneyghosts -d moneyghosts < database/05_demo_queries.sql
--  Everything that changes data is inside BEGIN ... ROLLBACK, so the demo data stays intact.
-- =====================================================================
\pset pager off
\echo '=== Q1  JOIN + GROUP BY + ORDER BY: spend per account and category, last 3 months'
SELECT a.name AS account, c.name AS category, COUNT(*) AS txns, SUM(t.amount) AS total
FROM transactions t
JOIN accounts a   ON a.account_id = t.account_id
JOIN categories c ON c.category_id = t.category_id
WHERE t.txn_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '2 months'
GROUP BY a.name, c.name
ORDER BY a.name, total DESC
LIMIT 12;

\echo '=== Q2  GROUP BY + HAVING: merchants charged at least 10 times, average > 400'
SELECT merchant_key, COUNT(*) AS times, ROUND(AVG(amount), 2) AS avg_amount, SUM(amount) AS total
FROM transactions
WHERE merchant_key <> ''
GROUP BY merchant_key
HAVING COUNT(*) >= 10 AND AVG(amount) > 400
ORDER BY total DESC;

\echo '=== Q3  Subquery: transactions larger than the account average for their category'
SELECT t.txn_date, t.raw_description, t.amount, c.name AS category
FROM transactions t JOIN categories c USING (category_id)
WHERE t.account_id = 1
  AND t.amount > (SELECT 3 * AVG(t2.amount) FROM transactions t2
                  WHERE t2.account_id = t.account_id AND t2.category_id = t.category_id)
ORDER BY t.amount DESC
LIMIT 8;

\echo '=== Q4  Window functions (the core of leak detection): gaps between Netflix charges'
SELECT txn_date, amount,
       txn_date - LAG(txn_date) OVER w AS gap_days,
       amount   - LAG(amount)   OVER w AS price_change,
       SUM(amount) OVER (ORDER BY txn_date) AS running_total
FROM transactions
WHERE merchant_key = 'netflix'
WINDOW w AS (ORDER BY txn_date)
ORDER BY txn_date;

\echo '=== Q5  Stored function: run leak detection, then read the subscription_overview view'
SELECT detect_subscriptions(1) AS subscriptions_in_hdfc;
SELECT display_name, cadence, current_amount, previous_amount, last_pct_change, status, monthly_equivalent
FROM subscription_overview WHERE account_id IN (1, 2) ORDER BY status, monthly_equivalent DESC;

\echo '=== Q6  Recursive query: upcoming charges in the next 60 days'
SELECT * FROM forecast_charges(1, 60);

\echo '=== Q7  Views: monthly totals, financial deja vu, household duplicates, budgets'
SELECT * FROM subscription_cost_view ORDER BY account_id;
SELECT txn_date, raw_description, amount, prev_date FROM duplicate_charges;
SELECT display_name, account_id, other_account_id FROM household_duplicate_subscriptions;
SELECT category, monthly_limit, spent_this_month, pct_used, state FROM budget_status;

\echo '=== Q8  Vector similarity search (pgvector, cosine distance, HNSW index)'
\echo '    "Which transactions are most like Netflix?" - nearest neighbours of a Netflix row'
SELECT * FROM (
  SELECT DISTINCT ON (merchant_key) merchant_key,
         ROUND((1 - (embedding <=> (SELECT embedding FROM transactions WHERE merchant_key = 'netflix' LIMIT 1)))::numeric, 3) AS similarity
  FROM transactions ORDER BY merchant_key
) m ORDER BY similarity DESC LIMIT 8;
EXPLAIN (COSTS OFF)
SELECT txn_id FROM transactions
ORDER BY embedding <=> (SELECT embedding FROM transactions WHERE merchant_key = 'netflix' LIMIT 1)
LIMIT 5;

\echo '=== Q9  Full-text search (GIN index)'
SELECT txn_date, raw_description, amount
FROM transactions
WHERE to_tsvector('simple', raw_description) @@ plainto_tsquery('simple', 'gym')
ORDER BY txn_date DESC LIMIT 5;

\echo '=== Q10 Trigger demo: a price change is logged and flagged automatically'
BEGIN;
SELECT sub_id, display_name, current_amount, price_alert FROM subscriptions WHERE merchant_key = 'spotify' AND account_id = 1;
UPDATE subscriptions SET current_amount = 179 WHERE merchant_key = 'spotify' AND account_id = 1;
SELECT s.display_name, s.current_amount, s.price_alert, p.old_amount, p.new_amount, p.pct_change
FROM subscriptions s JOIN price_changes p USING (sub_id)
WHERE s.merchant_key = 'spotify' AND s.account_id = 1;
ROLLBACK;

\echo '=== Q11 Transaction demo: set_split is atomic - a bad split (ERROR below is expected) leaves the old one untouched'
BEGIN;
SELECT * FROM split_shares;
SAVEPOINT before_bad_split;
SELECT set_split((SELECT sub_id FROM subscriptions WHERE merchant_key='netflix'), (SELECT array_agg(user_id ORDER BY user_id) FROM users), ARRAY[80,30]::numeric[]);
ROLLBACK TO SAVEPOINT before_bad_split;
SELECT * FROM split_shares;   -- unchanged
SELECT set_split((SELECT sub_id FROM subscriptions WHERE merchant_key='netflix'), (SELECT array_agg(user_id ORDER BY user_id) FROM users), ARRAY[70,30]::numeric[]);
SELECT * FROM split_shares;   -- valid split replaced the old one
ROLLBACK;

\echo '=== Q12 Constraint demo: the database rejects invalid data (the 3 ERRORs below are expected)'
BEGIN;
SAVEPOINT a; INSERT INTO users (email, password_hash, full_name) VALUES ('x@y.dev', 'plaintext', 'XY');  ROLLBACK TO a;
SAVEPOINT b; INSERT INTO transactions (account_id, txn_date, raw_description, amount) VALUES (1, CURRENT_DATE, 'X', -10); ROLLBACK TO b;
SAVEPOINT c; INSERT INTO account_members VALUES (1, (SELECT owner_id FROM accounts WHERE account_id = 1), 'read_only'); ROLLBACK TO c;
ROLLBACK;

\echo '=== Q13 DML: INSERT / UPDATE / DELETE on budgets (rolled back)'
BEGIN;
INSERT INTO budgets (user_id, category_id, monthly_limit)
  SELECT 1, category_id, 3000 FROM categories WHERE name = 'Health & Fitness' RETURNING *;
UPDATE budgets SET monthly_limit = 3500 WHERE user_id = 1 AND category_id = (SELECT category_id FROM categories WHERE name = 'Health & Fitness') RETURNING budget_id, monthly_limit;
DELETE FROM budgets WHERE user_id = 1 AND category_id = (SELECT category_id FROM categories WHERE name = 'Health & Fitness') RETURNING budget_id;
ROLLBACK;

\echo '=== Q14 DDL: ALTER and DROP (rolled back)'
BEGIN;
ALTER TABLE budgets ADD COLUMN rollover BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE budgets RENAME COLUMN rollover TO carry_over;
ALTER TABLE budgets DROP COLUMN carry_over;
CREATE TABLE tmp_demo (id INT PRIMARY KEY);
DROP TABLE tmp_demo;
ROLLBACK;
