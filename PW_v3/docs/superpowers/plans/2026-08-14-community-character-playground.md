# Community Character Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gat-cha fish `iframe-wrapper` in the playground section of `index.html` with a draw-and-submit character feature: visitors draw a character on a fixed body template, submit it for manual review, and approved characters wander around the same display box, reacting to hover/click.

**Architecture:** Static frontend (plain `<script>` files, no bundler) talks to a Supabase Postgres table (`characters`) either directly (approved-only reads, via RLS + the public anon key) or through two Netlify Functions (`submit-character`, `check-status`) that use the service-role key for writes and rate limiting. Moderation happens by hand in Supabase's Table Editor.

**Tech Stack:** Vanilla JS/CSS (matches the rest of the site), Node.js built-ins only (`node:test`, `node:assert/strict`, global `fetch`) for functions and unit tests — no npm dependencies, no `package.json`. Supabase (Postgres + PostgREST) as the database. Netlify Functions for the two server endpoints.

**Spec:** `docs/superpowers/specs/2026-08-14-community-character-playground-design.md`

## Global Constraints

- Title cap: 60 characters, required. Message cap: 280 characters, optional.
- Image payload cap: 150,000 bytes (~150KB) of base64 PNG data.
- Rate limit: 5 submissions per `ip_hash` per rolling hour.
- Gallery shows at most the 50 most-recently-approved characters.
- No build step, no bundler, no npm dependencies anywhere in this feature — plain `<script>` tags in the browser, plain Node built-ins (`node:test`, global `fetch`) on the server and in tests.
- The feature lives inside the existing playground section of `index.html` — no new page.
- Moderation is manual via Supabase's Table Editor — no admin UI is in scope.
- Canvas internal resolution is 180×180px; the fixed guide (body square, eyes, smile, arm/leg lines) is inset 30px from each edge, leaving margin for extras.

---

## File Structure

**Create:**
- `supabase/schema.sql` — table + RLS policies, run manually in the Supabase SQL Editor.
- `playground/validation.js` — pure validation rules (title/message/image), used by both the browser and `submit-character`.
- `playground/validation.test.js`
- `playground/wander.js` — pure motion math for the gallery's wandering characters.
- `playground/wander.test.js`
- `playground/config.js` — public Supabase URL/anon key + function endpoint paths.
- `playground/canvas.js` — the two-layer drawing canvas (guide + drawing surface), tools, export.
- `playground/submit.js` — submit form wiring, `localStorage` pending-state tracking, status polling.
- `playground/gallery.js` — fetches approved characters, animates them wandering, hover/click.
- `netlify/functions/lib/supabaseRest.js` — thin PostgREST wrapper used by both functions.
- `netlify/functions/lib/supabaseRest.test.js`
- `netlify/functions/submit-character.js`
- `netlify/functions/submit-character.test.js`
- `netlify/functions/check-status.js`
- `netlify/functions/check-status.test.js`
- `netlify.toml` — points Netlify at the functions directory.

**Modify:**
- `index.html` — replace the playground section's `.game-embed`/`.iframe-wrapper` block with the new markup; add the new `<script>` tags.
- `style.css` — append a new `PLAYGROUND` section. (Do **not** touch the existing `.iframe-wrapper`/`.game-embed`/`.game-thumb` rules — `project-html/project-glhf_gf.html` and `project-html/project-glhf_bm.html` still use them.)

---

## Task 1: Supabase schema

**Files:**
- Create: `supabase/schema.sql`

**Interfaces:**
- Produces: a `characters` table with columns `id, created_at, title, message, image_data, status, ip_hash`, readable by `anon` only where `status = 'approved'`. Every later backend task depends on this schema existing in a real Supabase project.

- [ ] **Step 1: Write the schema file**

```sql
-- Community Character Playground schema.
-- Run this once in your Supabase project's SQL Editor
-- (Database > SQL Editor > New query > paste > Run).

create extension if not exists pgcrypto;

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  message text,
  image_data text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  ip_hash text not null
);

alter table characters enable row level security;

-- Public (anon key) reads are restricted to approved rows only.
-- Pending/rejected rows -- and their image/title/message -- are invisible
-- to anyone without the service_role key.
create policy "public can read approved characters"
  on characters for select
  to anon
  using (status = 'approved');

-- No insert/update/delete policy is granted to anon. All writes go
-- through the submit-character Netlify Function, which authenticates
-- with the service_role key and therefore bypasses RLS entirely.
```

- [ ] **Step 2: Run it manually in Supabase**

In your Supabase project dashboard: SQL Editor → New query → paste the contents of `supabase/schema.sql` → Run.

- [ ] **Step 3: Verify manually**

In the same SQL Editor, run:

```sql
insert into characters (title, image_data, ip_hash)
values ('test', 'data:image/png;base64,AAAA', 'testhash');

select id, status from characters;
```

Confirm one row comes back with `status = 'pending'`. Then, using your project's `SUPABASE_URL` and public **anon** key (Project Settings → API), run:

```bash
curl "https://YOUR-PROJECT.supabase.co/rest/v1/characters?select=id,status" \
  -H "apikey: YOUR-ANON-KEY" \
  -H "Authorization: Bearer YOUR-ANON-KEY"
```

Expected: `[]` (the pending row is invisible to the anon key). Then in the SQL Editor:

```sql
update characters set status = 'approved' where title = 'test';
```

Re-run the same `curl` command. Expected: the row now appears. Finally, clean up your test row:

```sql
delete from characters where title = 'test';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add Supabase schema for community character playground"
```

---

## Task 2: Shared validation rules

**Files:**
- Create: `playground/validation.js`
- Test: `playground/validation.test.js`

