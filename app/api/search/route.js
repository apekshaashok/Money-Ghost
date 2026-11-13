import { pool } from '../../../lib/db.js';
import { embed } from '../../../lib/embed.js';
import { route, readJson } from '../../../lib/api.js';

// POST /api/search { q, mode: 'meaning' | 'keyword' }  - searches every account the user can see
//  meaning : vector similarity (pgvector, cosine). Score = max(similarity to the merchant,
//            0.9 x similarity to the transaction's category examples). Top 10 merchants.
//  keyword : PostgreSQL full-text search (GIN index), for comparison.
export const POST = route(async ({ req, session }) => {
  const { q, mode = 'meaning' } = await readJson(req);
  const text = String(q || '').trim().slice(0, 200);
  if (!text) return { rows: [] };
  const ids = (await pool.query('SELECT account_id FROM user_accounts WHERE user_id = $1', [session.uid])).rows.map((r) => r.account_id);

  if (mode === 'keyword') {
    const { rows } = await pool.query(
      `SELECT t.txn_date, t.raw_description, t.amount, a.name AS account, c.name AS category
       FROM transactions t JOIN accounts a USING (account_id) LEFT JOIN categories c USING (category_id)
       WHERE t.account_id = ANY($1) AND to_tsvector('simple', t.raw_description) @@ plainto_tsquery('simple', $2)
       ORDER BY t.txn_date DESC LIMIT 50`, [ids, text]);
    return { rows };
  }

  const vector = await embed(text.toLowerCase());
  const { rows } = await pool.query(
    `WITH category_match AS (
       SELECT category_id, MAX(1 - (embedding <=> $2::vector)) AS sim FROM category_examples GROUP BY category_id
     ), scored AS (
       SELECT t.account_id, t.merchant_key, t.amount, c.name AS category,
              GREATEST(1 - (t.embedding <=> $2::vector), 0.9 * COALESCE(cm.sim, 0)) AS score
       FROM transactions t
       LEFT JOIN categories c USING (category_id)
       LEFT JOIN category_match cm USING (category_id)
       WHERE t.account_id = ANY($1)
     )
     SELECT s.merchant_key, a.name AS account, MAX(s.category) AS category, COUNT(*) AS times,
            SUM(s.amount) AS total, ROUND(MAX(s.score)::numeric, 2) AS score
     FROM scored s JOIN accounts a USING (account_id)
     GROUP BY s.merchant_key, a.name
     HAVING MAX(s.score) >= 0.3
     ORDER BY score DESC, total DESC LIMIT 10`, [ids, vector]);
  return { rows };
});

export const dynamic = 'force-dynamic';
