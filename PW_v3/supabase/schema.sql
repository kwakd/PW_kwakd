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
