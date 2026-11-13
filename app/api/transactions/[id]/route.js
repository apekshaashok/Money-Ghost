import { pool } from '../../../../lib/db.js';
import { route, readJson, requireAccess, toInt, HttpError } from '../../../../lib/api.js';

async function loadTxn(session, id) {
  const { rows } = await pool.query('SELECT txn_id, account_id FROM transactions WHERE txn_id = $1', [toInt(id, 'transaction')]);
  if (!rows[0]) throw new HttpError(404, 'Transaction not found.');
  await requireAccess(session, rows[0].account_id, 'write');
  return rows[0];
}

// PATCH /api/transactions/:id { categoryId }  - change the category
export const PATCH = route(async ({ req, params, session }) => {
  const t = await loadTxn(session, params.id);
  const { categoryId } = await readJson(req);
  await pool.query('UPDATE transactions SET category_id = $2 WHERE txn_id = $1', [t.txn_id, toInt(categoryId, 'category')]);
  return { ok: true };
});

// DELETE /api/transactions/:id  - removes it and re-runs detection
export const DELETE = route(async ({ params, session }) => {
  const t = await loadTxn(session, params.id);
  await pool.query('DELETE FROM transactions WHERE txn_id = $1', [t.txn_id]);
  await pool.query('SELECT detect_subscriptions($1)', [t.account_id]);
  return { ok: true };
});

export const dynamic = 'force-dynamic';
