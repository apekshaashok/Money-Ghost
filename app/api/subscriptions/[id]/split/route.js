import { pool } from '../../../../../lib/db.js';
import { route, readJson, loadSubscription, toInt, HttpError } from '../../../../../lib/api.js';

// PUT /api/subscriptions/:id/split { shares: [{ userId, percent }] } -> set_split() (all-or-nothing)
export const PUT = route(async ({ req, params, session }) => {
  const sub = await loadSubscription(session, params.id, 'write');
  const { shares = [] } = await readJson(req);
  if (!Array.isArray(shares)) throw new HttpError(400, 'shares must be a list.');
  const { rows } = await pool.query('SELECT set_split($1, $2::int[], $3::numeric[]) AS people',
    [sub.sub_id, shares.map((s) => toInt(s.userId, 'user')), shares.map((s) => Number(s.percent))]);
  return { people: rows[0].people };
});

export const dynamic = 'force-dynamic';
