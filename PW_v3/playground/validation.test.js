const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTitle,
  validateMessage,
  validateImageDataUrl,
  TITLE_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  IMAGE_MAX_BYTES
} = require('./validation.js');

test('validateTitle rejects empty or whitespace-only title', () => {
  assert.equal(validateTitle('').valid, false);
  assert.equal(validateTitle('   ').valid, false);
});

test('validateTitle rejects title over max length', () => {
  const longTitle = 'a'.repeat(TITLE_MAX_LENGTH + 1);
  assert.equal(validateTitle(longTitle).valid, false);
});

test('validateTitle accepts a normal title', () => {
  assert.equal(validateTitle('my little guy').valid, true);
});

test('validateMessage accepts empty or undefined message', () => {
  assert.equal(validateMessage('').valid, true);
  assert.equal(validateMessage(undefined).valid, true);
});

test('validateMessage rejects message over max length', () => {
  const longMessage = 'a'.repeat(MESSAGE_MAX_LENGTH + 1);
  assert.equal(validateMessage(longMessage).valid, false);
});

test('validateImageDataUrl rejects non-data-url strings', () => {
  assert.equal(validateImageDataUrl('not-an-image').valid, false);
});

test('validateImageDataUrl rejects an empty base64 payload', () => {
  assert.equal(validateImageDataUrl('data:image/png;base64,').valid, false);
});

test('validateImageDataUrl accepts a small valid payload', () => {
  const smallBase64 = Buffer.from('hello').toString('base64');
  assert.equal(validateImageDataUrl('data:image/png;base64,' + smallBase64).valid, true);
});

test('validateImageDataUrl rejects a payload over the byte cap', () => {
  const bigBase64 = Buffer.alloc(IMAGE_MAX_BYTES + 1000).toString('base64');
  assert.equal(validateImageDataUrl('data:image/png;base64,' + bigBase64).valid, false);
});
