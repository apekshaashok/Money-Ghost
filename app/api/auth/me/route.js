import { pool } from '../../../../lib/db.js';
import { route, HttpError } from '../../../../lib/api.js';

// GET /api/auth/me -> current user + every account they can see (own and shared)
export const GET = route(async ({ session }) => {
  const u = await pool.query('SELECT user_id, email, full_name FROM users WHERE user_id = $1', [session.uid]);
  if (!u.rows[0]) throw new HttpError(401, 'Please log in again.');
  const accounts = await pool.query(
    `SELECT a.account_id, a.name, ua.access_level, o.full_name AS owner_name
     FROM user_accounts ua JOIN accounts a USING (account_id) JOIN users o ON o.user_id = a.owner_id
     WHERE ua.user_id = $1 ORDER BY (ua.access_level = 'owner') DESC, a.account_id`, [session.uid]);
  return { user: { id: u.rows[0].user_id, email: u.rows[0].email, name: u.rows[0].full_name }, accounts: accounts.rows };
});

export const dynamic = 'force-dynamic';
