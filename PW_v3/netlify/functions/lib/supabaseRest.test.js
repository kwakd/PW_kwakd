const test = require('node:test');
const assert = require('node:assert/strict');
const { insertPendingCharacter, countRecentSubmissions, getCharacterStatus } = require('./supabaseRest.js');

function mockFetchOnce(body, ok) {
  global.fetch = async () => ({
    ok: ok !== false,
    status: ok === false ? 500 : 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  });
}

const config = { url: 'https://example.supabase.co', serviceKey: 'test-key' };

test('insertPendingCharacter returns the inserted id', async () => {
  mockFetchOnce([{ id: 'abc-123' }]);
  const result = await insertPendingCharacter(config, {
    title: 't', message: 'm', imageDataUrl: 'data:image/png;base64,AA', ipHash: 'hash'
  });
  assert.equal(result.id, 'abc-123');
});

test('insertPendingCharacter throws on a non-ok response', async () => {
  mockFetchOnce({ message: 'boom' }, false);
  await assert.rejects(() => insertPendingCharacter(config, {
    title: 't', imageDataUrl: 'x', ipHash: 'h'
  }));
});

test('countRecentSubmissions returns the row count', async () => {
  mockFetchOnce([{ id: '1' }, { id: '2' }]);
  const count = await countRecentSubmissions(config, 'hash', '2026-01-01T00:00:00.000Z');
  assert.equal(count, 2);
});

test('getCharacterStatus returns null when not found', async () => {
  mockFetchOnce([]);
  const status = await getCharacterStatus(config, 'missing-id');
  assert.equal(status, null);
});

test('getCharacterStatus returns the status string', async () => {
  mockFetchOnce([{ status: 'approved' }]);
  const status = await getCharacterStatus(config, 'abc-123');
  assert.equal(status, 'approved');
});
