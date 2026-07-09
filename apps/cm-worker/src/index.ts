/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */

import { createPgBoss, createSupabaseClient, createCheckpointer } from "./db.js";
import { loadConfig } from "./config.js";
import { createScanWorkHandler, createFixWorkHandler, setupScanQueue, setupFixQueue, QUEUE_SCAN, QUEUE_FIX, DEFAULT_RETRY_LIMIT, DEFAULT_RETRY_DELAY_SECONDS } from "./handlers/retry.js";
import { RESUME_REQUESTED_MARKER } from "./handlers/fix.js";
import { runScheduler } from "./handlers/scheduler.js";

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
  const checkpointer = createCheckpointer();
  await checkpointer.setup();
  console.log("[cm-worker] fix-pipeline checkpointer ready");

  console.log(`[cm-worker] scan provider: ${config.scanProvider.constructor.name}`);
  console.log(`[cm-worker] agent runner: ${config.agentRunner.constructor.name}`);

  boss.on("error", (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cm-worker] pg-boss error: ${msg}`);
  });

  // Retry pg-boss start — DB may be unreachable momentarily (VPN, cold start, etc.)
  const MAX_START_ATTEMPTS = 10;
  const START_RETRY_MS = 15_000;
  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    try {
      await boss.start();
      console.log("[cm-worker] pg-boss started");
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_START_ATTEMPTS) {
        throw new Error(`pg-boss failed to start after ${MAX_START_ATTEMPTS} attempts: ${msg}`);
      }
      console.warn(`[cm-worker] pg-boss start attempt ${attempt}/${MAX_START_ATTEMPTS} failed: ${msg}. Retrying in ${START_RETRY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, START_RETRY_MS));
    }
  }

  await setupScanQueue(boss, {
    retryLimit: DEFAULT_RETRY_LIMIT,
    retryDelaySeconds: DEFAULT_RETRY_DELAY_SECONDS,
  });

  await setupFixQueue(boss, {
    retryLimit: DEFAULT_RETRY_LIMIT,
    retryDelaySeconds: DEFAULT_RETRY_DELAY_SECONDS,
  });

  // Purge stale jobs from previous runs (scan rows deleted, restarts, etc.)
  // Poll loops below will re-enqueue only valid scans/fixes from the DB.
  await boss.deleteQueuedJobs(QUEUE_SCAN);
  await boss.deleteQueuedJobs(QUEUE_FIX);
  console.log("[cm-worker] purged stale queued jobs");

  const scanHandler = createScanWorkHandler(supabase, config.scanProvider, boss);
  void boss.work(QUEUE_SCAN, scanHandler);

  const fixHandler = createFixWorkHandler(supabase, config.scanProvider, config.agentRunner, checkpointer);
  void boss.work(QUEUE_FIX, fixHandler);

  // Poll for queued scans inserted directly by the dashboard (no pg-boss enqueue from serverless)
  const POLL_INTERVAL_MS = 5_000;
  const recentlyEnqueued = new Map<string, number>();
  const ENQUEUE_COOLDOWN_MS = 60_000;
  const pollQueuedScans = async () => {
    try {
      const { data } = await (supabase as any)
        .from("cm_scan")
        .select("id")
        .eq("status", "queued")
        .limit(10);

      if (data && data.length > 0) {
        for (const row of data as Array<{ id: string }>) {
          // Cooldown: skip if we already enqueued this scan within the last 60s
          const lastSent = recentlyEnqueued.get(row.id);
          if (lastSent && Date.now() - lastSent < ENQUEUE_COOLDOWN_MS) continue;

          await boss.send(QUEUE_SCAN, { scanId: row.id }, { singletonKey: row.id });
          recentlyEnqueued.set(row.id, Date.now());
          console.log(`[cm-worker] enqueued queued scan: ${row.id}`);
        }
      }
    } catch {
      // non-fatal poll error
    }
  };

  // Poll for scan_done scans that need fix (dashboard-only inserts that skip queue)
  const pollScanDoneForFix = async () => {
    try {
      const { data } = await (supabase as any)
        .from("cm_scan")
        .select("id")
        .eq("status", "scan_done")
        .gt("findings_actionable", 0)
        .limit(10);

      if (data && data.length > 0) {
        for (const row of data as Array<{ id: string }>) {
          const lastSent = recentlyEnqueued.get(row.id);
          if (lastSent && Date.now() - lastSent < ENQUEUE_COOLDOWN_MS) continue;
          await boss.send(QUEUE_FIX, { scanId: row.id }, { singletonKey: row.id });
          recentlyEnqueued.set(row.id, Date.now());
          console.log(`[cm-worker] enqueued fix for scan_done: ${row.id}`);
        }
      }
    } catch {
      // non-fatal poll error
    }
  };

  // Poll for needs_human scans where a human requested a resume (dashboard
  // sets current_step to RESUME_REQUESTED_MARKER) — handleFix detects the
  // paused checkpoint and continues from there instead of restarting.
  const pollResumeRequests = async () => {
    try {
      const { data } = await (supabase as any)
        .from("cm_scan")
        .select("id")
        .eq("status", "needs_human")
        .eq("current_step", RESUME_REQUESTED_MARKER)
        .limit(10);

      if (data && data.length > 0) {
        for (const row of data as Array<{ id: string }>) {
          const lastSent = recentlyEnqueued.get(row.id);
          if (lastSent && Date.now() - lastSent < ENQUEUE_COOLDOWN_MS) continue;
          await boss.send(QUEUE_FIX, { scanId: row.id }, { singletonKey: row.id });
          recentlyEnqueued.set(row.id, Date.now());
          console.log(`[cm-worker] enqueued fix resume for scan: ${row.id}`);
        }
      }
    } catch {
      // non-fatal poll error
    }
  };

  setInterval(() => { void pollQueuedScans(); }, POLL_INTERVAL_MS);
  void pollQueuedScans(); // immediate first check

  setInterval(() => { void pollResumeRequests(); }, POLL_INTERVAL_MS);
  void pollResumeRequests();

  setInterval(() => { void pollScanDoneForFix(); }, POLL_INTERVAL_MS);
  void pollScanDoneForFix();

  // Auto-mode scheduler tick (every 60s; cron matching inside runScheduler is idempotent)
  const SCHEDULER_INTERVAL_MS = 60_000;
  setInterval(() => { void runScheduler(supabase, boss); }, SCHEDULER_INTERVAL_MS);
  void runScheduler(supabase, boss);

  await updateWorkerStatus(supabase, "online");

  let lastLoggedAutoModeState: boolean | null = null;
  const heartbeatTimer = setInterval(() => {
    void (async () => {
      const enabled = await isPipelineEnabled(supabase);
      if (lastLoggedAutoModeState !== enabled) {
        console.log(enabled ? "[cm-worker] auto-mode enabled" : "[cm-worker] auto-mode disabled — manual scans only");
        lastLoggedAutoModeState = enabled;
      }
      await updateWorkerStatus(supabase, enabled ? "online" : "paused_manual", enabled ? undefined : "auto-mode disabled");
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
