/**
 * Quick read-only check of current agent_config rows for the 4 CM agents.
 * Usage: apps\cm-worker\node_modules\.bin\tsx.CMD scripts/check-agent-config.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv(filePath: string) {
  try {
    const lines = readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* file not found — skip */ }
}

loadEnv(join(root, "apps/dashboard/.env.local"));
loadEnv(join(root, "apps/dashboard/.env.test"));

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase
    .from("agent_config")
    .select("agent_name, provider, model, allowed_tools")
    .like("agent_name", "cm-%");

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.table(data);
}

main();
