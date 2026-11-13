import { pool } from '../../../../../lib/db.js';
import { route, readJson, requireAccess, toInt, HttpError } from '../../../../../lib/api.js';

// POST /api/accounts/:id/members { email, accessLevel: 'read_only' | 'contributor' }  (owner only)
export const POST = route(async ({ req, params, session }) => {
  const id = toInt(params.id, 'account');
  await requireAccess(session, id, 'owner');
  const { email, accessLevel } = await readJson(req);
  const u = await pool.query('SELECT user_id, full_name FROM users WHERE email = $1', [String(email || '').trim()]);
  if (!u.rows[0]) throw new HttpError(404, 'No user has that email. Ask them to register first.');
  await pool.query(
    `INSERT INTO account_members (account_id, user_id, access_level) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, user_id) DO UPDATE SET access_level = EXCLUDED.access_level`,
    [id, u.rows[0].user_id, accessLevel]);
  return { ok: true, name: u.rows[0].full_name };
});

// DELETE /api/accounts/:id/members?user=7   (owner only)
export const DELETE = route(async ({ url, params, session }) => {
  const id = toInt(params.id, 'account');
  await requireAccess(session, id, 'owner');
  const r = await pool.query('DELETE FROM account_members WHERE account_id = $1 AND user_id = $2', [id, toInt(url.searchParams.get('user'), 'user')]);
  if (!r.rowCount) throw new HttpError(404, 'That person is not a member of this account.');
  return { ok: true };
});

export const dynamic = 'force-dynamic';
