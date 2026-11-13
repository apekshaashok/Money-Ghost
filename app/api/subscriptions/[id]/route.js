import { pool } from '../../../../lib/db.js';
import { route, loadSubscription } from '../../../../lib/api.js';

// GET /api/subscriptions/:id -> details, charges, price history, split, people who can share it
export const GET = route(async ({ params, session }) => {
  const sub = await loadSubscription(session, params.id);
  const q = (sql) => pool.query(sql, [sub.sub_id]).then((r) => r.rows);
  const [overview, charges, prices, split, people] = await Promise.all([
    q('SELECT * FROM subscription_overview WHERE sub_id = $1'),
    q(`SELECT t.txn_id, t.txn_date, t.raw_description, t.amount,
              t.txn_date - LAG(t.txn_date) OVER (ORDER BY t.txn_date) AS days_since_previous
       FROM subscription_charges sc JOIN transactions t USING (txn_id)
       WHERE sc.sub_id = $1 ORDER BY t.txn_date DESC`),
    q('SELECT old_amount, new_amount, pct_change, effective_date FROM price_changes WHERE sub_id = $1 ORDER BY effective_date DESC'),
    q('SELECT user_id, share_percent FROM split_shares WHERE sub_id = $1'),
    q(`SELECT u.user_id, u.full_name, ua.access_level FROM subscriptions s
       JOIN user_accounts ua ON ua.account_id = s.account_id JOIN users u ON u.user_id = ua.user_id
       WHERE s.sub_id = $1 ORDER BY (ua.access_level = 'owner') DESC, u.full_name`),
  ]);
  return { level: sub.level, subscription: overview[0], charges, prices, split, people };
});

export const dynamic = 'force-dynamic';
