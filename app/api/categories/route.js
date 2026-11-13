import { pool } from '../../../lib/db.js';
import { route } from '../../../lib/api.js';

export const GET = route(async () => (await pool.query('SELECT category_id, name FROM categories ORDER BY name')).rows);

export const dynamic = 'force-dynamic';