**Interfaces:**
- Produces (used by Task 5's `submit-character.js` and Task 10's `submit.js`): `validateTitle(title) -> {valid, error?}`, `validateMessage(message) -> {valid, error?}`, `validateImageDataUrl(dataUrl) -> {valid, error?}`, plus constants `TITLE_MAX_LENGTH`, `MESSAGE_MAX_LENGTH`, `IMAGE_MAX_BYTES`. In Node, these are `module.exports`; in the browser, `window.PlaygroundValidation`.

- [ ] **Step 1: Write the failing test**

Create `playground/validation.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test playground/validation.test.js`
Expected: FAIL (cannot find module `./validation.js`).

- [ ] **Step 3: Write the implementation**

Create `playground/validation.js`:

```js
// playground/validation.js
// Pure validation rules shared by the browser (submit.js) and the
// submit-character Netlify Function. No DOM, no network.
(function (exports) {
  var TITLE_MAX_LENGTH = 60;
  var MESSAGE_MAX_LENGTH = 280;
  var IMAGE_MAX_BYTES = 150000;
  var IMAGE_DATA_URL_PREFIX = 'data:image/png;base64,';

  function validateTitle(title) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      return { valid: false, error: 'Title is required.' };
    }
    if (title.length > TITLE_MAX_LENGTH) {
      return { valid: false, error: 'Title must be ' + TITLE_MAX_LENGTH + ' characters or fewer.' };
    }
    return { valid: true };
  }

  function validateMessage(message) {
    if (message === undefined || message === null || message === '') {
      return { valid: true };
    }
    if (typeof message !== 'string') {
      return { valid: false, error: 'Message must be text.' };
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
      return { valid: false, error: 'Message must be ' + MESSAGE_MAX_LENGTH + ' characters or fewer.' };
    }
    return { valid: true };
  }

  function base64ByteLength(base64) {
    var len = base64.length;
    var padding = 0;
    if (base64.slice(-2) === '==') padding = 2;
    else if (base64.slice(-1) === '=') padding = 1;
    return (len / 4) * 3 - padding;
  }

  function validateImageDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf(IMAGE_DATA_URL_PREFIX) !== 0) {
      return { valid: false, error: 'Image must be a PNG data URL.' };
    }
    var base64 = dataUrl.slice(IMAGE_DATA_URL_PREFIX.length);
    if (base64.length === 0) {
      return { valid: false, error: 'Image data is empty.' };
    }
    if (base64ByteLength(base64) > IMAGE_MAX_BYTES) {
      return { valid: false, error: 'Image is too large.' };
    }
    return { valid: true };
  }

  exports.TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
  exports.MESSAGE_MAX_LENGTH = MESSAGE_MAX_LENGTH;
  exports.IMAGE_MAX_BYTES = IMAGE_MAX_BYTES;
  exports.validateTitle = validateTitle;
  exports.validateMessage = validateMessage;
  exports.validateImageDataUrl = validateImageDataUrl;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.PlaygroundValidation = {}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test playground/validation.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add playground/validation.js playground/validation.test.js
git commit -m "Add shared validation rules for character submissions"
```

---

## Task 3: Wander motion math

**Files:**
- Create: `playground/wander.js`
- Test: `playground/wander.test.js`

