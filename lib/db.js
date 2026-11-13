// Database clients. All connection details come from environment variables (.env.local).
import pg from 'pg';
import { MongoClient } from 'mongodb';

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);              // DATE    -> 'YYYY-MM-DD' (no timezone shift)
types.setTypeParser(1700, (v) => parseFloat(v));  // NUMERIC -> number (money fits in a double)
types.setTypeParser(20, (v) => parseInt(v, 10));  // BIGINT  -> number (ids, COUNT(*))

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local.`);
  return v;
}

function getPool() {
  if (!globalThis.__mgPool) {
    globalThis.__mgPool = new Pool({ connectionString: env('DATABASE_URL'), max: 10 });
  }
  return globalThis.__mgPool;
}

/** Thin wrapper so callers can write pool.query(...) without creating the pool at import time. */
export const pool = {
  query: (text, params) => getPool().query(text, params),
  connect: () => getPool().connect(),
  end: () => globalThis.__mgPool?.end().then(() => { globalThis.__mgPool = undefined; }),
};

/** Run fn(client) inside BEGIN ... COMMIT; any error rolls the whole thing back. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** MongoDB database handle (document store for raw statements and bank profiles). */
export async function mongo() {
  if (!globalThis.__mgMongo) {
    globalThis.__mgMongo = new MongoClient(env('MONGODB_URI')).connect().catch((e) => {
      globalThis.__mgMongo = undefined;
      throw e;
    });
  }
  const client = await globalThis.__mgMongo;
  return client.db(env('MONGODB_DB'));
}

export async function closeMongo() {
  if (globalThis.__mgMongo) {
    const c = await globalThis.__mgMongo;
    await c.close();
    globalThis.__mgMongo = undefined;
  }
}
