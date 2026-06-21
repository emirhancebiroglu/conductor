/**
 * One-off repair: agent_config.allowed_tools for all 4 CM agents was found empty
 * in the DB (verified via scripts/check-agent-config.ts) after a provider switch
 * through the dashboard UI. Restores the tool sets specified in migration 011.
 * Usage: apps\cm-worker\node_modules\.bin\tsx.CMD scripts/restore-agent-tools.ts
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

const RESTORE: Record<string, string[]> = {
  "cm-fix-planner": ["tavily", "github", "context7"],
  "cm-sca-agent": ["tavily", "context7", "edit", "shell"],
  "cm-sast-agent": ["context7", "edit", "shell"],
  "cm-fix-verifier": ["edit", "shell"],
};

async function main() {
  for (const [agentName, tools] of Object.entries(RESTORE)) {
    const { error } = await supabase
      .from("agent_config")
      .update({ allowed_tools: tools })
      .eq("agent_name", agentName);
    if (error) {
      console.error(`${agentName}: ${error.message}`);
      process.exit(1);
    }
    console.log(`${agentName}: allowed_tools -> [${tools.join(", ")}]`);
  }
}

main();
