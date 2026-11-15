# Community Character Playground — Design

Date: 2026-08-14
Status: Approved for planning

## Summary

Replace the "playground" section's `iframe-wrapper` (currently the gat-cha
fish embed) on `index.html` with a community drawing feature: visitors draw
a small character on a fixed body template, optionally add a title and
message, and submit it. After manual approval (via Supabase's Table
Editor), their character joins everyone else's approved characters,
wandering around inside the same display box, where hovering triggers a
small reaction and clicking shows the title/message/date.

## Goals

- Let any visitor draw and submit a character without an account.
- Keep moderation effort-free: approve/reject by flipping a status column
  in Supabase's dashboard, no custom admin UI.
- Keep the site static-first: no new server to run/maintain, consistent
  with the current GitHub → Netlify deploy.
- Reuse the existing playground box/section rather than adding a new page.

## Non-goals

- User accounts, likes/comments, or any social features beyond the
  title/message shown on click.
- Automated moderation (profanity filters, image classification). All
  review is manual.
- Editing or deleting a submission after it's sent (a rejected submission
  simply lets the visitor draw and submit a new one).

## Architecture

- **Hosting**: unchanged — static site on Netlify, deployed from GitHub.
- **Database**: Supabase (Postgres), free tier.
- **API**: two Netlify Functions:
  - `submit-character` (POST) — validates and inserts a pending
    submission.
  - `check-status` (GET) — given an `id`, returns just `{status}` so a
    visitor's browser can find out if their pending submission was
    approved/rejected.
- **Reads**: the gallery reads approved characters **directly from
  Supabase** using its public anon key — no function needed. A
  Row-Level-Security policy restricts public `SELECT` to rows where
  `status = 'approved'`, so pending/rejected drawings, titles, and
  messages are never exposed to other visitors.
- **Moderation**: manual, via Supabase's Table Editor — no custom admin
  page. You inspect pending rows' `image_data`, `title`, `message`, and
  set `status` to `approved` or `rejected`.

### Data model

Table `characters`:

| column       | type        | notes                                          |
|--------------|-------------|-------------------------------------------------|
| id           | uuid (pk)   | default `gen_random_uuid()`                    |
| created_at   | timestamptz | default `now()`                                |
| title        | text        | required, length-capped (e.g. 60 chars)        |
| message      | text        | optional, length-capped (e.g. 280 chars)       |
| image_data   | text        | base64 PNG data URL, size-capped server-side   |
| status       | text        | `pending` \| `approved` \| `rejected`, default `pending` |
| ip_hash      | text        | salted hash of submitter IP, used for rate limiting only |

RLS policies:
- `SELECT`: allowed to `anon` role only where `status = 'approved'`.
- `INSERT`/`UPDATE`: **not** granted to `anon`. Only the `submit-character`
  function (using the service-role key, server-side only) can write.

### Netlify Functions

**`submit-character`**
1. Parse and validate payload: `title` (required, ≤60 chars), `message`
   (optional, ≤280 chars), `image_data` (required, must be a PNG data URL
   under a fixed size cap, e.g. 150KB).
2. Compute `ip_hash` from the request IP (salted hash, not stored raw).
3. Rate limit: query Supabase for submissions with this `ip_hash` in the
   last hour; if over a small threshold (e.g. 5), reject with a friendly
   error.
4. Insert a row with `status = 'pending'` using the service-role key.
5. Return `{ id }` on success.

**`check-status`**
1. Given `?id=`, look up the row's `status` only (not image/title/message)
   using the service-role key (bypasses RLS since this needs to work for
   pending rows too, but only ever returns the status field).
2. Return `{ status }`, or 404 if the id doesn't exist.

## Frontend

### Drawing & submit UI (replaces `.iframe-wrapper`)

- **Canvas**, two layers, ~160×160px internal resolution (scaled up via
  CSS for a comfortable on-screen drawing area):
  - Bottom layer: a fixed guide drawn once via canvas primitives — square
    body outline, two eyes, a small smile, line arms/legs — not part of
    the paintable/erasable surface.
  - Top layer: the actual drawing surface, sized with a bit of margin
    beyond the square body so visitors can add extras (accessories,
    effects, etc.) if they want.
- **Tools**: freehand pen (pointer/touch events → line segments), eraser
  toggle, a small fixed palette (5–6 swatches), and a clear button.
- **Form fields**: title (required, short), message (optional, longer).
- **Client-side validation**: enforce the same length caps as the
  backend; block submitting a canvas with no visible strokes.
- **Submit flow**: export the drawing layer (composited over the guide)
  to a PNG data URL → POST to `submit-character` with title/message. On
  success, store `{ id, submittedAt }` in `localStorage` under a
  site-specific key (e.g. `kwakd-pending-character`) and replace the draw
  UI with a "pending review" message.
- **Status recovery**: on page load, if a pending entry exists in
  `localStorage`, call `check-status`.
  - `pending`: keep showing the waiting message.
  - `approved`: show a brief confirmation, clear the stored entry, then
    show the draw UI again (so they could submit another character).
  - `rejected`: show a brief "wasn't approved, feel free to try again"
    message, clear the stored entry, then show the draw UI again.

### Gallery / wander display

- On load, query Supabase directly (anon key) for approved characters —
  `id, image_data, title, message, created_at` — most recent first,
  capped at ~50 to keep animation smooth.
- Each becomes a small absolutely-positioned element inside the display
  box (the box that currently holds the game iframe). A small wander
  script animates each one via `requestAnimationFrame`: pick a direction,
  move, bounce off the box's edges, occasionally pick a new direction.
- **Hover**: a small playful reaction (a quick wiggle/bounce keyframe,
  optionally a brief emoji speech-bubble), then resumes wandering.
- **Click**: opens a small popup near the character showing its title,
  message (if present), and a formatted submission date.
- **Empty state**: if there are zero approved characters yet, show the
  guide-only square with a "no one's submitted yet — be the first!" hint
  instead of an empty box.

## Edge cases

- Oversized or malformed `image_data` → rejected server-side in
  `submit-character`, independent of client-side checks.
- Rate-limit hit → `submit-character` returns a friendly error the
  frontend surfaces near the submit button.
- Moderation lag is unbounded and that's fine — no fake progress
  indicator; status is picked up next page load (a manual "check again"
  button is a nice-to-have, not required).
- A visitor with a stale/invalid `id` in `localStorage` (e.g. row deleted
  after rejection instead of marked rejected) — `check-status` 404s;
  frontend treats that the same as `rejected` and clears the entry.

## Testing plan

Manual, in-browser (no framework test suite — matches the rest of this
static site):
- Draw, submit, reload → confirm the pending state persists via
  `localStorage` and `check-status`.
- Submit repeatedly past the rate-limit threshold → confirm the friendly
  rejection.
- Approve a row in Supabase → confirm it appears, wanders, and
  hover/click work as designed.
- Reject a row in Supabase → confirm the submitter's next page load
  unlocks the draw form again with the rejection message.
- Zero-approved-rows state renders the empty-state hint, not a blank box.
