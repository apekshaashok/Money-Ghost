import { pool } from '../../../lib/db.js';
import { route, resolveAccount } from '../../../lib/api.js';

// GET /api/dashboard?account=1
export const GET = route(async ({ url, session }) => {
  const { accountId, level } = await resolveAccount(session, url);
  const q = (sql, p = [accountId]) => pool.query(sql, p).then((r) => r.rows);
  const [cost, priceRises, dormant, dejaVu, household, monthly, categories, upcoming] = await Promise.all([
    q('SELECT active_subscriptions, monthly_total, yearly_total FROM subscription_cost_view WHERE account_id = $1'),
    q(`SELECT display_name, previous_amount, current_amount, last_pct_change, price_changed_on
       FROM subscription_overview WHERE account_id = $1 AND price_alert ORDER BY last_pct_change DESC`),
    q(`SELECT display_name, current_amount, last_charge FROM subscription_overview
       WHERE account_id = $1 AND status = 'dormant'`),
    q('SELECT txn_date, raw_description, amount, prev_date FROM duplicate_charges WHERE account_id = $1 ORDER BY txn_date DESC'),
    // same service paid in two accounts that this user can both see
    q(`SELECT d.display_name, a1.name AS account, a2.name AS other_account
       FROM household_duplicate_subscriptions d
       JOIN accounts a1 ON a1.account_id = d.account_id
       JOIN accounts a2 ON a2.account_id = d.other_account_id
       WHERE $2 IN (d.account_id, d.other_account_id)
         AND d.account_id       IN (SELECT account_id FROM user_accounts WHERE user_id = $1)
         AND d.other_account_id IN (SELECT account_id FROM user_accounts WHERE user_id = $1)`, [session.uid, accountId]),
    q(`SELECT month, total_spend, txn_count FROM monthly_summary
       WHERE account_id = $1 AND month >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months' ORDER BY month DESC`),
    q(`SELECT category, SUM(total_spend) AS total FROM category_monthly_spend
       WHERE account_id = $1 AND month >= date_trunc('month', CURRENT_DATE) - INTERVAL '2 months'
       GROUP BY category HAVING SUM(total_spend) > 0 ORDER BY total DESC`),
    q('SELECT * FROM forecast_charges($1, 30)'),
  ]);
  return { level, cost: cost[0] || null, priceRises, dormant, dejaVu, household, monthly, categories, upcoming };
});

export const dynamic = 'force-dynamic';
