import { createClient } from "@supabase/supabase-js";
import { PgBoss } from "pg-boss";

export function createSupabaseClient(): ReturnType<typeof createClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase credentials: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

export function createPgBoss(): PgBoss {
  const connectionString = process.env.CM_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing database connection string: CM_DATABASE_URL");
  }
  // Supabase pooler uses a self-signed cert chain — disable hostname verification.
  return new PgBoss({ connectionString, ssl: { rejectUnauthorized: false } });
}
