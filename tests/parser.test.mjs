// Unit tests for the statement parser (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseAmount, parseFile, detectProfile, normaliseRecords, recordsFor } from '../lib/statement-parser.js';
import { BANK_PROFILES } from '../scripts/bank-profiles.mjs';

test('P1 parseDate understands every bank date format and rejects impossible dates', () => {
  assert.equal(parseDate('2026-05-03', 'ISO'), '2026-05-03');
  assert.equal(parseDate('2026-05-03T10:22:00+05:30', 'ISO'), '2026-05-03');
  assert.equal(parseDate('03/05/26', 'DD/MM/YY'), '2026-05-03');
  assert.equal(parseDate('03-05-2026', 'DD-MM-YYYY'), '2026-05-03');
  assert.equal(parseDate('03 May 2026', 'DD MMM YYYY'), '2026-05-03');
  assert.equal(parseDate('31/02/26', 'DD/MM/YY'), null);   // 31 February does not exist
  assert.equal(parseDate('hello', 'auto'), null);
});

test('P2 parseAmount strips currency symbols, commas and handles negatives', () => {
  assert.equal(parseAmount('₹1,200.50'), 1200.5);
  assert.equal(parseAmount('(450)'), -450);
  assert.equal(parseAmount('-99'), -99);
  assert.equal(parseAmount('Rs. 75'), 75);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('P3 the right bank profile is detected from CSV headers', () => {
  const hdfc = parseFile('Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/09/25,"NETFLIX",1,01/09/25,499.00,,1000\n');
  assert.equal(detectProfile(hdfc, BANK_PROFILES).code, 'hdfc_savings_csv');
  const generic = parseFile('date,description,amount\n2026-01-01,X,10\n');
  assert.equal(detectProfile(generic, BANK_PROFILES).code, 'generic_csv');
  const unknown = parseFile('foo,bar\n1,2\n');
  assert.equal(detectProfile(unknown, BANK_PROFILES), null);
});

test('P4 nested JSON wallet export is read through its records_path', () => {
  const parsed = parseFile(JSON.stringify({ statement: { transactions: [
    { postedOn: '2026-03-01T09:00:00+05:30', direction: 'DEBIT', merchant: { name: 'THE HINDU EPAPER' }, amount: { value: 30 } },
    { postedOn: '2026-03-02T09:00:00+05:30', direction: 'CREDIT', merchant: { name: 'ADD MONEY' }, amount: { value: 2000 } },
  ] } }), 'w.json');
  const profile = detectProfile(parsed, BANK_PROFILES);
  assert.equal(profile.code, 'paytm_wallet_json');
  const { rows, credits } = normaliseRecords(recordsFor(parsed, profile), profile);
  assert.deepEqual(rows.map((r) => [r.date, r.description, r.amount]), [['2026-03-01', 'THE HINDU EPAPER', 30]]);
  assert.equal(credits, 1);
});

test('P5 credits are skipped and bad rows are reported, not silently dropped', () => {
  const parsed = parseFile('Date,Narration,Withdrawal Amt.,Deposit Amt.\n01/09/25,RENT,25000.00,\n02/09/25,SALARY,,85000\n31/02/26,BAD DATE,10,\n03/09/25,,10,\n');
  const profile = BANK_PROFILES.find((p) => p.code === 'hdfc_savings_csv');
  const { rows, errors, credits } = normaliseRecords(parsed.data, profile);
  assert.equal(rows.length, 1);
  assert.equal(credits, 1);
  assert.deepEqual(errors.map((e) => e.reason), ['invalid or missing date', 'missing description']);
});
