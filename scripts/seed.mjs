// npm run db:seed
// Loads a demo household through the REAL import pipeline (MongoDB -> PostgreSQL -> pgvector).
// Demo logins (demo data only):  apeksha@moneyghosts.dev / avanthika@moneyghosts.dev
// Password for both:              Demo@1234
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pool, mongo, closeMongo } from '../lib/db.js';
import { importStatement } from '../lib/importer.js';
import { writeSamples } from './generate-samples.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEMO_PASSWORD = 'Demo@1234';

async function q(sql, params) {
  return (await pool.query(sql, params)).rows;
}

try {
  console.log('Seeding demo data...');
  await pool.query(`TRUNCATE users, accounts, account_members, imports, transactions, subscriptions,
                    subscription_charges, price_changes, split_shares, budgets RESTART IDENTITY CASCADE`);
  const db = await mongo();
  await db.collection('raw_statements').deleteMany({});

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = {};
  for (const [key, name] of [['apeksha', 'Apeksha Ashok'], ['avanthika', 'Avanthika J']]) {
    const [u] = await q('INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,$3) RETURNING user_id',
      [`${key}@moneyghosts.dev`, hash, name]);
    users[key] = u.user_id;
  }

  const accounts = {};
  for (const [owner, name, bank, type] of [
    ['apeksha', 'HDFC Savings', 'HDFC Bank', 'savings'],
    ['apeksha', 'ICICI Credit Card', 'ICICI Bank', 'credit_card'],
    ['apeksha', 'Paytm Wallet', 'Paytm', 'wallet'],
    ['avanthika', 'SBI Savings', 'State Bank of India', 'savings'],
  ]) {
    const [a] = await q('INSERT INTO accounts (owner_id, name, bank_name, account_type) VALUES ($1,$2,$3,$4) RETURNING account_id',
      [users[owner], name, bank, type]);
    accounts[name] = a.account_id;
  }
  // Household sharing: Avanthika can contribute to Apeksha's HDFC account; Apeksha can view Avanthika's SBI account.
  await q(`INSERT INTO account_members (account_id, user_id, access_level) VALUES ($1,$2,'contributor'), ($3,$4,'read_only')`,
    [accounts['HDFC Savings'], users.avanthika, accounts['SBI Savings'], users.apeksha]);

  const samples = writeSamples(path.join(root, 'sample'));
  for (const f of samples.files.filter((x) => x.owner)) {
    const res = await importStatement({ userId: users[f.owner], accountId: accounts[f.account], filename: f.filename, text: f.content });
    console.log(`  imported ${f.filename.padEnd(22)} profile=${res.profile.padEnd(18)} rows=${res.total} inserted=${res.inserted} skipped=${res.credits + res.invalid + res.duplicates} subscriptions=${res.subscriptions}`);
  }

  await q(`UPDATE subscriptions SET display_name = 'Netflix' WHERE merchant_key = 'netflix'`);
  await q(`UPDATE subscriptions SET display_name = 'Spotify' WHERE merchant_key LIKE 'spotify%'`);

  // Netflix is shared 50/50 with Avanthika.
  const [netflix] = await q(`SELECT sub_id FROM subscriptions WHERE account_id = $1 AND merchant_key = 'netflix'`, [accounts['HDFC Savings']]);
  if (netflix) await q('SELECT set_split($1, $2::int[], $3::numeric[])', [netflix.sub_id, [users.apeksha, users.avanthika], [50, 50]]);

  for (const [cat, limit] of [['Food & Dining', 4000], ['Entertainment', 1500], ['Transport', 2000], ['Shopping', 5000], ['Groceries', 6000]]) {
    await q(`INSERT INTO budgets (user_id, category_id, monthly_limit) SELECT $1, category_id, $3 FROM categories WHERE name = $2`,
      [users.apeksha, cat, limit]);
  }

  const summary = await q(`SELECT a.name, s.display_name, s.cadence, s.current_amount, s.status, s.price_alert
                           FROM subscriptions s JOIN accounts a USING (account_id) ORDER BY a.account_id, s.current_amount DESC`);
  console.table(summary);
  console.log(`Done. Log in at http://localhost:3000 with apeksha@moneyghosts.dev / ${DEMO_PASSWORD}`);
} catch (e) {
  console.error('Seed failed:', e);
  process.exitCode = 1;
} finally {
  await pool.end();
  await closeMongo();
}
