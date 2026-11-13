// Sentence embeddings with all-MiniLM-L6-v2 (384 dimensions), run locally on the CPU.
// Vectors are L2-normalised, so cosine distance (pgvector <=>) is the natural metric.
import path from 'node:path';
import { pipeline, env } from '@xenova/transformers';

env.cacheDir = path.join(process.cwd(), '.cache', 'transformers');

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

function extractor() {
  if (!globalThis.__mgEmbedder) {
    globalThis.__mgEmbedder = pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true }).catch((e) => {
      globalThis.__mgEmbedder = undefined;
      throw e;
    });
  }
  return globalThis.__mgEmbedder;
}

/** pgvector literal: '[0.1,0.2,...]' */
export const toPgVector = (arr) => '[' + Array.from(arr, (x) => x.toFixed(6)).join(',') + ']';

/**
 * Text that is embedded for a transaction: its normalised merchant key (from the SQL function
 * normalize_merchant, e.g. "SQ *COFFEE4821" -> "coffee"). Reference numbers and card masks
 * carry no meaning and would only add noise to the vector.
 */
export function transactionText(description, merchantKey) {
  return merchantKey && merchantKey.trim() ? merchantKey : description.toLowerCase();
}

/** Embed many strings in batches; returns pgvector literals in the same order. */
export async function embedMany(texts, batchSize = 32) {
  const model = await extractor();
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await model(batch, { pooling: 'mean', normalize: true });
    for (let j = 0; j < batch.length; j++) {
      out.push(toPgVector(res.data.subarray(j * EMBEDDING_DIM, (j + 1) * EMBEDDING_DIM)));
    }
  }
  return out;
}

export async function embed(text) {
  return (await embedMany([text]))[0];
}