**Interfaces:**
- Produces (used by Task 11's `gallery.js`): `createWanderState(x, y, speed) -> {x, y, vx, vy, speed, nextTurnAt}`, `stepPosition(state, bounds, dtMs, now, rand?) -> {x, y, vx, vy, speed, nextTurnAt}` where `bounds = {width, height, entitySize}`. In Node, `module.exports`; in the browser, `window.PlaygroundWander`.

- [ ] **Step 1: Write the failing test**

Create `playground/wander.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWanderState, stepPosition } = require('./wander.js');

test('createWanderState starts at the given position', () => {
  const state = createWanderState(10, 20, 0.05);
  assert.equal(state.x, 10);
  assert.equal(state.y, 20);
  assert.equal(state.speed, 0.05);
});

test('stepPosition moves the entity by velocity * dt', () => {
  const state = { x: 10, y: 10, vx: 1, vy: 0, speed: 1, nextTurnAt: Infinity };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const next = stepPosition(state, bounds, 5, 0);
  assert.equal(next.x, 15);
  assert.equal(next.y, 10);
});

test('stepPosition bounces off the right edge', () => {
  const state = { x: 75, y: 10, vx: 10, vy: 0, speed: 10, nextTurnAt: Infinity };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const next = stepPosition(state, bounds, 1, 0);
  assert.equal(next.x, 80);
  assert.ok(next.vx < 0);
});

test('stepPosition bounces off the left edge', () => {
  const state = { x: 2, y: 10, vx: -10, vy: 0, speed: 10, nextTurnAt: Infinity };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const next = stepPosition(state, bounds, 1, 0);
  assert.equal(next.x, 0);
  assert.ok(next.vx > 0);
});

test('stepPosition picks a new direction once nextTurnAt has passed', () => {
  const state = { x: 10, y: 10, vx: 1, vy: 0, speed: 1, nextTurnAt: 100 };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const fixedRand = () => 0;
  const next = stepPosition(state, bounds, 1, 150, fixedRand);
  assert.equal(next.vx, 1);
  assert.equal(next.vy, 0);
  assert.ok(next.nextTurnAt > 150);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test playground/wander.test.js`
Expected: FAIL (cannot find module `./wander.js`).

- [ ] **Step 3: Write the implementation**

Create `playground/wander.js`:

```js
// playground/wander.js
// Pure motion logic for the gallery's wandering characters. No DOM.
(function (exports) {
  function createWanderState(x, y, speed) {
    var angle = Math.random() * Math.PI * 2;
    return {
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed: speed,
      nextTurnAt: Date.now() + 1500 + Math.random() * 2500
    };
  }

  function stepPosition(state, bounds, dtMs, now, rand) {
    rand = rand || Math.random;
    var maxX = bounds.width - bounds.entitySize;
    var maxY = bounds.height - bounds.entitySize;

    var x = state.x + state.vx * dtMs;
    var y = state.y + state.vy * dtMs;
    var vx = state.vx;
    var vy = state.vy;

    if (x < 0) { x = 0; vx = Math.abs(vx); }
    else if (x > maxX) { x = maxX; vx = -Math.abs(vx); }

    if (y < 0) { y = 0; vy = Math.abs(vy); }
    else if (y > maxY) { y = maxY; vy = -Math.abs(vy); }

    var nextTurnAt = state.nextTurnAt;
    if (now >= nextTurnAt) {
      var angle = rand() * Math.PI * 2;
      vx = Math.cos(angle) * state.speed;
      vy = Math.sin(angle) * state.speed;
      nextTurnAt = now + 1500 + rand() * 2500;
    }

    return { x: x, y: y, vx: vx, vy: vy, speed: state.speed, nextTurnAt: nextTurnAt };
  }

  exports.createWanderState = createWanderState;
  exports.stepPosition = stepPosition;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.PlaygroundWander = {}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test playground/wander.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add playground/wander.js playground/wander.test.js
git commit -m "Add wander motion math for gallery characters"
```

---

## Task 4: Supabase REST helper

**Files:**
- Create: `netlify/functions/lib/supabaseRest.js`
- Test: `netlify/functions/lib/supabaseRest.test.js`

**Interfaces:**
- Consumes: `config = {url, serviceKey}`.
- Produces (used by Task 5 and Task 6): `insertPendingCharacter(config, {title, message, imageDataUrl, ipHash}) -> Promise<{id}>`, `countRecentSubmissions(config, ipHash, sinceIso) -> Promise<number>`, `getCharacterStatus(config, id) -> Promise<string|null>`. Exported via `module.exports`.

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/lib/supabaseRest.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test netlify/functions/lib/supabaseRest.test.js`
Expected: FAIL (cannot find module `./supabaseRest.js`).

- [ ] **Step 3: Write the implementation**

Create `netlify/functions/lib/supabaseRest.js`:

```js
// netlify/functions/lib/supabaseRest.js
// Thin wrapper around Supabase's PostgREST API using the service_role
// key. Server-side only -- never expose SUPABASE_SERVICE_ROLE_KEY to
// the browser.

async function insertPendingCharacter(config, data) {
  var res = await fetch(config.url + '/rest/v1/characters', {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: 'Bearer ' + config.serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      title: data.title,
      message: data.message || null,
      image_data: data.imageDataUrl,
      ip_hash: data.ipHash,
      status: 'pending'
    })
  });
  if (!res.ok) {
    throw new Error('Supabase insert failed: ' + res.status + ' ' + (await res.text()));
  }
  var rows = await res.json();
  return { id: rows[0].id };
}

async function countRecentSubmissions(config, ipHash, sinceIso) {
  var url = config.url + '/rest/v1/characters?select=id&ip_hash=eq.' +
    encodeURIComponent(ipHash) + '&created_at=gte.' + encodeURIComponent(sinceIso);
  var res = await fetch(url, {
    headers: {
      apikey: config.serviceKey,
      Authorization: 'Bearer ' + config.serviceKey
    }
  });
  if (!res.ok) {
    throw new Error('Supabase count failed: ' + res.status + ' ' + (await res.text()));
  }
  var rows = await res.json();
  return rows.length;
}

async function getCharacterStatus(config, id) {
  var url = config.url + '/rest/v1/characters?select=status&id=eq.' + encodeURIComponent(id);
  var res = await fetch(url, {
    headers: {
      apikey: config.serviceKey,
      Authorization: 'Bearer ' + config.serviceKey
    }
  });
  if (!res.ok) {
    throw new Error('Supabase status lookup failed: ' + res.status + ' ' + (await res.text()));
  }
  var rows = await res.json();
  if (rows.length === 0) return null;
  return rows[0].status;
}

