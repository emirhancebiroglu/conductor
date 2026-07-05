import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReport, saveReport, loadLogo } from "@conductor/cm-adapters";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/cm-worker/src/pipeline -> apps/cm-worker/assets/branding
const BRANDING_DIR = join(__dirname, "..", "..", "assets", "branding");

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

type CmFindingRow = {
  severity: string;
  source: string;
  rule: string | null;
  package: string | null;
  current_version: string | null;
  fixed_version: string | null;
  fix_status: string;
  fix_notes: string | null;
  upgrade_impact: string | null;
  file: string | null;
};

function deriveAnalystTestNote(f: CmFindingRow): string {
  if (f.source === "sca") {
    if (f.upgrade_impact === "MAJOR") {
      return `Major version bump — analyst should test functionality relying on ${f.package ?? "this package"} (check for breaking API changes; see reason/what-was-done above).`;
    }
    return "No need — minor/mid upgrade, no manual test required.";
  }
  return `Verify ${f.file ?? "the affected code path"} still behaves correctly after the fix (${f.rule ?? "this finding"}).`;
}

export async function generatePipelineReport(
  supabase: SupabaseClient,
  scanId: string,
  reportDir: string,
): Promise<string> {
  const scanResp = await supabase
    .from("cm_scan")
    .select("id, repo_id, workspace_id, status, findings_total, findings_actionable, started_at, finished_at")
    .eq("id", scanId)
    .single() as unknown as { data: CmScanRow | null };

  if (!scanResp.data) throw new Error(`Scan ${scanId} not found`);
  const scan = scanResp.data;

  const repoResp = await supabase
    .from("cm_repo")
    .select("name")
    .eq("id", scan.repo_id)
    .single() as unknown as { data: { name: string } | null };

  const repoName = repoResp.data?.name ?? "unknown";

  const findingsResp = await supabase
    .from("cm_finding")
    .select("severity, source, rule, package, current_version, fixed_version, fix_status, fix_notes, upgrade_impact, file")
    .eq("scan_id", scanId) as unknown as { data: CmFindingRow[] | null };

  const rawFindings = findingsResp.data ?? [];

  const findings = rawFindings.map((f) => {
    const isDecided = f.fix_status === "skipped" || f.fix_status === "failed" || f.fix_status === "needs_human";
    return {
      severity: f.severity,
      source: f.source,
      rule: f.rule,
      package: f.package,
      currentVersion: f.current_version,
      fixedVersion: f.fixed_version,
      fixStatus: f.fix_status,
      skipReason: isDecided ? f.fix_notes : null,
      whatWasDone: f.fix_status === "fixed"
        ? (f.source === "sca"
          ? `Upgraded ${f.package ?? "package"} from ${f.current_version ?? "?"} to ${f.fixed_version ?? "?"}`
          : f.fix_notes)
        : null,
      impactLevel: f.source === "sca" ? (f.upgrade_impact as "MAJOR" | "MID" | "MINOR" | null) : null,
      analystTestNote: deriveAnalystTestNote(f),
    };
  });

  const needsHuman = rawFindings
    .filter((f) => f.fix_status === "needs_human")
    .map((f) => ({
      rule: f.rule ?? f.package ?? "unknown",
      evidence: f.fix_notes ?? "No evidence recorded",
    }));

  const fixesApplied = rawFindings
    .filter((f) => f.fix_status === "fixed" || f.fix_status === "skipped")
    .map((f) => ({
      findingRule: f.rule ?? f.package ?? "unknown",
      applied: f.fix_status === "fixed",
      result: f.fix_status === "fixed" ? "Fixed" : "Skipped",
    }));

  const [operatorLogo, customerLogo] = await Promise.all([
    loadLogo(join(BRANDING_DIR, "32bit-logo.png")),
    loadLogo(join(BRANDING_DIR, "toyota-logo.png")),
  ]);

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
    fixes: fixesApplied,
    needsHuman,
    operatorLogo,
    customerLogo,
  });

  const filePath = await saveReport(buffer, reportDir, repoName);

  await supabase.from("cm_report").insert({
    scan_id: scanId,
    workspace_id: scan.workspace_id,
    path: filePath,
    format: "pdf",
  });

  await supabase
    .from("cm_scan")
    .update({ report_path: filePath })
    .eq("id", scanId);

  if (needsHuman.length > 0) {
    console.log(`[pipeline-report] ${needsHuman.length} needs_human items:`);
    for (const item of needsHuman) {
      console.log(`  - ${item.rule}: ${item.evidence.slice(0, 200)}`);
    }
  }

  console.log(`[pipeline-report] report saved to ${filePath}`);
  return filePath;
}
