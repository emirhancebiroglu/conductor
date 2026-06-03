import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider } from "@conductor/cm-adapters";
import { canTransitionScan } from "@conductor/cm-core";

type CmScanRow = {
  id: string;
  repo_id: string;
  workspace_id: string;
  status: string;
};

type CmPipelineRow = {
  max_fix_attempts: number;
};

export async function handleRescan(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  scanId: string,
): Promise<void> {
  const scanResp = await supabase
    .from("cm_scan")
    .select("*")
    .eq("id", scanId)
    .single() as unknown as { data: CmScanRow | null; error: { message: string } | null };

  if (scanResp.error || !scanResp.data) {
    throw new Error(`Failed to load cm_scan ${scanId}: ${scanResp.error?.message ?? "not found"}`);
  }

  const scan = scanResp.data;

  if (!canTransitionScan(scan.status as never, "rescanning")) {
    console.log(`[rescan] scan ${scanId} cannot transition to rescanning (status=${scan.status})`);
    return;
  }

  await supabase
    .from("cm_scan")
    .update({ status: "rescanning", current_step: "Re-scanning after fixes..." })
    .eq("id", scanId);

  try {
    const { externalScanId } = await scanProvider.scan(
      { owner: scan.repo_id, name: "" },
      "main",
    );

    const findings = await scanProvider.fetchResults(externalScanId);

    if (findings.length === 0) {
      await supabase
        .from("cm_scan")
        .update({
          status: "verified",
          findings_total: 0,
          findings_actionable: 0,
          current_step: "All findings resolved",
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);

      console.log(`[rescan] scan ${scanId}: clean, marked verified`);
      return;
    }

    const pipelineResp = await supabase
      .from("cm_pipeline")
      .select("max_fix_attempts")
      .limit(1)
      .single() as unknown as { data: CmPipelineRow | null; error: { message: string } | null };

    const maxAttempts = pipelineResp.data?.max_fix_attempts ?? 2;

    const fixCountResp = await supabase
      .from("cm_finding")
      .select("fix_attempts")
      .eq("scan_id", scanId) as unknown as { data: Array<{ fix_attempts: number }> | null };

    const fixCounts = fixCountResp.data ?? [];
    const maxFixAttempt = fixCounts.length > 0
      ? Math.max(...fixCounts.map((f) => f.fix_attempts))
      : 0;

    if (maxFixAttempt >= maxAttempts) {
      await supabase
        .from("cm_scan")
        .update({
          status: "needs_human",
          current_step: "Fix attempts exhausted, needs human review",
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);

      console.log(`[rescan] scan ${scanId}: fix attempts exhausted (${maxFixAttempt}/${maxAttempts}), needs human`);
      return;
    }

    const actionable = findings.filter(
      (f) => f.severity === "CRITICAL" || f.severity === "HIGH",
    ).length;

    await supabase
      .from("cm_scan")
      .update({
        status: "fixed",
        findings_actionable: actionable,
        findings_total: findings.length,
        current_step: "Findings remain, re-fixing...",
      })
      .eq("id", scanId);

    console.log(`[rescan] scan ${scanId}: ${actionable} findings remain, sending back to fix`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from("cm_scan")
      .update({
        status: "scan_failed",
        error: errorMsg,
        current_step: "Rescan failed",
        finished_at: new Date().toISOString(),
      })
      .eq("id", scanId);

    throw err;
  }
}