module.exports = { insertPendingCharacter, countRecentSubmissions, getCharacterStatus };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test netlify/functions/lib/supabaseRest.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/lib/supabaseRest.js netlify/functions/lib/supabaseRest.test.js
git commit -m "Add Supabase REST helper for Netlify Functions"
```

---

## Task 5: `submit-character` function

**Files:**
- Create: `netlify/functions/submit-character.js`
- Test: `netlify/functions/submit-character.test.js`

**Interfaces:**
- Consumes: `validateTitle`, `validateMessage`, `validateImageDataUrl` from `../../playground/validation.js`; `insertPendingCharacter`, `countRecentSubmissions` from `./lib/supabaseRest.js`; env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`.
- Produces (used by Task 10's `submit.js` over HTTP): `exports.handler(event) -> Promise<{statusCode, body}>`. POST body `{title, message?, imageDataUrl}` → `200 {id}` on success, `400 {error}` on invalid input, `429 {error}` when rate-limited, `405` for non-POST.

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/submit-character.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test netlify/functions/submit-character.test.js`
Expected: FAIL (cannot find module `./submit-character.js`).

- [ ] **Step 3: Write the implementation**

Create `netlify/functions/submit-character.js`:

```js
// netlify/functions/submit-character.js
const crypto = require('crypto');
const validation = require('../../playground/validation.js');
const { insertPendingCharacter, countRecentSubmissions } = require('./lib/supabaseRest.js');

const RATE_LIMIT_MAX_PER_HOUR = 5;

function hashIp(ip, salt) {
  return crypto.createHash('sha256').update(salt + ip).digest('hex');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  var payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON.' }) };
  }

  var titleCheck = validation.validateTitle(payload.title);
  if (!titleCheck.valid) {
    return { statusCode: 400, body: JSON.stringify({ error: titleCheck.error }) };
  }
  var messageCheck = validation.validateMessage(payload.message);
  if (!messageCheck.valid) {
    return { statusCode: 400, body: JSON.stringify({ error: messageCheck.error }) };
  }
  var imageCheck = validation.validateImageDataUrl(payload.imageDataUrl);
  if (!imageCheck.valid) {
    return { statusCode: 400, body: JSON.stringify({ error: imageCheck.error }) };
  }

  var config = {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  var salt = process.env.IP_HASH_SALT || '';

  var forwardedFor = (event.headers && event.headers['x-forwarded-for']) || '';
  var ip = forwardedFor.split(',')[0].trim() || 'unknown';
  var ipHash = hashIp(ip, salt);

  var sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  var recentCount = await countRecentSubmissions(config, ipHash, sinceIso);
  if (recentCount >= RATE_LIMIT_MAX_PER_HOUR) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many submissions. Try again later.' }) };
  }

  var result = await insertPendingCharacter(config, {
    title: payload.title,
    message: payload.message,
    imageDataUrl: payload.imageDataUrl,
    ipHash: ipHash
  });

  return { statusCode: 200, body: JSON.stringify({ id: result.id }) };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test netlify/functions/submit-character.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/submit-character.js netlify/functions/submit-character.test.js
git commit -m "Add submit-character Netlify Function"
```

---

## Task 6: `check-status` function

**Files:**
- Create: `netlify/functions/check-status.js`
- Test: `netlify/functions/check-status.test.js`

**Interfaces:**
- Consumes: `getCharacterStatus` from `./lib/supabaseRest.js`; env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces (used by Task 10's `submit.js` over HTTP): `exports.handler(event) -> Promise<{statusCode, body}>`. GET `?id=` → `200 {status}`, `404 {error}` if unknown, `400 {error}` if missing id, `405` for non-GET.

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/check-status.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test netlify/functions/check-status.test.js`
Expected: FAIL (cannot find module `./check-status.js`).

- [ ] **Step 3: Write the implementation**

Create `netlify/functions/check-status.js`:

```js
// netlify/functions/check-status.js
const { getCharacterStatus } = require('./lib/supabaseRest.js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }
  var id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id.' }) };
  }

  var config = {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };

  var status = await getCharacterStatus(config, id);
  if (status === null) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Not found.' }) };
  }
  return { statusCode: 200, body: JSON.stringify({ status: status }) };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test netlify/functions/check-status.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/check-status.js netlify/functions/check-status.test.js
git commit -m "Add check-status Netlify Function"
```

---

## Task 7: Netlify config + frontend config

**Files:**
- Create: `netlify.toml`
- Create: `playground/config.js`

**Interfaces:**
- Produces (used by Task 10's `submit.js` and Task 11's `gallery.js`): `window.PlaygroundConfig = {SUPABASE_URL, SUPABASE_ANON_KEY, SUBMIT_ENDPOINT, STATUS_ENDPOINT}`.

- [ ] **Step 1: Write `netlify.toml`**

```toml
[build]
  publish = "."
  functions = "netlify/functions"
```

- [ ] **Step 2: Write `playground/config.js`**

```js
// playground/config.js
// Public, safe-to-expose configuration. SUPABASE_ANON_KEY is
// intentionally public -- Row Level Security on the `characters` table
// (see supabase/schema.sql) restricts it to reading approved rows only.
// Replace the two placeholder values below with your real Supabase
// project's URL and anon key (Project Settings > API) before deploying.
window.PlaygroundConfig = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-PUBLIC-ANON-KEY',
  SUBMIT_ENDPOINT: '/.netlify/functions/submit-character',
  STATUS_ENDPOINT: '/.netlify/functions/check-status'
};
```

- [ ] **Step 3: Verify manually**

Confirm `netlify.toml` parses: `node -e "require('fs').readFileSync('netlify.toml','utf8')"` (sanity read; full TOML validation happens on Netlify's next deploy). Then, in the Netlify site dashboard: Site configuration → Environment variables → add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from Supabase Project Settings → API → `service_role` secret — **never** put this in `playground/config.js` or any committed file), and `IP_HASH_SALT` (any random string you generate). These three are read by the Netlify Functions via `process.env` at request time.

- [ ] **Step 4: Commit**

```bash
git add netlify.toml playground/config.js
git commit -m "Add Netlify Functions config and public frontend config"
```

---

## Task 8: Playground markup + styles

**Files:**
- Modify: `index.html:48-68`, and add `<script>` tags after `index.html:124`
- Modify: `style.css` (append new section)

**Interfaces:**
- Produces: the DOM elements every later frontend task queries by id — `pg-guide`, `pg-draw` (canvases), `.pg-swatch`, `pg-eraser`, `pg-clear` (tools), `pg-form`, `pg-title`, `pg-message`, `pg-error`, `pg-submit-btn` (form), `pg-draw-state`, `pg-pending-state`, `pg-result-state`, `pg-result-message`, `pg-result-ok` (state panels), `pg-gallery`, `pg-empty-hint` (gallery).
- Consumes: none (this task only adds markup/CSS and empty `<script>` includes for files created in later tasks — the browser will 404 on those script srcs until Tasks 9-11 land, which is fine mid-plan).

- [ ] **Step 1: Replace the playground markup in `index.html`**

Replace this block (current lines 48-68):

```html
        <h2>playground: <em>gat-cha fish.</em></h2>

        <div class="game-embed">
          <div class="iframe-wrapper">
            <iframe
              src="/img/project/glhf_gf/glhf_fishGacha_htmlVer/index.html"
              allowfullscreen
            ></iframe>
          </div>
          <a
            class="game-thumb-link"
            href="glhf_fishGacha_htmlVer/index.html"
            style="pointer-events: none"
          >
            <img
              class="game-thumb"
              src="img/project/glhf_gf/gatchafishThumbnail.png"
              alt="gat-cha fish — tap to play"
            />
          </a>
        </div>
```

With:

```html
        <h2>playground: <em>draw a character.</em></h2>

        <div class="pg-wrap" id="pg-wrap">
          <div class="pg-draw-state" id="pg-draw-state">
            <div class="pg-canvas-wrap" id="pg-canvas-wrap">
              <canvas id="pg-guide" width="180" height="180"></canvas>
              <canvas id="pg-draw" width="180" height="180"></canvas>
            </div>

            <div class="pg-tools">
              <button type="button" class="pg-swatch pg-active" data-color="#1a1a1a" style="background:#1a1a1a" aria-label="black"></button>
              <button type="button" class="pg-swatch" data-color="#e0483e" style="background:#e0483e" aria-label="red"></button>
              <button type="button" class="pg-swatch" data-color="#3e7fe0" style="background:#3e7fe0" aria-label="blue"></button>
              <button type="button" class="pg-swatch" data-color="#3ec46d" style="background:#3ec46d" aria-label="green"></button>
              <button type="button" class="pg-swatch" data-color="#e0c53e" style="background:#e0c53e" aria-label="yellow"></button>
              <button type="button" class="pg-swatch" data-color="#ffffff" style="background:#ffffff; border:1px solid var(--border)" aria-label="white"></button>
              <button type="button" id="pg-eraser">eraser</button>
              <button type="button" id="pg-clear">clear</button>
            </div>

            <form id="pg-form">
              <input type="text" id="pg-title" placeholder="title" maxlength="60" required />
              <textarea id="pg-message" placeholder="message (optional)" maxlength="280"></textarea>
              <p class="pg-error" id="pg-error" hidden></p>
              <button type="submit" id="pg-submit-btn">submit</button>
            </form>
          </div>

          <div class="pg-pending-state" id="pg-pending-state" hidden>
            <p>your character is waiting for review — check back later!</p>
          </div>

          <div class="pg-result-state" id="pg-result-state" hidden>
            <p id="pg-result-message"></p>
            <button type="button" id="pg-result-ok">draw another</button>
          </div>

          <hr />

          <div class="pg-gallery" id="pg-gallery">
            <p class="pg-empty-hint" id="pg-empty-hint" hidden>no one's submitted yet — be the first!</p>
          </div>
        </div>
```

- [ ] **Step 2: Add script includes in `index.html`**

Replace:

```html
    <script src="site.js"></script>
  </body>
</html>
```

With:

```html
    <script src="site.js"></script>
    <script src="playground/config.js"></script>
    <script src="playground/validation.js"></script>
    <script src="playground/wander.js"></script>
    <script src="playground/canvas.js"></script>
    <script src="playground/submit.js"></script>
    <script src="playground/gallery.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Append playground styles to `style.css`**

```css
/* ---------- PLAYGROUND ---------- */
.pg-wrap {
  width: 100%;
}

.pg-canvas-wrap {
  position: relative;
  width: 260px;
  height: 260px;
  margin-bottom: 0.75em;
}

.pg-canvas-wrap canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 260px;
  height: 260px;
  border: 1px solid var(--border);
  touch-action: none;
}

#pg-guide {
  pointer-events: none;
}

