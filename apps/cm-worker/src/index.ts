import { createPgBoss } from "./db.js";
import { loadConfig } from "./config.js";
import { createSupabaseClient } from "./db.js";
import { createScanWorkHandler, setupScanQueue, QUEUE_SCAN, DEFAULT_RETRY_LIMIT, DEFAULT_RETRY_DELAY_SECONDS } from "./handlers/retry.js";

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

  console.log("[cm-worker] ready");

  const shutdown = async () => {
    console.log("[cm-worker] shutdown requested");
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
