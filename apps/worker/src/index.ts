import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { processJob } from "./processJob.js";
import { getUsageState, updateWorkerStatus } from "./usage.js";

// JobRow defined inline to avoid core export dependency
type JobRow = {
  id: string;
  project_id: string;
  type: string;
  title: string;
  description: string;
  lane_preference: string;
  status: string;
  branch: string | null;
  pr_url: string | null;
  spec: unknown;
  plan: unknown;
  answers: Record<string, string> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
};

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

async function loadDotEnv(): Promise<void> {
  try {
    const raw = await readFile(join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && val) process.env[key] = val;
    }
  } catch {
    // .env.local not required
  }
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000;

let activeJobId: string | null = null;
let shutdownRequested = false;

// why: supabase-js generics clash with exactOptionalPropertyTypes; any is intentional here
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function poll(supabase: any): Promise<void> {
  const usageState = await getUsageState();
  if (usageState.blocked) {
    console.log("[worker] hard limit — job alımı duraklatıldı");
    await updateWorkerStatus("paused_limit", "hard limit hit");
    return;
  }
  await updateWorkerStatus("online");

  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[worker] poll error:", (error as { message: string }).message);
    return;
  }

  if (!data) {
    console.log("[worker] poll: no jobs");
    return;
  }

  const job = data as JobRow;
  activeJobId = job.id;
  console.log(`[worker] poll: picked up job ${job.id}`);

  const { error: updateError } = await supabase
    .from("jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", job.id);

  if (updateError) {
    console.error(`[worker] failed to mark job running: ${(updateError as { message: string }).message}`);
    activeJobId = null;
    return;
  }

  try {
    await processJob(supabase, job);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} failed: ${msg}`);
    await supabase
      .from("jobs")
      .update({ status: "failed", error: msg })
      .eq("id", job.id);
  } finally {
    activeJobId = null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await loadDotEnv();

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("[worker] starting — polling every 5s");

  const shutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.log("[worker] shutdown requested — will stop after current job finishes");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!shutdownRequested) {
    await poll(supabase);
    if (!shutdownRequested) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  if (activeJobId) {
    console.log(`[worker] waiting for job ${activeJobId} to finish...`);
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!activeJobId) {
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
  }

  console.log("[worker] shutdown complete");
}

main().catch((err) => {
  console.error("[worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
