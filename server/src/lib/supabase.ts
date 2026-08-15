import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "../config/env.js";
import type { Database } from "../types/db.js";

let client: SupabaseClient<Database> | null = null;

/**
 * Server-side client using the service role key — bypasses RLS by design.
 * Every query issued from here must manually scope by user_id / site_id;
 * RLS in the migrations protects direct client access, not this key.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  const env = getEnv();
  client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

let publicClient: SupabaseClient<Database> | null = null;

/**
 * Anon-key client — subject to RLS like any unauthenticated browser client.
 * Use this (not getSupabase()) for anything a stranger can read, so a bug
 * in an app-level `.eq('is_public', true)` filter can't leak a private run;
 * the database itself is the thing saying no.
 */
export function getSupabasePublic(): SupabaseClient<Database> {
  if (publicClient) return publicClient;
  const env = getEnv();
  publicClient = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return publicClient;
}
