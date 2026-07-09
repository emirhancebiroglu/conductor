import { CheckmarxScanError } from "@conductor/cm-adapters";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider } from "@conductor/cm-adapters";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { PgBoss } from "pg-boss";
import { handleScan } from "./scan.js";
import { handleFix } from "./fix.js";

export const QUEUE_SCAN = "cm.scan";
export const QUEUE_SCAN_DEAD_LETTER = "cm.scan.dead";
export const QUEUE_FIX = "cm.fix";
export const QUEUE_FIX_DEAD_LETTER = "cm.fix.dead";
export const DEFAULT_RETRY_LIMIT = 3;
export const DEFAULT_RETRY_DELAY_SECONDS = 1800;
export const RETRY_BACKOFF = true;

export type RetryConfig = {
  retryLimit: number;
  retryDelaySeconds: number;
};

async function enqueueFixIfNeeded(
  supabase: SupabaseClient,
  boss: PgBoss,
  scanId: string,
): Promise<void> {
  try {
    const { data: scan } = await supabase
      .from("cm_scan")
      .select("status, findings_actionable")
      .eq("id", scanId)
      .maybeSingle() as unknown as { data: { status: string; findings_actionable: number } | null };

    if (scan && scan.status === "scan_done" && scan.findings_actionable > 0) {
      await boss.send(QUEUE_FIX, { scanId }, { singletonKey: scanId });
      console.log(`[retry] enqueued fix for scan ${scanId} (${scan.findings_actionable} actionable findings)`);
    }
  } catch {
    // non-fatal
  }
}

export function createScanWorkHandler(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  boss: PgBoss,
): (jobs: Array<{ data: { scanId: string } }>) => Promise<void> {
  return async (jobs) => {
    for (const job of jobs) {
      const startTime = Date.now();

      try {
        await handleScan(supabase, scanProvider, { scanId: job.data.scanId });
        const elapsed = Date.now() - startTime;
        console.log(`[retry] scan ${job.data.scanId} completed in ${elapsed}ms`);
        await enqueueFixIfNeeded(supabase, boss, job.data.scanId);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.log(`[retry] scan ${job.data.scanId} failed after ${elapsed}ms`);

        if (err instanceof CheckmarxScanError) {
          if (err.outcome === "system_fail") {
            console.log(`[retry] system fail, will retry: ${err.message}`);
            throw err;
          }
          if (err.outcome === "scan_failed") {
            console.log(`[retry] scan fail (Checkmarx-reported), NOT retrying: ${err.message}`);
            return;
          }
        }

        if (err instanceof Error && err.message.includes("not found")) {
          // Scan deleted or never existed — discard job, no retry
          console.log(`[retry] scan not found in DB, discarding job: ${err.message}`);
          return;
        }

        if (err instanceof Error && err.message.startsWith("Failed to load cm_scan")) {
          console.log(`[retry] scan load failure, will retry: ${err.message}`);
          throw err;
        }

        console.log(`[retry] unknown error, NOT retrying: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
}

export async function setupScanQueue(boss: PgBoss, config: RetryConfig): Promise<void> {
  // Dead letter queue must exist before the main queue references it.
  await boss.createQueue(QUEUE_SCAN_DEAD_LETTER);
  await boss.createQueue(QUEUE_SCAN, {
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelaySeconds,
    retryBackoff: RETRY_BACKOFF,
    deadLetter: QUEUE_SCAN_DEAD_LETTER,
  });
}

export async function setupFixQueue(boss: PgBoss, config: RetryConfig): Promise<void> {
  await boss.createQueue(QUEUE_FIX_DEAD_LETTER);
  await boss.createQueue(QUEUE_FIX, {
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelaySeconds,
    retryBackoff: RETRY_BACKOFF,
    deadLetter: QUEUE_FIX_DEAD_LETTER,
  });
}

export function createFixWorkHandler(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  agentRunner: import("@conductor/cm-adapters").AgentRunner,
  checkpointer: BaseCheckpointSaver,
): (jobs: Array<{ data: { scanId: string } }>) => Promise<void> {
  return async (jobs) => {
    for (const job of jobs) {
      const startTime = Date.now();

      try {
        await handleFix(supabase, scanProvider, agentRunner, checkpointer, job.data.scanId);
        const elapsed = Date.now() - startTime;
        console.log(`[retry] fix ${job.data.scanId} completed in ${elapsed}ms`);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.log(`[retry] fix ${job.data.scanId} failed after ${elapsed}ms:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    }
  };
}
