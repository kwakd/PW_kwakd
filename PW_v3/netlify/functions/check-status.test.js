const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const { handler } = require('./check-status.js');

function mockFetchOnce(body) {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  });
}

test('rejects non-GET requests', async () => {
  const res = await handler({ httpMethod: 'POST', queryStringParameters: {} });
  assert.equal(res.statusCode, 405);
});

test('rejects a missing id', async () => {
  const res = await handler({ httpMethod: 'GET', queryStringParameters: {} });
  assert.equal(res.statusCode, 400);
});

test('returns 404 when the id does not exist', async () => {
  mockFetchOnce([]);
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { id: 'missing' } });
  assert.equal(res.statusCode, 404);
});

test('returns the status for a known id', async () => {
  mockFetchOnce([{ status: 'pending' }]);
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { id: 'abc' } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'pending');
});
