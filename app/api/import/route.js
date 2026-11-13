import { pool, mongo } from '../../../lib/db.js';
import { importStatement, ImportError } from '../../../lib/importer.js';
import { route, readJson, resolveAccount, HttpError } from '../../../lib/api.js';

// GET /api/import?account=1 -> import history (PostgreSQL) + per-format summary (MongoDB aggregation)
export const GET = route(async ({ url, session }) => {
  const { accountId, level } = await resolveAccount(session, url);
  const { rows } = await pool.query(
    `SELECT i.import_id, i.filename, i.bank_profile, i.rows_total, i.rows_inserted, i.rows_skipped, i.imported_at
     FROM imports i WHERE i.account_id = $1 ORDER BY i.imported_at DESC`, [accountId]);
  const db = await mongo();
  const summary = await db.collection('raw_statements').aggregate([
    { $match: { account_id: accountId, status: 'imported' } },
    { $group: { _id: '$bank_profile', files: { $sum: 1 }, rows: { $sum: '$row_count' },
                inserted: { $sum: '$result.inserted' } } },
    { $sort: { rows: -1 } },
  ]).toArray();
  return { level, imports: rows, summary };
});

// POST /api/import?account=1 { filename, text }
export const POST = route(async ({ req, url, session }) => {
  const { accountId } = await resolveAccount(session, url, 'write');
  const { filename, text } = await readJson(req);
  try {
    return await importStatement({ userId: session.uid, accountId, filename, text });
  } catch (e) {
    if (e instanceof ImportError) throw new HttpError(e.status, e.message);
    throw e;
  }
});

export const dynamic = 'force-dynamic';
