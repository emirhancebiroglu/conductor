import { CheckmarxScanError } from "@conductor/cm-adapters";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider } from "@conductor/cm-adapters";
import type { PgBoss } from "pg-boss";
import { handleScan } from "./scan.js";

export const QUEUE_SCAN = "cm.scan";
export const QUEUE_SCAN_DEAD_LETTER = "cm.scan.dead";
export const DEFAULT_RETRY_LIMIT = 3;
export const DEFAULT_RETRY_DELAY_SECONDS = 1800;
export const RETRY_BACKOFF = true;

export type RetryConfig = {
  retryLimit: number;
  retryDelaySeconds: number;
};

async function isPipelineEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const result = await supabase
      .from("cm_pipeline")
      .select("enabled")
      .limit(1)
      .maybeSingle() as unknown as { data: { enabled: boolean } | null };
    return result.data?.enabled ?? false;
  } catch {
    return false;
  }
}

export function createScanWorkHandler(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
): (jobs: Array<{ data: { scanId: string } }>) => Promise<void> {
  return async (jobs) => {
    for (const job of jobs) {
      const startTime = Date.now();

      // Kill switch: skip if pipeline is disabled
      const enabled = await isPipelineEnabled(supabase);
      if (!enabled) {
        console.log(`[retry] pipeline disabled — skipping scan job ${job.data.scanId}`);
        continue;
      }

      try {
        await handleScan(supabase, scanProvider, { scanId: job.data.scanId });
        const elapsed = Date.now() - startTime;
        console.log(`[retry] scan ${job.data.scanId} completed in ${elapsed}ms`);
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
  await boss.createQueue(QUEUE_SCAN, {
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelaySeconds,
    retryBackoff: RETRY_BACKOFF,
    deadLetter: QUEUE_SCAN_DEAD_LETTER,
  });
}