.pg-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
  margin-bottom: 0.75em;
  align-items: center;
}

.pg-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.pg-swatch.pg-active,
#pg-eraser.pg-active {
  border-color: var(--fg);
}

#pg-eraser,
#pg-clear {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  padding: 0.3em 0.6em;
  cursor: pointer;
}

#pg-form {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  max-width: 320px;
}

#pg-form input,
#pg-form textarea {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  padding: 0.4em;
  font: inherit;
}

#pg-form textarea {
  resize: vertical;
  min-height: 4em;
}

#pg-submit-btn {
  align-self: flex-start;
  background: var(--fg);
  color: var(--bg);
  border: none;
  padding: 0.4em 1em;
  cursor: pointer;
}

.pg-error {
  color: #c0392b;
}

.pg-pending-state,
.pg-result-state {
  padding: 1em 0;
  color: var(--dim);
}

.pg-gallery {
  position: relative;
  width: 100%;
  max-width: var(--max);
  height: 320px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.pg-empty-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--dim);
  text-align: center;
}

.pg-char {
  position: absolute;
  width: 44px;
  height: 44px;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.pg-char-hover {
  animation: pg-wiggle 0.4s ease-in-out;
}

@keyframes pg-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-8deg); }
  75% { transform: rotate(8deg); }
}

.pg-popup {
  position: absolute;
  max-width: 180px;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 0.5em;
  font-size: 0.85em;
  z-index: 10;
}

.pg-popup-date {
  color: var(--dim);
  margin-top: 0.3em;
}

