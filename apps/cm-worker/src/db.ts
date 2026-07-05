import { createClient } from "@supabase/supabase-js";
import { PgBoss } from "pg-boss";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

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

/**
 * LangGraph checkpointer for the fix pipeline graph — persists graph state
 * (which node, plan, findings, attempt count) to the same Postgres instance
 * pg-boss uses, so an interrupted/crashed run resumes instead of restarting.
 * Caller must await `.setup()` once before first use (creates its own tables).
 */
export function createCheckpointer(): PostgresSaver {
  const connectionString = process.env.CM_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing database connection string: CM_DATABASE_URL");
  }
  return PostgresSaver.fromConnString(connectionString);
}
