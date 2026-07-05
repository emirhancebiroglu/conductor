import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider } from "@conductor/cm-adapters";
import { canTransitionScan } from "@conductor/cm-core";

type CmScanRow = {
  id: string;
  repo_id: string;
  workspace_id: string;
  status: string;
  branch_scanned: string | null;
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

  const repoResp = await supabase
    .from("cm_repo")
    .select("owner, name, default_branch")
    .eq("id", scan.repo_id)
    .single() as unknown as { data: { owner: string; name: string; default_branch: string } | null };

  if (!repoResp.data) {
    throw new Error(`cm_repo not found for scan ${scanId}`);
  }

  const branch = scan.branch_scanned ?? repoResp.data.default_branch ?? "uat";

  try {
    const { externalScanId } = await scanProvider.scan(
      { owner: repoResp.data.owner, name: repoResp.data.name },
      branch,
    );

    const rawFindings = await scanProvider.fetchResults(externalScanId);
    const findings = rawFindings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");

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

    await supabase
      .from("cm_scan")
      .update({
        status: "fixed",
        findings_actionable: findings.length,
        findings_total: findings.length,
        current_step: "Findings remain, re-fixing...",
      })
      .eq("id", scanId);

    console.log(`[rescan] scan ${scanId}: ${findings.length} findings remain, sending back to fix`);
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
