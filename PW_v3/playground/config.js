// playground/config.js
// Public, safe-to-expose configuration. SUPABASE_ANON_KEY is
// intentionally public -- Row Level Security on the `characters` table
// (see supabase/schema.sql) restricts it to reading approved rows only.
// Replace the two placeholder values below with your real Supabase
// project's URL and anon key (Project Settings > API) before deploying.
window.PlaygroundConfig = {
  SUPABASE_URL: 'https://tahumxdidefsflocycmw.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Qj9JoQAhV15TFNjVHUkkeg_WLY4UN9m',
  SUBMIT_ENDPOINT: '/.netlify/functions/submit-character',
  STATUS_ENDPOINT: '/.netlify/functions/check-status'
};
