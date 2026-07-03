import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageResultContent } from './image-gen.ts';

const DATA_URL = 'data:image/png;base64,AAAB';

test('imageResultContent: attaches cost to _meta when reported', () => {
  const result = imageResultContent(DATA_URL, 0.0387, 'google/gemini-2.5-flash-image');
  assert.equal(result.content[0]?.type, 'text');
  assert.equal(result.content[1]?.type, 'image');
  assert.deepEqual(result._meta, {
    cost: { usd: 0.0387, model: 'google/gemini-2.5-flash-image', provider: 'openrouter' },
  });
});

test('imageResultContent: no _meta when cost is undefined', () => {
  const result = imageResultContent(DATA_URL, undefined, 'black-forest-labs/flux.2-pro');
  assert.equal(result._meta, undefined);
});

test('imageResultContent: no _meta when cost is zero', () => {
  const result = imageResultContent(DATA_URL, 0, 'black-forest-labs/flux.2-pro');
  assert.equal(result._meta, undefined);
});
