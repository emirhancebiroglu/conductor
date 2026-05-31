import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Creates a Supabase client using the service_role key for admin access.
 * Only available when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
 * Used by database-level tests that need to query system catalogs.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}