@media (max-width: 700px) {
  .pg-canvas-wrap,
  .pg-canvas-wrap canvas {
    width: 220px;
    height: 220px;
  }
}
```

- [ ] **Step 4: Verify manually**

Open `index.html` directly in a browser (double-click or `file://` path). Confirm: the playground heading now reads "draw a character", a 260×260 box and color swatches/eraser/clear/title/message/submit render below it, a divider, then an empty bordered gallery box with the "be the first!" hint. Toggle dark mode with the existing button and confirm the new elements pick up `--bg`/`--fg`/`--border` correctly. Browser console will show 404s for `playground/*.js` (expected until later tasks) but the page should not otherwise error.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css
git commit -m "Add playground markup and styles for community character feature"
```

---

## Task 9: Drawing canvas

**Files:**
- Create: `playground/canvas.js`

**Interfaces:**
- Consumes: DOM elements `#pg-guide`, `#pg-draw`, `.pg-swatch`, `#pg-eraser`, `#pg-clear` from Task 8.
- Produces (used by Task 10's `submit.js`): `window.PlaygroundCanvas = {reset(), isBlank() -> boolean, exportImage() -> string}`. Self-initializes on script load (no `init()` call needed by consumers).

- [ ] **Step 1: Write the implementation**

Create `playground/canvas.js`:

```js
// playground/canvas.js
(function () {
  var GUIDE_MARGIN = 30;
  var CANVAS_SIZE = 180;
  var DEFAULT_COLOR = '#1a1a1a';

  var guideCanvas, drawCanvas, guideCtx, drawCtx;
  var currentColor = DEFAULT_COLOR;
  var erasing = false;
  var drawing = false;
  var lastX, lastY;
  var hasDrawn = false;

  function drawGuide() {
    var s = GUIDE_MARGIN;
    var size = CANVAS_SIZE - GUIDE_MARGIN * 2;
    guideCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    guideCtx.strokeStyle = '#bbbbbb';
    guideCtx.lineWidth = 2;

    guideCtx.strokeRect(s, s, size, size);

    var eyeY = s + size * 0.35;
    guideCtx.beginPath();
    guideCtx.arc(s + size * 0.35, eyeY, 3, 0, Math.PI * 2);
    guideCtx.arc(s + size * 0.65, eyeY, 3, 0, Math.PI * 2);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.arc(s + size * 0.5, s + size * 0.55, size * 0.15, 0.15 * Math.PI, 0.85 * Math.PI);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.moveTo(s, s + size * 0.5);
    guideCtx.lineTo(s - 15, s + size * 0.65);
    guideCtx.moveTo(s + size, s + size * 0.5);
    guideCtx.lineTo(s + size + 15, s + size * 0.65);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.moveTo(s + size * 0.35, s + size);
    guideCtx.lineTo(s + size * 0.3, s + size + 20);
    guideCtx.moveTo(s + size * 0.65, s + size);
    guideCtx.lineTo(s + size * 0.7, s + size + 20);
    guideCtx.stroke();
  }

  function getPos(evt) {
    var rect = drawCanvas.getBoundingClientRect();
    var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    var clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return {
      x: (clientX - rect.left) * (CANVAS_SIZE / rect.width),
      y: (clientY - rect.top) * (CANVAS_SIZE / rect.height)
    };
  }

  function startDraw(evt) {
    drawing = true;
    var pos = getPos(evt);
    lastX = pos.x;
    lastY = pos.y;
  }

  function moveDraw(evt) {
    if (!drawing) return;
    evt.preventDefault();
    var pos = getPos(evt);
    drawCtx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    drawCtx.strokeStyle = currentColor;
    drawCtx.lineWidth = erasing ? 10 : 4;
    drawCtx.lineCap = 'round';
    drawCtx.beginPath();
    drawCtx.moveTo(lastX, lastY);
    drawCtx.lineTo(pos.x, pos.y);
    drawCtx.stroke();
    lastX = pos.x;
    lastY = pos.y;
    hasDrawn = true;
  }

  function endDraw() {
    drawing = false;
  }

  function updateToolState(activeEl) {
    var tools = document.querySelectorAll('.pg-swatch, #pg-eraser');
    for (var i = 0; i < tools.length; i++) tools[i].classList.remove('pg-active');
    activeEl.classList.add('pg-active');
  }

  function reset() {
    drawCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    hasDrawn = false;
  }

  function isBlank() {
    return !hasDrawn;
  }

  function exportImage() {
    var out = document.createElement('canvas');
    out.width = CANVAS_SIZE;
    out.height = CANVAS_SIZE;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.drawImage(guideCanvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);
    return out.toDataURL('image/png');
  }

  function init() {
    guideCanvas = document.getElementById('pg-guide');
    drawCanvas = document.getElementById('pg-draw');
    guideCtx = guideCanvas.getContext('2d');
    drawCtx = drawCanvas.getContext('2d');
    drawGuide();

    drawCanvas.addEventListener('mousedown', startDraw);
    drawCanvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);
    drawCanvas.addEventListener('touchstart', startDraw);
    drawCanvas.addEventListener('touchmove', moveDraw);
    window.addEventListener('touchend', endDraw);

    var swatches = document.querySelectorAll('.pg-swatch');
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].addEventListener('click', function (evt) {
        currentColor = evt.currentTarget.getAttribute('data-color');
        erasing = false;
        updateToolState(evt.currentTarget);
      });
    }

    document.getElementById('pg-eraser').addEventListener('click', function (evt) {
      erasing = true;
      updateToolState(evt.currentTarget);
    });

    document.getElementById('pg-clear').addEventListener('click', reset);
  }

  init();

  window.PlaygroundCanvas = {
    reset: reset,
    isBlank: isBlank,
    exportImage: exportImage
  };
})();
```

- [ ] **Step 2: Verify manually**

Reload `index.html` in a browser. Confirm: the guide (gray square, eyes, smile, arm/leg lines) renders on load. Draw with the mouse in black, switch to a swatch color and draw again, click "eraser" and drag over a stroke to remove it, click "clear" and confirm the drawing layer empties while the guide stays. In the browser console run `PlaygroundCanvas.isBlank()` (expect `true` right after clear, `false` after drawing) and `PlaygroundCanvas.exportImage()` (expect a string starting with `data:image/png;base64,`).

- [ ] **Step 3: Commit**

```bash
git add playground/canvas.js
git commit -m "Add drawing canvas with guide, tools, and PNG export"
```

---

## Task 10: Submit flow + status recovery

**Files:**
- Create: `playground/submit.js`

**Interfaces:**
- Consumes: `window.PlaygroundValidation` (Task 2), `window.PlaygroundCanvas` (Task 9), `window.PlaygroundConfig` (Task 7), DOM elements from Task 8 (`pg-form`, `pg-title`, `pg-message`, `pg-error`, `pg-submit-btn`, `pg-draw-state`, `pg-pending-state`, `pg-result-state`, `pg-result-message`, `pg-result-ok`).
- Produces: no external interface — self-initializes on script load, manages the `kwakd-pending-character` `localStorage` key and the three state panels.

- [ ] **Step 1: Write the implementation**

Create `playground/submit.js`:

```js
// playground/submit.js
(function () {
  var STORAGE_KEY = 'kwakd-pending-character';

  function showState(name) {
    var states = ['pg-draw-state', 'pg-pending-state', 'pg-result-state'];
    for (var i = 0; i < states.length; i++) {
      document.getElementById(states[i]).hidden = states[i] !== name;
    }
  }

  function showError(msg) {
    var el = document.getElementById('pg-error');
    el.textContent = msg;
    el.hidden = false;
  }

  function clearError() {
    var el = document.getElementById('pg-error');
    el.hidden = true;
    el.textContent = '';
  }

  function getPending() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setPending(entry) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  }

  function clearPending() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function showResult(message) {
    document.getElementById('pg-result-message').textContent = message;
    showState('pg-result-state');
  }

  async function checkPendingStatus() {
    var pending = getPending();
    if (!pending) {
      showState('pg-draw-state');
      return;
    }
    showState('pg-pending-state');
    try {
      var res = await fetch(window.PlaygroundConfig.STATUS_ENDPOINT + '?id=' + encodeURIComponent(pending.id));
      if (res.status === 404) {
        clearPending();
        showResult("your last submission wasn't approved — feel free to try again!");
        return;
      }
      var body = await res.json();
      if (body.status === 'approved') {
        clearPending();
        showResult('your character was approved! it should show up below.');
      } else if (body.status === 'rejected') {
        clearPending();
        showResult("your last submission wasn't approved — feel free to try again!");
      }
    } catch (e) {
      // network error: leave the pending state showing, retry next load.
    }
  }

  async function handleSubmit(evt) {
    evt.preventDefault();
    clearError();

    var title = document.getElementById('pg-title').value.trim();
    var message = document.getElementById('pg-message').value.trim();

    var titleCheck = window.PlaygroundValidation.validateTitle(title);
    if (!titleCheck.valid) { showError(titleCheck.error); return; }

    var messageCheck = window.PlaygroundValidation.validateMessage(message);
    if (!messageCheck.valid) { showError(messageCheck.error); return; }

    if (window.PlaygroundCanvas.isBlank()) {
      showError('draw something first!');
      return;
    }

    var imageDataUrl = window.PlaygroundCanvas.exportImage();
    var imageCheck = window.PlaygroundValidation.validateImageDataUrl(imageDataUrl);
    if (!imageCheck.valid) { showError(imageCheck.error); return; }

    var submitBtn = document.getElementById('pg-submit-btn');
    submitBtn.disabled = true;

    try {
      var res = await fetch(window.PlaygroundConfig.SUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, message: message, imageDataUrl: imageDataUrl })
      });
      var body = await res.json();
      if (!res.ok) {
        showError(body.error || 'submission failed, try again.');
        submitBtn.disabled = false;
        return;
      }
      setPending({ id: body.id, submittedAt: Date.now() });
      window.PlaygroundCanvas.reset();
      document.getElementById('pg-form').reset();
      showState('pg-pending-state');
    } catch (e) {
      showError('submission failed, try again.');
    }
    submitBtn.disabled = false;
  }

  function init() {
    document.getElementById('pg-form').addEventListener('submit', handleSubmit);
    document.getElementById('pg-result-ok').addEventListener('click', function () {
      showState('pg-draw-state');
    });
    checkPendingStatus();
  }

  init();
})();
```

- [ ] **Step 2: Verify manually**

Since this needs a live `submit-character`/`check-status` deployment to fully exercise, do two passes:

1. **Local, without a backend:** open `index.html`, draw something, submit with a blank title → confirm the "Title is required." error shows and no request fires. Fill in a title, submit → the `fetch` will fail (no server) and the "submission failed, try again." error should show, form re-enabled.
2. **After Task 7's Netlify env vars are set and the site is deployed** (can be deferred to Task 12's end-to-end pass): draw, submit with a valid title → confirm the UI swaps to the "waiting for review" panel and `localStorage.getItem('kwakd-pending-character')` holds `{id, submittedAt}`. Manually approve that row in Supabase's Table Editor, reload the page → confirm the "approved" result panel shows, `localStorage` is cleared, and clicking "draw another" returns to the draw UI.

