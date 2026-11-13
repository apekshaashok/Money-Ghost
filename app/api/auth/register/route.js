import bcrypt from 'bcryptjs';
import { withTransaction } from '../../../../lib/db.js';
import { startSession } from '../../../../lib/auth.js';
import { route, readJson, HttpError } from '../../../../lib/api.js';

// POST /api/auth/register { fullName, email, password } - creates the user and a first account
export const POST = route(async ({ req }) => {
  const { fullName, email, password } = await readJson(req);
  if (typeof password !== 'string' || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(400, 'Password needs at least 8 characters, including a letter and a number.');
  }
  const hash = await bcrypt.hash(password, 10);            // only the bcrypt hash is stored
  const user = await withTransaction(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING user_id, email, full_name',
      [String(email || '').trim(), hash, String(fullName || '').trim()]);
    await c.query(`INSERT INTO accounts (owner_id, name) VALUES ($1, 'My account')`, [rows[0].user_id]);
    return rows[0];
  });
  await startSession(user);
  return { ok: true };
}, { auth: false });

export const dynamic = 'force-dynamic';
