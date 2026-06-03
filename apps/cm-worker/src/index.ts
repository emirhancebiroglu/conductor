import { createPgBoss } from "./db.js";
import { loadConfig } from "./config.js";

const QUEUE_SCAN = "cm.scan";

async function main(): Promise<void> {
  console.log("[cm-worker] booting");

  const config = loadConfig();
  const boss = createPgBoss();

  console.log(`[cm-worker] scan provider: ${config.scanProvider.constructor.name}`);
  console.log(`[cm-worker] agent runner: ${config.agentRunner.constructor.name}`);

  await boss.start();
  console.log("[cm-worker] pg-boss started");

  void boss.work(QUEUE_SCAN, () => {
    console.log("[cm-worker] scan job received (handler not yet implemented)");
    return Promise.resolve();
  });

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