- [ ] **Step 3: Commit**

```bash
git add playground/submit.js
git commit -m "Add submit flow and pending-status recovery"
```

---

## Task 11: Gallery / wander display

**Files:**
- Create: `playground/gallery.js`

**Interfaces:**
- Consumes: `window.PlaygroundWander` (Task 3), `window.PlaygroundConfig` (Task 7), DOM elements `#pg-gallery`, `#pg-empty-hint` from Task 8.
- Produces: no external interface — self-initializes on script load.

- [ ] **Step 1: Write the implementation**

Create `playground/gallery.js`:

```js
// playground/gallery.js
(function () {
  var ENTITY_SIZE = 44;
  var container, emptyHint;
  var characters = [];
  var lastFrame = null;

  async function fetchApproved() {
    var url = window.PlaygroundConfig.SUPABASE_URL +
      '/rest/v1/characters?select=id,title,message,image_data,created_at' +
      '&status=eq.approved&order=created_at.desc&limit=50';
    var res = await fetch(url, {
      headers: {
        apikey: window.PlaygroundConfig.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + window.PlaygroundConfig.SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) return [];
    return res.json();
  }

  function formatDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function closePopup() {
    var existing = container.querySelector('.pg-popup');
    if (existing) existing.remove();
  }

  function showPopup(entry) {
    closePopup();
    var popup = document.createElement('div');
    popup.className = 'pg-popup';
    popup.innerHTML =
      '<strong>' + escapeHtml(entry.title) + '</strong>' +
      (entry.message ? '<p>' + escapeHtml(entry.message) + '</p>' : '') +
      '<p class="pg-popup-date">' + formatDate(entry.created_at) + '</p>';
    popup.style.left = entry.x + 'px';
    popup.style.top = entry.y + 'px';
    container.appendChild(popup);
  }

  function makeElement(entry) {
    var el = document.createElement('img');
    el.className = 'pg-char';
    el.src = entry.image_data;
    el.alt = entry.title;
    el.addEventListener('mouseenter', function () {
      el.classList.add('pg-char-hover');
    });
    el.addEventListener('mouseleave', function () {
      el.classList.remove('pg-char-hover');
    });
    el.addEventListener('click', function (evt) {
      evt.stopPropagation();
      showPopup(entry);
    });
    container.appendChild(el);
    return el;
  }

  function renderCharacters(rows) {
    emptyHint.hidden = rows.length > 0;
    var bounds = {
      width: container.clientWidth,
      height: container.clientHeight,
      entitySize: ENTITY_SIZE
    };
    characters = rows.map(function (row) {
      var start = window.PlaygroundWander.createWanderState(
        Math.random() * Math.max(bounds.width - ENTITY_SIZE, 0),
        Math.random() * Math.max(bounds.height - ENTITY_SIZE, 0),
        0.02
      );
      var entry = {
        id: row.id,
        title: row.title,
        message: row.message,
        created_at: row.created_at,
        image_data: row.image_data,
        x: start.x,
        y: start.y,
        vx: start.vx,
        vy: start.vy,
        speed: start.speed,
        nextTurnAt: start.nextTurnAt
      };
      entry.el = makeElement(entry);
      return entry;
    });
  }

  function tick(timestamp) {
    if (lastFrame === null) lastFrame = timestamp;
    var dtMs = timestamp - lastFrame;
    lastFrame = timestamp;
    var bounds = {
      width: container.clientWidth,
      height: container.clientHeight,
      entitySize: ENTITY_SIZE
    };
    for (var i = 0; i < characters.length; i++) {
      var c = characters[i];
      var next = window.PlaygroundWander.stepPosition(c, bounds, dtMs, timestamp);
      c.x = next.x; c.y = next.y; c.vx = next.vx; c.vy = next.vy; c.nextTurnAt = next.nextTurnAt;
      c.el.style.left = c.x + 'px';
      c.el.style.top = c.y + 'px';
    }
    requestAnimationFrame(tick);
  }

  async function init() {
    container = document.getElementById('pg-gallery');
    emptyHint = document.getElementById('pg-empty-hint');
    document.addEventListener('click', function (evt) {
      if (!evt.target.closest('.pg-char') && !evt.target.closest('.pg-popup')) {
        closePopup();
      }
    });
    var rows = await fetchApproved();
    renderCharacters(rows);
    requestAnimationFrame(tick);
  }

  init();
})();
```

