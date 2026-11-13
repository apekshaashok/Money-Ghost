// npm run db:setup
// Creates (or re-creates) everything: PostgreSQL schema, MongoDB collections,
// bank profiles, the embedding model cache and the category embeddings.
import fs from 'node:fs';
import path from 'node:path';
import { pool, mongo, closeMongo } from '../lib/db.js';
import { embedMany, EMBEDDING_MODEL } from '../lib/embed.js';
import { BANK_PROFILES } from './bank-profiles.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SQL_FILES = ['01_schema.sql', '02_functions_triggers.sql', '03_views.sql', '04_reference_data.sql'];

async function setupPostgres() {
  for (const f of SQL_FILES) {
    const sql = fs.readFileSync(path.join(root, 'database', f), 'utf8');
    await pool.query(sql);
    console.log(`  postgres: ran ${f}`);
  }
}

async function setupMongo() {
  const db = await mongo();
  for (const name of ['raw_statements', 'bank_profiles', 'activity_log' /* left over from old versions */]) {
    await db.collection(name).drop().catch(() => {});
  }

  // Raw statements: flexible content (records keep each bank's own field names),
  // but the envelope is validated by MongoDB itself.
  await db.createCollection('raw_statements', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['user_id', 'account_id', 'filename', 'file_hash', 'format', 'bank_profile', 'row_count', 'records', 'status', 'uploaded_at'],
        properties: {
          user_id: { bsonType: ['int', 'long'], minimum: 1 },
          account_id: { bsonType: ['int', 'long'], minimum: 1 },
          filename: { bsonType: 'string', minLength: 1, maxLength: 255 },
          file_hash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
          format: { enum: ['csv', 'json'] },
          bank_profile: { bsonType: 'string' },
          row_count: { bsonType: ['int', 'long'], minimum: 0 },
          records: { bsonType: 'array' },
          status: { enum: ['processing', 'imported', 'failed', 'undone'] },
          import_id: { bsonType: ['int', 'long'] },
          uploaded_at: { bsonType: 'date' },
        },
      },
    },
    validationAction: 'error',
  });
  await db.collection('raw_statements').createIndexes([
    { key: { user_id: 1, uploaded_at: -1 }, name: 'by_user_recent' },
    { key: { account_id: 1, file_hash: 1 }, name: 'one_active_copy_per_file', unique: true, partialFilterExpression: { active: true } },
    { key: { bank_profile: 1, status: 1 }, name: 'by_profile_status' },
  ]);

  await db.createCollection('bank_profiles', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['code', 'bank', 'format', 'columns', 'date_format'],
        properties: {
          code: { bsonType: 'string', pattern: '^[a-z0-9_]{3,40}$' },
          bank: { bsonType: 'string', minLength: 2 },
          format: { enum: ['csv', 'json'] },
          match_headers: { bsonType: 'array', items: { bsonType: 'string' } },
          records_path: { bsonType: 'string' },
          columns: { bsonType: 'object', required: ['date', 'description'] },
          date_format: { enum: ['auto', 'ISO', 'DD/MM/YY', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'DD MMM YYYY'] },
        },
      },
    },
  });
  await db.collection('bank_profiles').createIndex({ code: 1 }, { unique: true, name: 'unique_code' });
  await db.collection('bank_profiles').insertMany(BANK_PROFILES.map((p) => ({ ...p, created_at: new Date() })));

  console.log(`  mongo: raw_statements, bank_profiles (${BANK_PROFILES.length} profiles)`);
}

async function ensureModel() {
  // The model is downloaded once into .cache/transformers (retries on HTTP 429 rate limits).
  const dir = path.join(root, '.cache', 'transformers', ...EMBEDDING_MODEL.split('/'));
  const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
  for (const f of files) {
    const dest = path.join(dir, f);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`https://huggingface.co/${EMBEDDING_MODEL}/resolve/main/${f}`);
      if (res.ok) {
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        break;
      }
      if (attempt >= 8) throw new Error(`Could not download ${f}: HTTP ${res.status}`);
      console.log(`  model: ${f} -> HTTP ${res.status}, retrying in ${attempt * 5}s`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  console.log(`  model: ${EMBEDDING_MODEL} ready`);
}

async function embedCategoryExamples() {
  const { rows } = await pool.query('SELECT example_id, example_text FROM category_examples ORDER BY example_id');
  const vectors = await embedMany(rows.map((r) => r.example_text));
  await pool.query(
    `UPDATE category_examples e SET embedding = v.emb::vector
     FROM unnest($1::int[], $2::text[]) AS v(id, emb) WHERE e.example_id = v.id`,
    [rows.map((r) => r.example_id), vectors]);
  console.log(`  pgvector: embedded ${rows.length} labelled example merchants`);
}

try {
  console.log('Setting up Money Ghosts databases...');
  await setupPostgres();
  await setupMongo();
  await ensureModel();
  await embedCategoryExamples();
  console.log('Done. Next: npm run db:seed (demo data) and npm run dev');
} catch (e) {
  console.error('Setup failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
  await closeMongo();
}
