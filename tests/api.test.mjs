// End-to-end API tests over HTTP. Needs the app running (npm run dev / npm start) and seeded data.
// BASE_URL defaults to http://localhost:3000. The temporary user created here is deleted afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, mongo, closeMongo } from '../lib/db.js';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TEMP_EMAIL = `test.${Date.now()}@moneyghosts.dev`;
let reachable = true;

/** Tiny HTTP client that keeps its own session cookie. */
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, headers: res.headers };
  };
}

async function login(email) {
  const c = client();
  const r = await c('POST', '/api/auth/login', { email, password: 'Demo@1234' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}
const acct = async (name) => (await pool.query('SELECT account_id FROM accounts WHERE name = $1', [name])).rows[0].account_id;

before(async () => {
  try { await fetch(BASE + '/login'); } catch { reachable = false; }
});
after(async () => {
  await pool.query('DELETE FROM users WHERE email = $1', [TEMP_EMAIL]);
  await pool.end();
  await closeMongo();
});
const t = (name, fn) => test(name, async (ctx) => (reachable ? fn(ctx) : ctx.skip(`app not running at ${BASE}`)));

t('A1 protected API and pages require a session', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/dashboard')).status, 401);
  const page = await c('GET', '/dashboard');
  assert.equal(page.status, 307);
  assert.match(page.headers.get('location'), /\/login/);
});

t('A2 login: wrong password gives 401 with a generic message; right password sets an httpOnly cookie', async () => {
  const c = client();
  const bad = await c('POST', '/api/auth/login', { email: 'apeksha@moneyghosts.dev', password: 'wrong-password1' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'Wrong email or password.');
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'apeksha@moneyghosts.dev', password: 'Demo@1234' }) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(res.headers.get('set-cookie'), /SameSite=lax/i);
});

t('A3 register validates input; duplicate e-mail is reported by the database constraint', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/register', { fullName: 'Test', email: TEMP_EMAIL, password: 'short' })).status, 400);
  assert.equal((await c('POST', '/api/auth/register', { fullName: 'Test', email: 'bad-email', password: 'GoodPass123' })).status, 400);
  const ok = await c('POST', '/api/auth/register', { fullName: 'Test User', email: TEMP_EMAIL, password: 'GoodPass123' });
  assert.equal(ok.status, 200);
  const dup = await client()('POST', '/api/auth/register', { fullName: 'Test User', email: TEMP_EMAIL.toUpperCase(), password: 'GoodPass123' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'That email is already registered.');
  const stored = (await pool.query('SELECT password_hash FROM users WHERE email = $1', [TEMP_EMAIL])).rows[0].password_hash;
  assert.match(stored, /^\$2[aby]\$10\$/);                 // bcrypt, never the plain password
});

t('A4 role-based access: read-only member cannot import; an outsider cannot see the account', async () => {
  const apeksha = await login('apeksha@moneyghosts.dev');
  const sbi = await acct('SBI Savings');                   // Apeksha is read_only there
  assert.equal((await apeksha('GET', `/api/dashboard?account=${sbi}`)).status, 200);
  const write = await apeksha('POST', `/api/import?account=${sbi}`, { filename: 'x.csv', text: 'date,description,amount\n2026-01-01,X,10\n' });
  assert.equal(write.status, 403);
  const outsider = client();
  await outsider('POST', '/api/auth/login', { email: TEMP_EMAIL, password: 'GoodPass123' });
  assert.equal((await outsider('GET', `/api/dashboard?account=${sbi}`)).status, 404);
});

