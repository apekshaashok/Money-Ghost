import { pool } from '../../../../lib/db.js';
import { route, toInt, HttpError } from '../../../../lib/api.js';

// DELETE /api/budgets/:id  (only your own budgets)
export const DELETE = route(async ({ params, session }) => {
  const r = await pool.query('DELETE FROM budgets WHERE budget_id = $1 AND user_id = $2', [toInt(params.id, 'budget'), session.uid]);
  if (!r.rowCount) throw new HttpError(404, 'Budget not found.');
  return { ok: true };
});

export const dynamic = 'force-dynamic';
