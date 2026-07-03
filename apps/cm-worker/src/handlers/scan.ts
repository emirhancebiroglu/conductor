import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider } from "@conductor/cm-adapters";
import { canTransitionScan } from "@conductor/cm-core";
import type { CmFinding } from "@conductor/cm-core";

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

  // why: maybeSingle avoids "coerce to single JSON" error when 0 or multiple rows returned
  const scanResp = await supabase
    .from("cm_scan")
    .select("*")
    .eq("id", scanId)
    .maybeSingle() as unknown as { data: CmScanRow | null; error: { message: string } | null };

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

  console.log(`[scan-handler] processing scan ${scanId}`);

  // Load repo owner+name
  const repoResp = await supabase
    .from("cm_repo")
    .select("owner, name, default_branch")
    .eq("id", scanRow.repo_id)
    .maybeSingle() as unknown as { data: { owner: string; name: string; default_branch: string } | null; error: { message: string } | null };

  if (repoResp.error || !repoResp.data) {
    throw new Error(`Failed to load cm_repo ${scanRow.repo_id}: ${repoResp.error?.message ?? "not found"}`);
  }

  // Use repo's default_branch; fallback to branch_scanned recorded on the scan row
  const branch = scanRow.branch_scanned ?? repoResp.data.default_branch ?? "uat";

  try {
    const repo = { owner: repoResp.data.owner, name: repoResp.data.name };

    // Reuse the latest completed scan for this repo+branch if one exists —
    // a scheduled scan already keeps every repo fresh, so the initial
    // baseline scan doesn't need to clone+zip+submit a brand-new one.
    const cached = await scanProvider.getLatestScan?.(repo, branch);

    let externalScanId: string;
    let findings: CmFinding[];

    if (cached) {
      console.log(`[scan-handler] reusing latest completed scan ${cached.externalScanId} for ${repo.owner}/${repo.name}@${branch}`);
      externalScanId = cached.externalScanId;
      findings = await scanProvider.fetchResults(externalScanId);
    } else {
      const scanResult = await scanProvider.scan(repo, branch);
      externalScanId = scanResult.externalScanId;
      // Use embedded findings if scan() already parsed them (avoids second cx invocation)
      findings = scanResult.findings ?? await scanProvider.fetchResults(externalScanId);
    }

    await supabase
      .from("cm_scan")
      .update({ external_scan_id: externalScanId, branch_scanned: branch, current_step: "Fetching results..." })
      .eq("id", scanId);

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
          description: finding.description,
          taint_flow: finding.taintFlow,
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
