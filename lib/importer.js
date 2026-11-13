// Import pipeline - the place where all three database paradigms meet:
//   1. MongoDB   : the raw file is stored as-is (document store, no fixed schema)
//   2. PostgreSQL: clean debit rows go into `transactions` inside ONE transaction
//   3. pgvector  : each row gets a 384-d embedding (semantic search + auto-category)
//   4. PostgreSQL: detect_subscriptions() runs in the same transaction
import crypto from 'node:crypto';
import { pool, mongo, withTransaction } from './db.js';
import { embedMany, transactionText } from './embed.js';
import { parseFile, detectProfile, recordsFor, normaliseRecords } from './statement-parser.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export class ImportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function listProfiles() {
  const db = await mongo();
  return db.collection('bank_profiles').find({}, { projection: { _id: 0 } }).sort({ bank: 1 }).toArray();
}

export async function importStatement({ userId, accountId, filename, text, profileCode }) {
  if (!text || !text.trim()) throw new ImportError(400, 'The file is empty.');
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new ImportError(413, 'Files up to 5 MB are supported.');
  filename = String(filename || 'statement').slice(0, 255);
  const fileHash = crypto.createHash('sha256').update(text).digest('hex');

  const dup = await pool.query('SELECT import_id, imported_at FROM imports WHERE account_id = $1 AND file_hash = $2', [accountId, fileHash]);
  if (dup.rows[0]) throw new ImportError(409, 'This exact file was already imported into this account.');

  let parsed;
  try {
    parsed = parseFile(text, filename);
  } catch (e) {
    throw new ImportError(400, e.message);
  }
  const profiles = await listProfiles();
  const profile = profileCode ? profiles.find((p) => p.code === profileCode) : detectProfile(parsed, profiles);
  if (!profile) {
    throw new ImportError(400, 'Could not recognise this statement format. Use one of the supported bank formats.');
  }
  if (profile.format !== parsed.format) throw new ImportError(400, `Profile ${profile.code} expects a ${profile.format.toUpperCase()} file.`);

  const records = recordsFor(parsed, profile);
  const { rows, errors, credits } = normaliseRecords(records, profile);

  // 1) Raw document -> MongoDB, before anything is normalised (nothing is lost).
  const db = await mongo();
  const raw = db.collection('raw_statements');
  const doc = {
    user_id: userId,
    account_id: accountId,
    filename,
    file_hash: fileHash,
    format: parsed.format,
    bank_profile: profile.code,
    headers: parsed.headers || Object.keys(records[0] || {}),
    row_count: records.length,
    records,                                   // original rows, original field names
    raw_text: parsed.format === 'csv' ? text : undefined,
    status: 'processing',
    active: true,
    uploaded_at: new Date(),
  };
  if (!doc.raw_text) delete doc.raw_text;
  let mongoId;
  try {
    mongoId = (await raw.insertOne(doc)).insertedId;
  } catch (e) {
    if (e.code === 11000) throw new ImportError(409, 'This exact file is already being imported.');
    throw e;
  }

  try {
    // 2) Embeddings (outside the SQL transaction - this is the slow part).
    //    The merchant key comes from the same SQL function the table uses, and each distinct
    //    merchant is embedded only once.
    const keys = (await pool.query('SELECT normalize_merchant(d) AS k FROM unnest($1::text[]) WITH ORDINALITY AS u(d, i) ORDER BY i',
      [rows.map((r) => r.description)])).rows.map((x) => x.k);
    const texts = rows.map((r, i) => transactionText(r.description, keys[i]));
    const unique = [...new Set(texts)];
    const uniqueVectors = await embedMany(unique);
    const byText = new Map(unique.map((t, i) => [t, uniqueVectors[i]]));
    const vectors = texts.map((t) => byText.get(t));

    // 3) Relational insert + leak detection, all-or-nothing.
    const result = await withTransaction(async (client) => {
      const imp = await client.query(
        `INSERT INTO imports (account_id, user_id, filename, file_hash, bank_profile, mongo_doc_id, rows_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING import_id`,
        [accountId, userId, filename, fileHash, profile.code, mongoId.toHexString(), records.length]);
      const importId = imp.rows[0].import_id;

      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const res = await client.query(
          `INSERT INTO transactions (account_id, import_id, txn_date, raw_description, amount, embedding)
           SELECT $1, $2, d, descr, amt, emb::vector
           FROM unnest($3::date[], $4::text[], $5::numeric[], $6::text[]) AS u(d, descr, amt, emb)
           ON CONFLICT ON CONSTRAINT txn_no_duplicate DO NOTHING`,
          [accountId, importId, chunk.map((r) => r.date), chunk.map((r) => r.description),
           chunk.map((r) => r.amount), vectors.slice(i, i + 500)]);
        inserted += res.rowCount;
      }
      const duplicates = rows.length - inserted;
      const skipped = errors.length + credits + duplicates;
      await client.query('UPDATE imports SET rows_inserted = $2, rows_skipped = $3 WHERE import_id = $1',
        [importId, inserted, skipped]);
      const det = await client.query('SELECT detect_subscriptions($1) AS n', [accountId]);
      return { importId, inserted, duplicates, skipped, subscriptions: det.rows[0].n };
    });

    const summary = { inserted: result.inserted, duplicates: result.duplicates, credits, invalid: errors.length, errors: errors.slice(0, 50) };
    await raw.updateOne({ _id: mongoId }, { $set: { status: 'imported', import_id: result.importId, result: summary } });
    return {
      importId: result.importId,
      mongoId: mongoId.toHexString(),
      profile: profile.code,
      bank: profile.bank,
      total: records.length,
      inserted: result.inserted,
      duplicates: result.duplicates,
      credits,
      invalid: errors.length,
      errors: errors.slice(0, 10),
      subscriptions: result.subscriptions,
    };
  } catch (e) {
    await raw.updateOne({ _id: mongoId }, { $set: { status: 'failed', active: false, error: e.message } });
    throw e;
  }
}
