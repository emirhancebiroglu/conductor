import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider } from "@conductor/cm-adapters";
import { canTransitionScan } from "@conductor/cm-core";

export type ScanJob = {
  scanId: string;
};

type CmScanRow = {
  id: string;
  repo_id: string;
  workspace_id: string;
  status: string;
  provider: string;
  external_scan_id: string | null;
  branch_scanned: string | null;
  trigger: string;
  findings_total: number;
  findings_actionable: number;
  error: string | null;
  current_step: string | null;
  pr_url: string | null;
  report_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function handleScan(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  job: ScanJob,
): Promise<void> {
  const { scanId } = job;

  // why: supabase-js returns untyped rows; we cast to CmScanRow after the call
  const scanResp = await supabase
    .from("cm_scan")
    .select("*")
    .eq("id", scanId)
    .single() as unknown as { data: CmScanRow | null; error: { message: string } | null };

  if (scanResp.error || !scanResp.data) {
    throw new Error(`Failed to load cm_scan ${scanId}: ${scanResp.error?.message ?? "not found"}`);
  }

  const scanRow = scanResp.data;

  if (!canTransitionScan(scanRow.status as never, "scanning")) {
    console.log(`[scan-handler] scan ${scanId} already processed (status=${scanRow.status}), skipping`);
    return;
  }

  await supabase
    .from("cm_scan")
    .update({
      status: "scanning",
      current_step: "Starting scan...",
      started_at: new Date().toISOString(),
    })
    .eq("id", scanId);

  try {
    const repo = { owner: scanRow.repo_id, name: "" };
    const { externalScanId } = await scanProvider.scan(repo, scanRow.branch_scanned ?? "main");

    await supabase
      .from("cm_scan")
      .update({ external_scan_id: externalScanId, current_step: "Fetching results..." })
      .eq("id", scanId);

    const findings = await scanProvider.fetchResults(externalScanId);

    for (const finding of findings) {
      await supabase.from("cm_finding").upsert(
        {
          scan_id: scanId,
          workspace_id: scanRow.workspace_id,
          source: finding.source,
          severity: finding.severity,
          rule: finding.rule,
          package: finding.package,
          current_version: finding.currentVersion,
          fixed_version: finding.fixedVersion,
          upgrade_impact: finding.upgradeImpact,
          file: finding.file,
          line: finding.line,
          fingerprint: finding.fingerprint,
          fix_status: "open",
          fix_attempts: 0,
        },
        { onConflict: "scan_id, fingerprint", ignoreDuplicates: false },
      );
    }

    const findingsTotal = findings.length;
    const findingsActionable = findings.filter(
      (f) => f.severity === "CRITICAL" || f.severity === "HIGH",
    ).length;

    await supabase
      .from("cm_scan")
      .update({
        status: "scan_done",
        findings_total: findingsTotal,
        findings_actionable: findingsActionable,
        current_step: `Scan complete: ${findingsTotal} findings (${findingsActionable} actionable)`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", scanId);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from("cm_scan")
      .update({
        status: "scan_failed",
        error: errorMsg,
        current_step: "Scan failed",
        finished_at: new Date().toISOString(),
      })
      .eq("id", scanId);

    throw err;
  }
}
