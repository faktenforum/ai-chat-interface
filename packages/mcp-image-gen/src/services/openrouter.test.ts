import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterClient, extractImageUrl } from './openrouter.ts';

const DATA_URL = 'data:image/png;base64,AAAB';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub fetch, capturing the request body sent to /chat/completions. */
function stubFetch(responseBody: unknown): { lastBody: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    captured = init?.body ? JSON.parse(init.body as string) : {};
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { lastBody: () => captured };
}

test('extractImageUrl: reads message.images[]', () => {
  const url = extractImageUrl({
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }],
  });
  assert.equal(url, DATA_URL);
});

test('extractImageUrl: falls back to message.content[] image_url', () => {
  const url = extractImageUrl({
    choices: [{ message: { content: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }],
  });
  assert.equal(url, DATA_URL);
});

test('extractImageUrl: wraps a bare base64 string as a data URL', () => {
  const url = extractImageUrl({
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'ABC123' } }] } }],
  });
  assert.equal(url, 'data:image/png;base64,ABC123');
});

test('extractImageUrl: throws when no image present', () => {
  assert.throws(() => extractImageUrl({ choices: [{ message: {} }] }));
});

test('generateImage: extracts the provider cost from usage.cost', async () => {
  stubFetch({
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }],
    usage: { cost: 0.042 },
  });
  const client = new OpenRouterClient('test-key');
  const result = await client.generateImage({
    prompt: 'a red square',
    model: 'black-forest-labs/flux.2-pro',
  });
  assert.equal(result.imageUrl, DATA_URL);
  assert.equal(result.costUsd, 0.042);
});

test('generateImage: costUsd is undefined when no usage returned', async () => {
  stubFetch({
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }],
  });
  const client = new OpenRouterClient('test-key');
  const result = await client.generateImage({
    prompt: 'a red square',
    model: 'black-forest-labs/flux.2-pro',
  });
  assert.equal(result.costUsd, undefined);
});

test('generateImage: sends usage.include and image_config for a size-capable model', async () => {
  const stub = stubFetch({
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }],
    usage: { cost: 0.01 },
  });
  const client = new OpenRouterClient('test-key');
  await client.generateImage({
    prompt: 'a landscape',
    model: 'google/gemini-2.5-flash-image',
    aspect_ratio: '16:9',
    image_size: '2K',
  });
  const body = stub.lastBody();
  assert.deepEqual(body.usage, { include: true });
  assert.deepEqual(body.image_config, { aspect_ratio: '16:9', image_size: '2K' });
});

test('generateImage: omits image_config for a model that supports neither option', async () => {
  const stub = stubFetch({
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }],
  });
  const client = new OpenRouterClient('test-key');
  await client.generateImage({
    prompt: 'a red square',
    model: 'black-forest-labs/flux.2-pro',
    aspect_ratio: '16:9',
    image_size: '2K',
  });
  assert.equal(stub.lastBody().image_config, undefined);
});
