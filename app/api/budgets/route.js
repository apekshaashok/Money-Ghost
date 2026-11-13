import { pool } from '../../../lib/db.js';
import { route, readJson, toInt } from '../../../lib/api.js';

// GET /api/budgets -> budget_status view (this month)
export const GET = route(async ({ session }) =>
  (await pool.query('SELECT * FROM budget_status WHERE user_id = $1 ORDER BY category', [session.uid])).rows);

// POST /api/budgets { categoryId, monthlyLimit }
export const POST = route(async ({ req, session }) => {
  const b = await readJson(req);
  const { rows } = await pool.query(
    'INSERT INTO budgets (user_id, category_id, monthly_limit) VALUES ($1, $2, $3) RETURNING budget_id',
    [session.uid, toInt(b.categoryId, 'category'), b.monthlyLimit]);
  return rows[0];
});

export const dynamic = 'force-dynamic';
