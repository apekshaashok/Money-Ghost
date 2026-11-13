// Shared helpers for the API route handlers: auth, account access, error mapping.
import { pool } from './db.js';
import { getSession } from './auth.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Friendly messages for named database constraints (validation happens in PostgreSQL).
const CONSTRAINT_MESSAGES = {
  users_email_key: 'That email is already registered.',
  users_email_format: 'Please enter a valid email address.',
  users_password_is_bcrypt: 'Password must be stored as a bcrypt hash.',
  accounts_unique_name_per_owner: 'You already have an account with that name.',
  account_members_pkey: 'That person already has access to this account.',
  imports_same_file_once: 'This exact file was already imported into this account.',
  txn_no_duplicate: 'That transaction already exists.',
  budget_once_per_category: 'You already have a budget for that category.',
  positive_amount_check: 'Amounts must be greater than zero.',
};

const PG_STATUS = {
  '23505': 409, // unique_violation
  '23514': 400, // check_violation (also raised by our triggers)
  '23503': 400, // foreign_key_violation
  '23502': 400, // not_null_violation
  '22P02': 400, // invalid_text_representation
  '22001': 400, // string too long
  '22003': 400, // numeric out of range
  '22007': 400, '22008': 400, // bad date
  P0001: 400,   // RAISE EXCEPTION in our functions / procedures
};

function errorResponse(e) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  if (e?.code && PG_STATUS[e.code]) {
    const message = CONSTRAINT_MESSAGES[e.constraint] ||
      (e.code === 'P0001' || (e.code === '23514' && !e.constraint) ? e.message
        : e.constraint ? `The database rejected this value (rule: ${e.constraint}).` : e.message);
    return Response.json({ error: message, code: e.code, constraint: e.constraint || null }, { status: PG_STATUS[e.code] });
  }
  console.error(e);
  return Response.json({ error: 'Something went wrong on the server.' }, { status: 500 });
}

/** Wrap a route handler. options.auth (default true) requires a logged-in session. */
export function route(handler, { auth = true } = {}) {
  return async (req, ctx) => {
    try {
      let session = null;
      if (auth) {
        session = await getSession();
        if (!session) throw new HttpError(401, 'Please log in first.');
      }
      const url = new URL(req.url);
      const result = await handler({ req, url, params: ctx?.params || {}, session });
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

export function toInt(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}.`);
  return n;
}

const RANK = { read_only: 1, contributor: 2, owner: 3 };

/**
 * Check the session user's access to an account using the database function user_access_level().
 * need: 'read' | 'write' (owner or contributor) | 'owner'.  Returns the access level.
 */
export async function requireAccess(session, accountId, need = 'read') {
  const id = toInt(accountId, 'account');
  const { rows } = await pool.query('SELECT user_access_level($1, $2) AS level', [session.uid, id]);
  const level = rows[0].level;
  if (!level) throw new HttpError(404, 'Account not found.');
  const needed = need === 'owner' ? 3 : need === 'write' ? 2 : 1;
  if (RANK[level] < needed) {
    throw new HttpError(403, need === 'owner' ? 'Only the account owner can do this.' : 'You have read-only access to this account.');
  }
  return level;
}

/** Account id from ?account=, falling back to the user's first account. */
export async function resolveAccount(session, url, need = 'read') {
  let id = url.searchParams.get('account');
  if (!id) {
    const { rows } = await pool.query(
      'SELECT account_id FROM user_accounts WHERE user_id = $1 ORDER BY (access_level = $2) DESC, account_id LIMIT 1',
      [session.uid, 'owner']);
    if (!rows[0]) throw new HttpError(404, 'You have no accounts yet.');
    id = rows[0].account_id;
  }
  const level = await requireAccess(session, id, need);
  return { accountId: Number(id), level };
}

/** Load a subscription and check access to its account. */
export async function loadSubscription(session, subId, need = 'read') {
  const { rows } = await pool.query('SELECT sub_id, account_id FROM subscriptions WHERE sub_id = $1', [toInt(subId, 'subscription')]);
  if (!rows[0]) throw new HttpError(404, 'Subscription not found.');
  const level = await requireAccess(session, rows[0].account_id, need);
  return { ...rows[0], level };
}
