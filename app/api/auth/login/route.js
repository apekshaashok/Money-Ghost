import bcrypt from 'bcryptjs';
import { pool } from '../../../../lib/db.js';
import { startSession } from '../../../../lib/auth.js';
import { route, readJson, HttpError } from '../../../../lib/api.js';

// POST /api/auth/login { email, password }
export const POST = route(async ({ req }) => {
  const { email, password } = await readJson(req);
  if (!email || !password) throw new HttpError(400, 'Email and password are required.');
  const { rows } = await pool.query('SELECT user_id, full_name, password_hash FROM users WHERE email = $1', [String(email).trim()]);
  const user = rows[0];
  // Same message whether the email or the password is wrong.
  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    throw new HttpError(401, 'Wrong email or password.');
  }
  await pool.query('UPDATE users SET last_login_at = now() WHERE user_id = $1', [user.user_id]);
  await startSession(user);
  return { ok: true };
}, { auth: false });

export const dynamic = 'force-dynamic';
