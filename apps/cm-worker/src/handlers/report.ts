import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReport, saveReport } from "@conductor/cm-adapters";
import { canTransitionScan } from "@conductor/cm-core";

type CmScanRow = {
  id: string;
  repo_id: string;
  workspace_id: string;
  status: string;
  findings_total: number;
  findings_actionable: number;
  started_at: string | null;
  finished_at: string | null;
};

type CmRepoRow = {
  name: string;
};

type CmFindingRow = {
  severity: string;
  source: string;
  rule: string | null;
  package: string | null;
  current_version: string | null;
  fixed_version: string | null;
  fix_status: string;
};

export async function handleReport(
  supabase: SupabaseClient,
  scanId: string,
  reportDir: string,
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

  if (!canTransitionScan(scan.status as never, "reporting")) {
    console.log(`[report] scan ${scanId} cannot transition to reporting (status=${scan.status})`);
    return;
  }

  await supabase
    .from("cm_scan")
    .update({ status: "reporting", current_step: "Generating report..." })
    .eq("id", scanId);

  const repoResp = await supabase
    .from("cm_repo")
    .select("name")
    .eq("id", scan.repo_id)
    .single() as unknown as { data: CmRepoRow | null; error: { message: string } | null };

  const repoName = repoResp.data?.name ?? "unknown";

  const findingsResp = await supabase
    .from("cm_finding")
    .select("severity, source, rule, package, current_version, fixed_version, fix_status")
    .eq("scan_id", scanId) as unknown as { data: CmFindingRow[] | null; error: { message: string } | null };

  const findings = (findingsResp.data ?? []).map((f) => ({
    severity: f.severity,
    source: f.source,
    rule: f.rule,
    package: f.package,
    currentVersion: f.current_version,
    fixedVersion: f.fixed_version,
    fixStatus: f.fix_status,
  }));

  const buffer = await generateReport({
    scan: {
      id: scan.id,
      repoName,
      status: scan.status,
      findingsTotal: scan.findings_total,
      findingsActionable: scan.findings_actionable,
      startedAt: scan.started_at,
      finishedAt: scan.finished_at,
    },
    findings,
    fixes: [],
  });

  const filePath = await saveReport(buffer, reportDir, repoName);

  await supabase.from("cm_report").insert({
    scan_id: scanId,
    workspace_id: scan.workspace_id,
    path: filePath,
    format: "docx",
  });

  await supabase
    .from("cm_scan")
    .update({
      status: "done",
      report_path: filePath,
      current_step: "Report generated",
    })
    .eq("id", scanId);

  console.log(`[report] scan ${scanId}: report saved to ${filePath}`);
}
