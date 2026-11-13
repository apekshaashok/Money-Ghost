import { pool } from '../../../lib/db.js';
import { route, resolveAccount } from '../../../lib/api.js';

// GET /api/subscriptions?account=1&status=active
export const GET = route(async ({ url, session }) => {
  const { accountId, level } = await resolveAccount(session, url);
  const status = ['active', 'dormant'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
  const { rows } = await pool.query(
    `SELECT * FROM subscription_overview
     WHERE account_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY status, monthly_equivalent DESC`, [accountId, status]);
  const totals = await pool.query('SELECT * FROM subscription_cost_view WHERE account_id = $1', [accountId]);
  return { level, subscriptions: rows, totals: totals.rows[0] || null };
});

export const dynamic = 'force-dynamic';
