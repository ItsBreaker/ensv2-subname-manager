import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client, authenticated with the SECRET key (the new equivalent of the
 * service_role key — bypasses RLS, full access). NEVER import this into client components: the
 * secret key must stay on the server. All DB access goes through here from API routes.
 */
let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Supabase not configured: set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");
  }
  if (!cached) {
    cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cached;
}