t('A5 contributor can change a shared account; read-only cannot', async () => {
  const avanthika = await login('avanthika@moneyghosts.dev');
  const hdfc = await acct('HDFC Savings');                 // Avanthika is contributor there
  const sub = (await pool.query(`SELECT sub_id FROM subscriptions WHERE account_id = $1 AND merchant_key = 'netflix'`, [hdfc])).rows[0].sub_id;
  const users = (await pool.query(`SELECT user_id FROM users WHERE email IN ('apeksha@moneyghosts.dev','avanthika@moneyghosts.dev') ORDER BY email`)).rows.map((r) => r.user_id);
  const ok = await avanthika('PUT', `/api/subscriptions/${sub}/split`, { shares: [{ userId: users[0], percent: 50 }, { userId: users[1], percent: 50 }] });
  assert.equal(ok.status, 200);
  const bad = await avanthika('PUT', `/api/subscriptions/${sub}/split`, { shares: [{ userId: users[0], percent: 70 }, { userId: users[1], percent: 50 }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /add up to 100/);
  const apeksha = await login('apeksha@moneyghosts.dev');
  const sbiSub = (await pool.query(`SELECT s.sub_id FROM subscriptions s JOIN accounts a USING (account_id) WHERE a.name = 'SBI Savings' LIMIT 1`)).rows[0].sub_id;
  assert.equal((await apeksha('PUT', `/api/subscriptions/${sbiSub}/split`, { shares: [] })).status, 403);
});

t('A6 vector search finds cryptic bank codes by meaning; keyword search does not', async () => {
  const c = await login('apeksha@moneyghosts.dev');
  const meaning = await c('POST', '/api/search', { q: 'video streaming', mode: 'meaning' });
  assert.equal(meaning.status, 200);
  assert.ok(meaning.body.rows.slice(0, 3).some((r) => r.merchant_key === 'netflix'));
  const keyword = await c('POST', '/api/search', { q: 'video streaming', mode: 'keyword' });
  assert.equal(keyword.body.rows.length, 0);
  const food = await c('POST', '/api/search', { q: 'food delivery', mode: 'meaning' });
  const merchants = new Set(food.body.rows.map((r) => r.merchant_key));
  assert.ok(merchants.has('swiggy') && merchants.has('zomato'));
});

t('A7 import: new file works end-to-end, the same file twice is refused, unknown formats are refused', async () => {
  const c = client();
  await c('POST', '/api/auth/login', { email: TEMP_EMAIL, password: 'GoodPass123' });
  const me = await c('GET', '/api/auth/me');
  const account = me.body.accounts[0].account_id;
  const lines = ['date,description,amount'];
  for (let m = 1; m <= 6; m++) lines.push(`2026-0${m}-10,MUSICPLUS STREAMING ${m}A9,149`);
  lines.push('2026-03-15,LOCAL BAKERY,220');
  const text = lines.join('\n') + '\n';
  const ok = await c('POST', `/api/import?account=${account}`, { filename: 'test.csv', text });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.inserted, 7);
  assert.equal(ok.body.subscriptions, 1);
  const db = await mongo();
  const raw = await db.collection('raw_statements').findOne({ file_hash: { $exists: true }, user_id: me.body.user.id });
  assert.equal(raw.records.length, 7);                          // raw copy kept in MongoDB
  assert.equal((await c('POST', `/api/import?account=${account}`, { filename: 'again.csv', text })).status, 409);
  assert.equal((await c('POST', `/api/import?account=${account}`, { filename: 'odd.csv', text: 'foo,bar\n1,2\n' })).status, 400);
  await db.collection('raw_statements').deleteMany({ user_id: me.body.user.id });
});

t('A8 database constraint errors come back as readable 4xx messages', async () => {
  const c = await login('apeksha@moneyghosts.dev');
  const hdfc = await acct('HDFC Savings');
  const cat = async (name) => (await pool.query('SELECT category_id FROM categories WHERE name = $1', [name])).rows[0].category_id;
  const neg = await c('POST', '/api/budgets', { categoryId: await cat('Education'), monthlyLimit: -5 });
  assert.equal(neg.status, 400);
  assert.equal(neg.body.error, 'Amounts must be greater than zero.');   // positive_amount domain
  const dup = await c('POST', '/api/budgets', { categoryId: await cat('Food & Dining'), monthlyLimit: 100 });
  assert.equal(dup.status, 409);                             // one budget per category (UNIQUE)
  assert.equal((await c('GET', `/api/dashboard?account=${hdfc}`)).status, 200);
});

t('A9 security headers are sent', async () => {
  const res = await fetch(BASE + '/login');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});
