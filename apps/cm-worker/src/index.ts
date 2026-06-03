/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */

import { createPgBoss } from "./db.js";
import { loadConfig } from "./config.js";
import { createSupabaseClient } from "./db.js";
import { createScanWorkHandler, setupScanQueue, QUEUE_SCAN, DEFAULT_RETRY_LIMIT, DEFAULT_RETRY_DELAY_SECONDS } from "./handlers/retry.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

async function updateWorkerStatus(supabase: ReturnType<typeof createSupabaseClient>, status: string, reason?: string): Promise<void> {
  try {
    const sb = supabase as any;
    const existing = await sb.from("worker_status").select("id").limit(1).maybeSingle();
    if (existing?.data?.id) {
      await sb.from("worker_status").update({ status, reason: reason ?? null, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
    } else {
      await sb.from("worker_status").insert({ status, reason: reason ?? null });
    }
  } catch {
    // non-fatal
  }
}

async function isPipelineEnabled(supabase: ReturnType<typeof createSupabaseClient>): Promise<boolean> {
  try {
    const result = await (supabase as any).from("cm_pipeline").select("enabled").limit(1).maybeSingle();
    return result?.data?.enabled ?? false;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("[cm-worker] booting");

  const config = loadConfig();
  const supabase = createSupabaseClient();
  const boss = createPgBoss();

  console.log(`[cm-worker] scan provider: ${config.scanProvider.constructor.name}`);
  console.log(`[cm-worker] agent runner: ${config.agentRunner.constructor.name}`);

  await boss.start();
  console.log("[cm-worker] pg-boss started");

  await setupScanQueue(boss, {
    retryLimit: DEFAULT_RETRY_LIMIT,
    retryDelaySeconds: DEFAULT_RETRY_DELAY_SECONDS,
  });

  const workHandler = createScanWorkHandler(supabase, config.scanProvider);
  void boss.work(QUEUE_SCAN, workHandler);

  await updateWorkerStatus(supabase, "online");

  const heartbeatTimer = setInterval(() => {
    void (async () => {
      const enabled = await isPipelineEnabled(supabase);
      if (!enabled) {
        console.log("[cm-worker] pipeline disabled — kill switch active");
      }
      await updateWorkerStatus(supabase, enabled ? "online" : "paused_manual", enabled ? undefined : "pipeline disabled (kill switch)");
    })();
  }, HEARTBEAT_INTERVAL_MS);

  console.log("[cm-worker] ready");

  const shutdown = async () => {
    console.log("[cm-worker] shutdown requested");
    clearInterval(heartbeatTimer);
    await updateWorkerStatus(supabase, "paused_manual", "shutdown");
    await boss.stop({ graceful: true, timeout: 30_000 });
    console.log("[cm-worker] shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}

main().catch((err) => {
  console.error("[cm-worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