- [ ] **Step 2: Verify manually**

Once Task 7's Supabase credentials are filled into `playground/config.js` and at least one row has `status = 'approved'` (see Task 1's manual insert/approve, or approve a real submission from Task 10's testing): reload `index.html` and confirm the character image appears in the gallery box and visibly wanders/bounces off the edges. Hover over it → confirm the wiggle animation plays. Click it → confirm a popup with title/message/date appears, and clicking elsewhere in the box closes it. With zero approved rows, confirm the "be the first!" hint shows instead.

- [ ] **Step 3: Commit**

```bash
git add playground/gallery.js
git commit -m "Add wander gallery display with hover and click interactions"
```

---

## Task 12: End-to-end manual QA

**Files:** none (verification only, against a deployed Netlify site + real Supabase project).

- [ ] **Step 1: Full submit → approve → display pass**

On the deployed site: draw a character, fill in title + message, submit. Confirm the "waiting for review" panel appears and stays across a reload. In Supabase's Table Editor, find the pending row, set `status` to `approved`. Reload the page: confirm the result panel shows the approval message, then (after clicking "draw another" or on a later reload) the character appears wandering in the gallery with the correct title/message/date on click.

- [ ] **Step 2: Rejection pass**

Submit a second character. In Supabase, set its `status` to `rejected`. Reload: confirm the "wasn't approved, feel free to try again" message shows and the draw form is available again.

- [ ] **Step 3: Rate limit pass**

From the same browser/IP, submit 5 characters in under an hour (approve/reject each between submissions so the draw form keeps unlocking), then attempt a 6th. Confirm `submit-character` returns the 429 error and the frontend surfaces it near the submit button.

- [ ] **Step 4: Empty state pass**

With a fresh Supabase project (or by temporarily setting all rows to `pending`/`rejected`), confirm the gallery shows the "be the first!" hint rather than an empty box.

- [ ] **Step 5: Final commit**

If Steps 1-4 all pass with no code changes needed, no commit is required — this task is verification-only. If any step surfaces a bug, fix it in the relevant file from Tasks 1-11, re-run that task's automated tests (if any) plus this task's manual pass, then commit the fix with a message describing what was wrong.
