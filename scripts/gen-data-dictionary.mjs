// Generates docs/DATA_DICTIONARY.md from the live PostgreSQL catalog (so it never drifts from the schema).
//   node --env-file=.env.local scripts/gen-data-dictionary.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../lib/db.js';

const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'DATA_DICTIONARY.md');
const DESCRIPTIONS = {
  users: 'Application users.',
  accounts: 'A bank account, credit card or wallet owned by one user.',
  account_members: 'Shared/family access to another user\'s account (M:N between users and accounts).',
  categories: 'Spending categories.',
  category_examples: 'Labelled example merchants with embeddings - the k-NN knowledge base for auto-categorisation.',
  imports: 'One row per uploaded statement file; links to the raw document in MongoDB.',
  transactions: 'Normalised debit transactions with merchant key, category and embedding.',
  subscriptions: 'Recurring charges found by detect_subscriptions().',
  subscription_charges: 'Which transactions belong to which subscription.',
  price_changes: 'Price history of subscriptions (trigger + detection).',
  split_shares: 'Percentage of a subscription each household member pays.',
  budgets: 'Monthly spending limit per user and category.',
};

const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.table_name);
const order = Object.keys(DESCRIPTIONS).filter((t) => tables.includes(t));
let md = '# Data dictionary\n\nGenerated from the live PostgreSQL catalog by `scripts/gen-data-dictionary.mjs`.\n' +
  'Key: **PK** primary key · **FK** foreign key · **UK** unique · **GEN** generated column.\n';

for (const t of order) {
  const cols = (await pool.query(`
    SELECT a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
           pg_get_expr(d.adbin, d.adrelid) AS def, a.attgenerated = 's' AS generated,
           (SELECT typname FROM pg_type WHERE oid = a.atttypid AND typtype = 'd') AS domain
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t])).rows;
  const cons = (await pool.query(`SELECT conname, contype, pg_get_constraintdef(oid) AS def, conkey FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype, conname`, [t])).rows;
  const attnums = Object.fromEntries((await pool.query(`SELECT attnum, attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0`, [t])).rows.map((r) => [r.attnum, r.attname]));
  const keys = {};
  const add = (c, k) => { (keys[c] ||= new Set()).add(k); };
  for (const c of cons) {
    const colsIn = (c.conkey || []).map((n) => attnums[n]);
    if (c.contype === 'p') colsIn.forEach((x) => add(x, 'PK'));
    if (c.contype === 'f') colsIn.forEach((x) => add(x, 'FK → ' + c.def.match(/REFERENCES (\w+)/)[1]));
    if (c.contype === 'u') colsIn.forEach((x) => add(x, colsIn.length > 1 ? `UK (${colsIn.join(', ')})` : 'UK'));
  }
  md += `\n## ${t}\n\n${DESCRIPTIONS[t]}\n\n| Column | Type | Null | Default | Keys |\n|---|---|---|---|---|\n`;
  for (const c of cols) {
    const def = c.generated ? `GEN: \`${c.def}\`` : c.def ? `\`${c.def}\`` : '';
    md += `| ${c.col} | ${c.domain ? `${c.domain} (domain)` : c.type} | ${c.notnull ? 'NOT NULL' : 'null'} | ${def.replace(/\|/g, '\\|')} | ${[...(keys[c.col] || [])].join(', ')} |\n`;
  }
  const checks = cons.filter((c) => c.contype === 'c');
  if (checks.length) {
    md += '\n**CHECK constraints**\n\n';
    for (const c of checks) md += `- \`${c.conname}\`: \`${c.def.replace(/\|/g, '\\|')}\`\n`;
  }
  const trg = (await pool.query(`SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal`, [t])).rows;
  if (trg.length) {
    md += '\n**Triggers**\n\n';
    for (const x of trg) md += `- \`${x.tgname}\`: ${x.def.replace(/^CREATE TRIGGER \w+ /, '')}\n`;
  }
}
const idx = (await pool.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname`)).rows;
md += '\n## Indexes\n\n| Table | Index | Definition |\n|---|---|---|\n';
for (const i of idx) md += `| ${i.tablename} | ${i.indexname} | \`${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX \w+ ON public\.\w+ /, '$1')}\` |\n`;
const views = (await pool.query(`SELECT table_name FROM information_schema.views WHERE table_schema='public' ORDER BY 1`)).rows.map((r) => r.table_name);
md += `\n## Views\n\n${views.map((v) => `- \`${v}\``).join('\n')}\n`;
const fns = (await pool.query(`SELECT p.proname, p.prokind, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS res
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname !~ '^(vector|halfvec|sparsevec|gin|gtrgm|similarity|word_similarity|strict_word|show_|set_limit|show_limit|citext|texticlike|texticnlike|texticregex|texticnregex|regexp_|split_part|strpos|translate|replace|l2_|l1_|cosine|inner_product|hamming|jaccard|ivf|hnsw|array_to|avg|sum|subvector|binary_quantize|max|min|bit_|hnswhandler|ivfflat)' AND p.proname NOT LIKE '%trgm%' AND p.proname NOT LIKE '%citext%' AND p.proname NOT LIKE '%vector%' AND p.proname NOT LIKE '%halfvec%' ORDER BY p.prokind DESC, p.proname`)).rows;
md += '\n## Functions, procedures and trigger functions\n\n| Name | Kind | Arguments | Returns |\n|---|---|---|---|\n';
for (const f of fns) md += `| ${f.proname} | ${f.prokind === 'p' ? 'procedure' : 'function'} | ${f.args || '—'} | ${f.res || '—'} |\n`;
fs.writeFileSync(out, md);
console.log(`Wrote ${out} (${order.length} tables, ${idx.length} indexes, ${fns.length} routines)`);
await pool.end();
