import { createClient } from "@supabase/supabase-js";

// Client-side Supabase client using the publishable (public) key — safe to
// expose to the browser as long as Row Level Security policies (see
// sql/schema.sql) govern what it can actually read/write. There is no
// secret/service_role key anywhere in this app; every page talks to
// Supabase directly using this client.
//
// Supabase's dashboard now issues "publishable"/"secret" keys (sb_publishable_...)
// instead of the older anon/service_role JWTs, so PUBLISHABLE_KEY is
// checked first; ANON_KEY is kept as a fallback for older projects.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublicKey);

// A stub client is used when env vars are missing (e.g. running the UI
// before Supabase is connected) so pages render an empty/error state
// instead of crashing at import time.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublicKey)
  : null;
