// One-time script: reads each skills/<agent>/SKILL.md and writes to agent_config.skill_content
// Run: apps/dashboard/node_modules/.bin/tsx scripts/seed-skill-content.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const AGENT_SKILL_MAP: Record<string, string> = {
  "product-owner":     "skills/product-owner/SKILL.md",
  "codebase-analyst":  "skills/codebase-analyst/SKILL.md",
  "tech-lead":         "skills/tech-lead/SKILL.md",
  "backend-dev":       "skills/backend-dev/SKILL.md",
  "frontend-dev":      "skills/frontend-dev/SKILL.md",
  "security-reviewer": "skills/security-reviewer/SKILL.md",
  "code-reviewer":     "skills/code-reviewer/SKILL.md",
  "qa-engineer":       "skills/qa-engineer/SKILL.md",
};

async function loadEnv(root: string) {
  try {
    const raw = await readFile(join(root, "apps/dashboard/.env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {
    // env already populated externally
  }
}

async function main() {
  const root = process.cwd();
  await loadEnv(root);

  const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceKey  = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  for (const [agentName, skillPath] of Object.entries(AGENT_SKILL_MAP)) {
    let content: string;
    try {
      content = await readFile(join(root, skillPath), "utf-8");
    } catch {
      console.warn(`  SKIP  ${agentName} — not found: ${skillPath}`);
      continue;
    }

    const res = await fetch(
      `${supabaseUrl}/rest/v1/agent_config?agent_name=eq.${encodeURIComponent(agentName)}`,
      {
        method: "PATCH",
        headers: {
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ skill_content: content }),
      }
    );

    if (res.ok) {
      console.log(`  OK    ${agentName} (${content.length} chars)`);
    } else {
      const body = await res.text();
      console.error(`  ERROR ${agentName}: ${res.status} ${body}`);
    }
  }

  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
