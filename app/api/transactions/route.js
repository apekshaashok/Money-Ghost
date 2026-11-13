import { pool } from '../../../lib/db.js';
import { route, resolveAccount } from '../../../lib/api.js';

// GET /api/transactions?account=1&q=net&category=3&from=2026-01-01&to=...&page=1
export const GET = route(async ({ url, session }) => {
  const { accountId, level } = await resolveAccount(session, url);
  const p = url.searchParams;
  const date = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(p.get(k) || '') ? p.get(k) : null);
  const category = Number(p.get('category')) || null;
  const page = Math.max(1, Number(p.get('page')) || 1);
  const pageSize = 25;
  const text = (p.get('q') || '').trim().slice(0, 100) || null;

  const { rows } = await pool.query(
    `SELECT t.txn_id, t.txn_date, t.raw_description, t.merchant_key, t.amount, t.category_id, c.name AS category,
            COUNT(*) OVER () AS total_rows
     FROM transactions t LEFT JOIN categories c USING (category_id)
     WHERE t.account_id = $1
       AND ($2::text IS NULL OR t.raw_description ILIKE '%' || $2 || '%')
       AND ($3::int  IS NULL OR t.category_id = $3)
       AND ($4::date IS NULL OR t.txn_date >= $4)
       AND ($5::date IS NULL OR t.txn_date <= $5)
     ORDER BY t.txn_date DESC, t.txn_id DESC
     LIMIT $6 OFFSET $7`,
    [accountId, text, category, date('from'), date('to'), pageSize, (page - 1) * pageSize]);
  return { level, page, pageSize, total: rows[0]?.total_rows ?? 0, rows: rows.map(({ total_rows, ...r }) => r) };
});

export const dynamic = 'force-dynamic';
