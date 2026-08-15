const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.IP_HASH_SALT = 'test-salt';

const { handler } = require('./submit-character.js');

function mockFetchSequence(responses) {
  let call = 0;
  global.fetch = async () => {
    const r = responses[call];
    call += 1;
    return {
      ok: r.ok !== false,
      status: r.ok === false ? 500 : 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body)
    };
  };
}

const validEvent = {
  httpMethod: 'POST',
  headers: { 'x-forwarded-for': '1.2.3.4' },
  body: JSON.stringify({
    title: 'my guy',
    message: 'hi',
    imageDataUrl: 'data:image/png;base64,' + Buffer.from('img').toString('base64')
  })
};

test('rejects non-POST requests', async () => {
  const res = await handler({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('rejects an invalid title', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ title: '', imageDataUrl: 'data:image/png;base64,AA' })
  });
  assert.equal(res.statusCode, 400);
});

test('inserts a pending row on valid input under the rate limit', async () => {
  mockFetchSequence([
    { body: [] },
    { body: [{ id: 'new-id' }] }
  ]);
  const res = await handler(validEvent);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).id, 'new-id');
});

test('returns 429 when the rate limit is exceeded', async () => {
  mockFetchSequence([
    { body: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }] }
  ]);
  const res = await handler(validEvent);
  assert.equal(res.statusCode, 429);
});
