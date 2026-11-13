import { pool } from '../../../lib/db.js';
import { route, readJson } from '../../../lib/api.js';

// GET /api/accounts -> my accounts (with members) and accounts shared with me
export const GET = route(async ({ session }) => {
  const { rows } = await pool.query(
    `SELECT a.account_id, a.name, a.bank_name, ua.access_level, o.full_name AS owner_name,
            (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.account_id) AS txn_count,
            (SELECT json_agg(json_build_object('user_id', u.user_id, 'name', u.full_name, 'email', u.email,
                                               'access_level', m.access_level) ORDER BY u.full_name)
               FROM account_members m JOIN users u USING (user_id) WHERE m.account_id = a.account_id) AS members
     FROM user_accounts ua JOIN accounts a USING (account_id) JOIN users o ON o.user_id = a.owner_id
     WHERE ua.user_id = $1 ORDER BY (ua.access_level = 'owner') DESC, a.account_id`, [session.uid]);
  return rows;
});

// POST /api/accounts { name, bankName }
export const POST = route(async ({ req, session }) => {
  const b = await readJson(req);
  const { rows } = await pool.query(
    `INSERT INTO accounts (owner_id, name, bank_name) VALUES ($1, $2, NULLIF($3, '')) RETURNING account_id`,
    [session.uid, String(b.name ?? '').trim(), String(b.bankName ?? '').trim()]);
  return rows[0];
});

export const dynamic = 'force-dynamic';
