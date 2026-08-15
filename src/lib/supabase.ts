import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — set them in .env.local (see .env.local.example).",
  );
}

/**
 * Browser client — uses the publishable (anon) key, safe to ship in the
 * bundle. Never put the service-role key here; that lives server-side only
 * (server/.env, SUPABASE_SERVICE_ROLE_KEY).
 */
export const supabase = createClient(url, publishableKey);
