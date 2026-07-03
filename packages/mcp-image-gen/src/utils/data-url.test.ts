import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageData } from './data-url.ts';

test('parseImageData: data URL with mime + base64', () => {
  const { data, mimeType } = parseImageData('data:image/png;base64,AAAB');
  assert.equal(data, 'AAAB');
  assert.equal(mimeType, 'image/png');
});

test('parseImageData: data URL with parameters before base64', () => {
  const { data, mimeType } = parseImageData('data:image/webp;charset=utf-8;base64,ZZZ');
  assert.equal(data, 'ZZZ');
  assert.equal(mimeType, 'image/webp');
});

test('parseImageData: raw base64 defaults to image/png', () => {
  const { data, mimeType } = parseImageData('QQQQ');
  assert.equal(data, 'QQQQ');
  assert.equal(mimeType, 'image/png');
});

test('parseImageData: malformed data URL throws', () => {
  assert.throws(() => parseImageData('data:image/png,notbase64'));
});
