/**
 * OpenAI-compatible embedding client for code indexing.
 * Uses fetch, batch processing, and retry with exponential backoff.
 */

import { EMBEDDING_BATCH_SIZE } from './constants.ts';

interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

function getEmbeddingConfig(): {
  baseUrl: string;
  model: string;
  apiKey: string;
  dimensions: number;
  batchSize: number;
} {
  const provider = process.env.CODE_INDEX_EMBEDDING_PROVIDER ?? 'openrouter';
  const baseUrl =
    process.env.CODE_INDEX_EMBEDDING_BASE_URL ??
    (provider === 'scaleway' ? 'https://api.scaleway.ai/v1' : 'https://openrouter.ai/api/v1');
  const model =
    process.env.CODE_INDEX_EMBEDDING_MODEL ??
    (provider === 'scaleway' ? 'qwen3-embedding-8b' : 'openai/text-embedding-3-small');
  const apiKey = process.env.CODE_INDEX_EMBEDDING_API_KEY ?? '';
  const dimensions = parseInt(process.env.CODE_INDEX_EMBEDDING_DIMENSIONS ?? '1536', 10) || 1536;
  const batchSize =
    parseInt(process.env.CODE_INDEX_EMBEDDING_BATCH_SIZE ?? '', 10) || EMBEDDING_BATCH_SIZE;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    model,
    apiKey,
    dimensions: Number.isFinite(dimensions) ? dimensions : 1536,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : EMBEDDING_BATCH_SIZE,
  };
}

let cachedConfig: ReturnType<typeof getEmbeddingConfig> | null = null;

function getConfig(): ReturnType<typeof getEmbeddingConfig> {
  if (!cachedConfig) {
    cachedConfig = getEmbeddingConfig();
  }
  return cachedConfig;
}

/**
 * Embed a single text.
 */
export async function embedOne(text: string): Promise<number[]> {
  const results = await embedBatch([text]);
  return results[0];
}

/**
 * Embed multiple texts in batches. Preserves order.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const { batchSize } = getConfig();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await callEmbeddingApi(batch);
    results.push(...embeddings);
  }

  return results;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function callEmbeddingApi(texts: string[], attempt = 0): Promise<number[][]> {
  const { baseUrl, model, apiKey, dimensions } = getConfig();

  if (!apiKey) {
    throw new Error('CODE_INDEX_EMBEDDING_API_KEY is not set');
  }

  const body: Record<string, unknown> = {
    input: texts,
    model,
  };

  // Matryoshka: only send dimensions when not the default (avoid unnecessary truncation)
  // text-embedding-3-small default 1536, qwen3-embedding-8b default 4096
  if (dimensions !== 1536 && dimensions !== 4096) {
    body.dimensions = dimensions;
  }

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://faktenforum.org',
        'X-Title': 'mcp-linux Code Index',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as EmbeddingResponse;
    return (data.data ?? [])
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } catch (err) {
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = RETRY_DELAYS[attempt];
      console.warn(
        `[EmbeddingService] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`,
        (err as Error).message,
      );
      await new Promise((r) => setTimeout(r, delay));
      return callEmbeddingApi(texts, attempt + 1);
    }
    throw err;
  }
}

/**
 * Returns the embedding dimension used by the configured model.
 */
export function getEmbeddingDimensions(): number {
  return getConfig().dimensions;
}

/**
 * Returns true if embedding is configured (API key set and code index enabled).
 */
export function isEmbeddingConfigured(): boolean {
  if (process.env.CODE_INDEX_ENABLED === 'false') {
    return false;
  }
  return Boolean(process.env.CODE_INDEX_EMBEDDING_API_KEY);
}
