import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterClient, extractImageUrl } from './openrouter.ts';

const DATA_URL = 'data:image/png;base64,AAAB';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub fetch, capturing the URL and request body of the last call. */
function stubFetch(
  responseBody: unknown,
  status = 200,
): { lastBody: () => Record<string, unknown>; lastUrl: () => string } {
  let captured: Record<string, unknown> = {};
  let url = '';
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    url = input;
    captured = init?.body ? JSON.parse(init.body as string) : {};
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { lastBody: () => captured, lastUrl: () => url };
}

test('extractImageUrl: builds a data URL from data[].b64_json', () => {
  assert.equal(extractImageUrl({ data: [{ b64_json: 'AAAB', media_type: 'image/png' }] }), DATA_URL);
});

test('extractImageUrl: keeps a non-PNG media type', () => {
  assert.equal(
    extractImageUrl({ data: [{ b64_json: 'AAAB', media_type: 'image/jpeg' }] }),
    'data:image/jpeg;base64,AAAB',
  );
});

test('extractImageUrl: assumes PNG when the media type is missing', () => {
  assert.equal(extractImageUrl({ data: [{ b64_json: 'AAAB' }] }), DATA_URL);
});

test('extractImageUrl: throws when no image present', () => {
  assert.throws(() => extractImageUrl({ data: [] }));
});

test('generateImage: posts to the Image API and reads usage.cost', async () => {
  const stub = stubFetch({ data: [{ b64_json: 'AAAB', media_type: 'image/png' }], usage: { cost: 0.042 } });
  const client = new OpenRouterClient('test-key');
  const result = await client.generateImage({
    prompt: 'a red square',
    model: 'black-forest-labs/flux-3-image',
  });
  assert.equal(stub.lastUrl(), 'https://openrouter.ai/api/v1/images');
  assert.deepEqual(stub.lastBody(), { model: 'black-forest-labs/flux-3-image', prompt: 'a red square' });
  assert.equal(result.imageUrl, DATA_URL);
  assert.equal(result.costUsd, 0.042);
});

test('generateImage: costUsd is undefined when no usage returned', async () => {
  stubFetch({ data: [{ b64_json: 'AAAB' }] });
  const client = new OpenRouterClient('test-key');
  const result = await client.generateImage({
    prompt: 'a red square',
    model: 'black-forest-labs/flux-3-image',
  });
  assert.equal(result.costUsd, undefined);
});

test('generateImage: sends aspect_ratio and resolution for a model that takes both', async () => {
  const stub = stubFetch({ data: [{ b64_json: 'AAAB' }] });
  const client = new OpenRouterClient('test-key');
  await client.generateImage({
    prompt: 'a landscape',
    model: 'black-forest-labs/flux-3-image',
    aspect_ratio: '16:9',
    image_size: '2K',
  });
  const body = stub.lastBody();
  assert.equal(body.aspect_ratio, '16:9');
  assert.equal(body.resolution, '2K');
});

test('generateImage: drops resolution for a model without it', async () => {
  const stub = stubFetch({ data: [{ b64_json: 'AAAB' }] });
  const client = new OpenRouterClient('test-key');
  await client.generateImage({
    prompt: 'a red square',
    model: 'openai/gpt-image-2',
    aspect_ratio: '16:9',
    image_size: '2K',
  });
  const body = stub.lastBody();
  assert.equal(body.aspect_ratio, '16:9');
  assert.equal(body.resolution, undefined);
});

test('generateImage: a 404 names the model and points to list_models', async () => {
  stubFetch({ error: { message: 'Model not found' } }, 404);
  const client = new OpenRouterClient('test-key');
  await assert.rejects(
    client.generateImage({ prompt: 'x', model: 'nobody/none' }),
    /nobody\/none.*list_models/,
  );
});
