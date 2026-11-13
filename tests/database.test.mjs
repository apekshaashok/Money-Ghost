// Database-level tests: constraints, triggers, functions, procedures and views.
// Every test runs inside BEGIN ... ROLLBACK, so the demo data is never changed.
// Prerequisite: npm run db:setup && npm run db:seed
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, mongo, closeMongo } from '../lib/db.js';

const HASH = '$2a$10$abcdefghijklmnopqrstuuJ8m0bWl4Iu3b0Hn8W4fJ7l0iN6o1d2K'; // syntactically valid bcrypt hash

/** Run fn(client) in a transaction that is always rolled back. */
async function rollback(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

/** Expect a statement to fail with a SQLSTATE; uses a savepoint so the transaction survives. */
async function rejects(c, sql, params, code) {
  await c.query('SAVEPOINT s');
  try {
    await c.query(sql, params);
    assert.fail(`expected error ${code} for: ${sql}`);
  } catch (e) {
    if (e.code === 'ERR_ASSERTION') throw e;
    assert.equal(e.code, code, `${sql} -> ${e.code} ${e.message}`);
    await c.query('ROLLBACK TO SAVEPOINT s');
    return e;
  }
}

const ids = async (c) => {
  const u = (await c.query(`SELECT user_id, email FROM users`)).rows;
  const a = (await c.query(`SELECT account_id, name FROM accounts`)).rows;
  return {
    apeksha: u.find((x) => x.email.startsWith('apeksha')).user_id,
    avanthika: u.find((x) => x.email.startsWith('avanthika')).user_id,
    hdfc: a.find((x) => x.name === 'HDFC Savings').account_id,
    icici: a.find((x) => x.name === 'ICICI Credit Card').account_id,
    sbi: a.find((x) => x.name === 'SBI Savings').account_id,
  };
};

after(async () => { await pool.end(); await closeMongo(); });

test('D1 users: plain-text passwords and malformed e-mails are rejected by CHECK constraints', () => rollback(async (c) => {
  await rejects(c, `INSERT INTO users (email, password_hash, full_name) VALUES ('x@test.dev', 'secret123', 'X Y')`, [], '23514');
  await rejects(c, `INSERT INTO users (email, password_hash, full_name) VALUES ('not-an-email', $1, 'X Y')`, [HASH], '23514');
  const e = await rejects(c, `INSERT INTO users (email, password_hash, full_name) VALUES ('APEKSHA@moneyghosts.dev', $1, 'Copy')`, [HASH], '23505');
  assert.equal(e.constraint, 'users_email_key');        // CITEXT: e-mail uniqueness ignores case
}));

test('D2 transactions: amount > 0, no future dates, no duplicates, FK to account', () => rollback(async (c) => {
  const { hdfc } = await ids(c);
  await rejects(c, `INSERT INTO transactions (account_id, txn_date, raw_description, amount) VALUES ($1, CURRENT_DATE, 'X', -5)`, [hdfc], '23514');
  await rejects(c, `INSERT INTO transactions (account_id, txn_date, raw_description, amount) VALUES ($1, CURRENT_DATE + 30, 'X', 5)`, [hdfc], '23514');
  await rejects(c, `INSERT INTO transactions (account_id, txn_date, raw_description, amount) VALUES ($1, CURRENT_DATE, '   ', 5)`, [hdfc], '23514');
  await rejects(c, `INSERT INTO transactions (account_id, txn_date, raw_description, amount) VALUES (999999, CURRENT_DATE, 'X', 5)`, [], '23503');
  const t = (await c.query(`SELECT txn_date, raw_description, amount FROM transactions WHERE account_id = $1 LIMIT 1`, [hdfc])).rows[0];
  const e = await rejects(c, `INSERT INTO transactions (account_id, txn_date, raw_description, amount) VALUES ($1, $2, $3, $4)`,
    [hdfc, t.txn_date, t.raw_description, t.amount], '23505');
  assert.equal(e.constraint, 'txn_no_duplicate');
}));

test('D3 normalize_merchant groups noisy bank descriptions', () => rollback(async (c) => {
  const cases = {
    'SQ *COFFEE4821': 'coffee', 'SPOTIFY P1A2B': 'spotify', 'UPI/SWIGGY/9876543210/PAYMENT': 'swiggy',
    'AMAZON PRIME*KZCJ3': 'amazon prime', 'POS 4821XXXXXXXX1234 NETFLIX.COM 77': 'netflix', 'BY DEBIT CARD SPOTIFY INDIA 123': 'spotify',
  };
  for (const [raw, key] of Object.entries(cases)) {
    assert.equal((await c.query('SELECT normalize_merchant($1) AS k', [raw])).rows[0].k, key, raw);
  }
}));

test('D4 leak detection finds the planted subscriptions with the right status', () => rollback(async (c) => {
  const { rows } = await c.query(`SELECT merchant_key, cadence, status, price_alert FROM subscriptions`);
  const s = Object.fromEntries(rows.map((r) => [r.merchant_key, r]));
  assert.equal(s.netflix.cadence, 'monthly');
  assert.equal(s.netflix.price_alert, true);                  // 499 -> 649
  assert.equal(s['cult fit gym'].status, 'dormant');          // charges stopped 4 months ago
  assert.equal(s.audible.status, 'active');
  assert.equal(s['amazon prime'].cadence, 'yearly');
  assert.equal(s['disney hotstar'].cadence, 'quarterly');
  assert.equal(s['the hindu epaper'].cadence, 'weekly');
  for (const noise of ['swiggy', 'zomato', 'coffee', 'billdesk bescom electricity', 'bigbasket']) {
    assert.equal(s[noise], undefined, `${noise} must not be a subscription`);
  }
}));

test('D5 trigger: changing a subscription amount logs a price change and raises the alert', () => rollback(async (c) => {
  const { hdfc } = await ids(c);
  const sub = (await c.query(`SELECT sub_id, current_amount FROM subscriptions WHERE account_id = $1 AND merchant_key = 'spotify'`, [hdfc])).rows[0];
  const before = (await c.query('SELECT COUNT(*) AS n FROM price_changes WHERE sub_id = $1', [sub.sub_id])).rows[0].n;
  await c.query('UPDATE subscriptions SET current_amount = 179 WHERE sub_id = $1', [sub.sub_id]);
  const after = await c.query('SELECT old_amount, new_amount, pct_change FROM price_changes WHERE sub_id = $1 ORDER BY change_id DESC LIMIT 1', [sub.sub_id]);
  assert.equal((await c.query('SELECT COUNT(*) AS n FROM price_changes WHERE sub_id = $1', [sub.sub_id])).rows[0].n, before + 1);
  assert.deepEqual(after.rows[0], { old_amount: 119, new_amount: 179, pct_change: 50.42 });
  assert.equal((await c.query('SELECT price_alert FROM subscriptions WHERE sub_id = $1', [sub.sub_id])).rows[0].price_alert, true);
}));

test('D6 trigger: the owner cannot be added as a member of their own account', () => rollback(async (c) => {
  const { hdfc, apeksha } = await ids(c);
  const e = await rejects(c, `INSERT INTO account_members (account_id, user_id, access_level) VALUES ($1, $2, 'read_only')`, [hdfc, apeksha], '23514');
  assert.match(e.message, /already owns/);
}));

test('D7 set_split is all-or-nothing (bad total, or a user without access, changes nothing)', () => rollback(async (c) => {
  const { hdfc, apeksha, avanthika } = await ids(c);
  const sub = (await c.query(`SELECT sub_id FROM subscriptions WHERE account_id = $1 AND merchant_key = 'netflix'`, [hdfc])).rows[0].sub_id;
  const before = (await c.query('SELECT user_id, share_percent FROM split_shares WHERE sub_id = $1 ORDER BY user_id', [sub])).rows;
  await rejects(c, 'SELECT set_split($1, $2::int[], $3::numeric[])', [sub, [apeksha, avanthika], [60, 30]], 'P0001');
  const outsider = (await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ('out@test.dev', $1, 'Out Sider') RETURNING user_id`, [HASH])).rows[0].user_id;
  await rejects(c, 'SELECT set_split($1, $2::int[], $3::numeric[])', [sub, [apeksha, outsider], [50, 50]], '23514');
  assert.deepEqual((await c.query('SELECT user_id, share_percent FROM split_shares WHERE sub_id = $1 ORDER BY user_id', [sub])).rows, before);
  await c.query('SELECT set_split($1, $2::int[], $3::numeric[])', [sub, [apeksha, avanthika], [70, 30]]);
  assert.equal((await c.query('SELECT share_percent FROM split_shares WHERE sub_id = $1 AND user_id = $2', [sub, avanthika])).rows[0].share_percent, 30);
}));

test('D8 MongoDB $jsonSchema validator rejects a malformed raw statement document', async () => {
  const db = await mongo();
  await assert.rejects(
    db.collection('raw_statements').insertOne({ user_id: 1, filename: 'x.csv', format: 'xml' }),
    (e) => e.code === 121);                              // 121 = DocumentValidationFailure
  await assert.rejects(
    db.collection('bank_profiles').insertOne({ code: 'Bad Code!', bank: 'X', format: 'csv', columns: {}, date_format: 'auto' }),
    (e) => e.code === 121);
});

test('D9 recursive forecast lists upcoming charges inside the horizon only', () => rollback(async (c) => {
  const { hdfc } = await ids(c);
  const rows = (await c.query('SELECT * FROM forecast_charges($1, 70)', [hdfc])).rows;
  assert.ok(rows.length >= 4);
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) assert.ok(r.due_date >= today);
  const netflix = rows.filter((r) => r.display_name === 'Netflix');
  assert.ok(netflix.length >= 2, 'monthly service appears more than once in 70 days');
  assert.ok(!rows.some((r) => r.display_name === 'Cult Fit Gym'), 'dormant subscriptions are not forecast');
}));

test('D10 views: deja vu double charges, household duplicates, cost roll-up', () => rollback(async (c) => {
  const dv = (await c.query('SELECT raw_description, amount FROM duplicate_charges')).rows;
  assert.ok(dv.some((r) => r.raw_description.startsWith('AMAZON.IN ORDER') && r.amount === 2499));
  assert.ok(dv.some((r) => r.raw_description.startsWith('MAKEMYTRIP') && r.amount === 4520));
  const hh = (await c.query('SELECT display_name FROM household_duplicate_subscriptions')).rows;
  assert.ok(hh.some((r) => r.display_name === 'Spotify'));
  const { hdfc } = await ids(c);
  const cost = (await c.query('SELECT active_subscriptions, monthly_total FROM subscription_cost_view WHERE account_id = $1', [hdfc])).rows[0];
  assert.ok(cost.active_subscriptions >= 5 && cost.monthly_total > 25000);
}));

test('D11 vector auto-categorisation puts merchants in the right category', () => rollback(async (c) => {
  const cat = async (key) => (await c.query(
    `SELECT DISTINCT c.name FROM transactions t JOIN categories c USING (category_id) WHERE t.merchant_key = $1`, [key])).rows.map((r) => r.name);
  assert.deepEqual(await cat('netflix'), ['Entertainment']);
  assert.deepEqual(await cat('golds gym'), ['Health & Fitness']);    // no example text says "golds gym"
  assert.deepEqual(await cat('swiggy'), ['Food & Dining']);
  assert.deepEqual(await cat('uber'), ['Transport']);
}));

test('D12 indexes exist and the vector index is used for nearest-neighbour search', () => rollback(async (c) => {
  const idx = (await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).rows.map((r) => r.indexname);
  for (const name of ['idx_txn_embedding_hnsw', 'idx_txn_fts', 'idx_txn_merchant_trgm', 'idx_subs_active', 'idx_txn_account_date']) {
    assert.ok(idx.includes(name), name);
  }
  await c.query('SET LOCAL enable_seqscan = off');
  const v = (await c.query('SELECT embedding FROM transactions LIMIT 1')).rows[0].embedding;
  const plan = (await c.query(`EXPLAIN SELECT txn_id FROM transactions ORDER BY embedding <=> $1::vector LIMIT 5`, [v])).rows.map((r) => r['QUERY PLAN']).join('\n');
  assert.match(plan, /idx_txn_embedding_hnsw/);
}));

test('D13 deleting an import cascades to its transactions (ON DELETE CASCADE)', () => rollback(async (c) => {
  const imp = (await c.query(`SELECT import_id, rows_inserted FROM imports ORDER BY import_id LIMIT 1`)).rows[0];
  const before = (await c.query('SELECT COUNT(*) AS n FROM transactions WHERE import_id = $1', [imp.import_id])).rows[0].n;
  assert.equal(before, imp.rows_inserted);
  await c.query('DELETE FROM imports WHERE import_id = $1', [imp.import_id]);
  assert.equal((await c.query('SELECT COUNT(*) AS n FROM transactions WHERE import_id = $1', [imp.import_id])).rows[0].n, 0);
}));
