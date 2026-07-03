import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider, AgentRunner } from "@conductor/cm-adapters";
import { GitOps } from "@conductor/cm-adapters";
import { canTransitionScan } from "@conductor/cm-core";
import type { CmFinding } from "@conductor/cm-core";
import { filterAndRouteFindings } from "../pipeline/router.js";
import { runPlanner } from "../pipeline/planner.js";
import { processScaFindings } from "../pipeline/sca.js";
import { processSastFindings } from "../pipeline/sast.js";
import { runVerifier } from "../pipeline/verifier.js";
import { generatePipelineReport } from "../pipeline/report.js";

type CmScanRow = {
  id: string;
  repo_id: string;
  workspace_id: string;
  status: string;
  findings_actionable: number;
  current_step: string | null;
  branch_scanned: string | null;
};

type CmRepoRow = {
  id: string;
  owner: string;
  name: string;
  default_branch: string;
  pipeline_id: string;
};

type RunConfig = {
  buildCommand?: string;
  testCommand?: string;
};

function autoDetectRunConfig(workDir: string): RunConfig {
  if (existsSync(join(workDir, "pom.xml"))) {
    return { buildCommand: "mvn install -DskipTests -q", testCommand: "mvn test -q" };
  }
  if (existsSync(join(workDir, "package.json"))) {
    return { buildCommand: "npm install --prefer-offline", testCommand: "npm test --if-present" };
  }
  console.log(`[fix] autoDetectRunConfig: no pom.xml or package.json found in ${workDir}, skipping build/test`);
  return {};
}

type CmPipelineRow = {
  sca_test_policy: string;
  fix_branch: string;
  severity_threshold: string[];
  max_fix_attempts: number;
  report_dir: string;
};

type CmFindingRow = {
  id: string;
  scan_id: string;
  workspace_id: string;
  source: string;
  severity: string;
  rule: string | null;
  package: string | null;
  current_version: string | null;
  fixed_version: string | null;
  upgrade_impact: string | null;
  file: string | null;
  line: number | null;
  fingerprint: string;
  fix_status: string;
  fix_attempts: number;
  fix_notes: string | null;
  description: string | null;
  taint_flow: unknown;
};

function rowToFinding(row: CmFindingRow): CmFinding {
  return {
    id: row.id,
    scanId: row.scan_id,
    workspaceId: row.workspace_id,
    source: row.source as CmFinding["source"],
    severity: row.severity as CmFinding["severity"],
    rule: row.rule,
    package: row.package,
    currentVersion: row.current_version,
    fixedVersion: row.fixed_version,
    upgradeImpact: row.upgrade_impact as CmFinding["upgradeImpact"],
    file: row.file,
    line: row.line,
    fingerprint: row.fingerprint,
    fixStatus: row.fix_status as CmFinding["fixStatus"],
    fixAttempts: row.fix_attempts,
    fixNotes: row.fix_notes,
    description: row.description,
    taintFlow: (row.taint_flow as CmFinding["taintFlow"]) ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function rescanFixBranch(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  repo: { owner: string; name: string },
  fixBranch: string,
): Promise<{ clean: boolean }> {
  const scanResult = await scanProvider.scan(
    { owner: repo.owner, name: repo.name },
    fixBranch,
  );
  const findings = scanResult.findings ?? [];
  const criticalHigh = findings.filter(
    (f) => f.severity === "CRITICAL" || f.severity === "HIGH",
  );
  return { clean: criticalHigh.length === 0 };
}

export async function handleFix(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  agentRunner: AgentRunner,
  scanId: string,
  gitOps?: GitOps,
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

  if (!canTransitionScan(scan.status as never, "fixing")) {
    console.log(`[fix] scan ${scanId} cannot transition to fixing (status=${scan.status})`);
    return;
  }

  if (scan.findings_actionable === 0) {
    console.log(`[fix] scan ${scanId} has no actionable findings, skipping fix`);
    return;
  }

  const repoResp = await supabase
    .from("cm_repo")
    .select("id, owner, name, default_branch, pipeline_id")
    .eq("id", scan.repo_id)
    .single() as unknown as { data: CmRepoRow | null; error: { message: string } | null };

  if (repoResp.error || !repoResp.data) {
    throw new Error(`Failed to load cm_repo for scan ${scanId}`);
  }

  const repo = repoResp.data;

  // Load pipeline config
  const pipelineResp = await supabase
    .from("cm_pipeline")
    .select("sca_test_policy, fix_branch, severity_threshold, max_fix_attempts, report_dir")
    .eq("id", repo.pipeline_id)
    .single() as unknown as { data: CmPipelineRow | null; error: { message: string } | null };

  const pipeline = pipelineResp.data;
  const scaPolicy = (pipeline?.sca_test_policy ?? "skip-minor") as "skip-minor" | "test-all";
  const severityThreshold = (pipeline?.severity_threshold ?? ["CRITICAL", "HIGH"]) as CmFinding["severity"][];
  const maxFixAttempts = pipeline?.max_fix_attempts ?? 2;
  const fixBranch = pipeline?.fix_branch ?? "checkmarx-fix";
  const reportDir = pipeline?.report_dir ?? "D:/checkmarx-reports";

  // Load actionable findings
  const findingsResp = await supabase
    .from("cm_finding")
    .select("*")
    .eq("scan_id", scanId)
    .in("fix_status", ["open", "failed"]) as unknown as { data: CmFindingRow[] | null; error: { message: string } | null };

  if (findingsResp.error || !findingsResp.data || findingsResp.data.length === 0) {
    console.log(`[fix] scan ${scanId}: no open findings to fix`);
    return;
  }

  const ops = gitOps ?? new GitOps();
  const cloneBranch = scan.branch_scanned ?? repo.default_branch;
  const repoUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
  const workDir = await ops.cloneToTemp(repoUrl, cloneBranch);

  try {
    await ops.createBranch(workDir, fixBranch);

    const runConfig = autoDetectRunConfig(workDir);
    console.log(`[fix] scan ${scanId}: runConfig=${JSON.stringify(runConfig)}`);

    await supabase
      .from("cm_scan")
      .update({ status: "fixing", current_step: "Running fix planner..." })
      .eq("id", scanId);

    let allFindings = findingsResp.data.map(rowToFinding);
    let attempt = 0;
    let allClean = false;

    while (attempt < maxFixAttempts && !allClean) {
      attempt++;
      console.log(`[fix] scan ${scanId}: fix attempt ${attempt}/${maxFixAttempts}`);

      const { sca, sast } = filterAndRouteFindings(allFindings, severityThreshold);
      const actionable = [...sca, ...sast];

      if (actionable.length === 0) {
        allClean = true;
        break;
      }

      await supabase
        .from("cm_scan")
        .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: planning...` })
        .eq("id", scanId);

      // 1. Planner
      const plan = await runPlanner(
        supabase, agentRunner, scanId, scan.workspace_id, actionable, workDir,
      );

      const toFix = plan.items.filter((i) => i.strategy !== "skip" && i.strategy !== "needs-human");
      const needsHuman = plan.items.filter((i) => i.strategy === "needs-human");
      if (needsHuman.length > 0) {
        console.log(`[fix] scan ${scanId}: ${needsHuman.length} findings flagged needs-human`);
      }
      console.log(`[fix] scan ${scanId}: ${toFix.length} to fix, ${needsHuman.length} needs-human`);

      // 2. SCA fixes
      if (sca.length > 0) {
        await supabase
          .from("cm_scan")
          .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: fixing ${sca.length} SCA findings...` })
          .eq("id", scanId);

        await processScaFindings({
          supabase, agentRunner, scanId,
          workspaceId: scan.workspace_id,
          findings: sca, policy: scaPolicy,
          workingDir: workDir, runConfig,
          planItems: plan.items,
        });
      }

      // 3. SAST fixes
      if (sast.length > 0) {
        await supabase
          .from("cm_scan")
          .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: fixing ${sast.length} SAST findings...` })
          .eq("id", scanId);

        await processSastFindings({
          supabase, agentRunner, scanId,
          workspaceId: scan.workspace_id,
          findings: sast,
          workingDir: workDir, runConfig,
          planItems: plan.items,
        });
      }

      // 4. Verifier
      await supabase
        .from("cm_scan")
        .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: verifying...` })
        .eq("id", scanId);

      const { passed, summary: verifySummary } = await runVerifier({
        supabase, agentRunner, scanId,
        workspaceId: scan.workspace_id,
        workingDir: workDir, runConfig,
      });

      if (!passed) {
        console.log(`[fix] scan ${scanId}: verifier failed — ${verifySummary.slice(0, 200)}`);
        await supabase
          .from("cm_scan")
          .update({ status: "needs_human", current_step: `Verification failed: ${verifySummary.slice(0, 300)}` })
          .eq("id", scanId);
        return;
      }

      // 5. Commit
      await ops.commitAll(workDir, `chore(security): apply Checkmarx fix(es) [cm-auto attempt ${attempt}]`);

      // 6. Push and rescan the fix branch
      await supabase
        .from("cm_scan")
        .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: rescanning...` })
        .eq("id", scanId);

      await ops.push(workDir, fixBranch);
      const rescanResult = await rescanFixBranch(supabase, scanProvider, repo, fixBranch);

      if (rescanResult.clean) {
        allClean = true;
        console.log(`[fix] scan ${scanId}: rescan clean — all CRITICAL/HIGH resolved`);
      } else {
        console.log(`[fix] scan ${scanId}: CRITICAL/HIGH remain after attempt ${attempt}`);

        // Reload findings for next attempt
        const nextFindingsResp = await supabase
          .from("cm_finding")
          .select("*")
          .eq("scan_id", scanId)
          .in("fix_status", ["open", "failed"]) as unknown as { data: CmFindingRow[] | null; error: { message: string } | null };

        allFindings = (nextFindingsResp.data ?? []).map(rowToFinding);
      }
    }

    if (allClean) {
      await supabase
        .from("cm_scan")
        .update({ status: "verified", current_step: "All findings resolved, verified by rescan" })
        .eq("id", scanId);
      console.log(`[fix] scan ${scanId}: all fixes verified, generating report...`);

      // Generate report
      try {
        await generatePipelineReport(supabase, scanId, reportDir);
      } catch (reportErr) {
        console.error(`[fix] scan ${scanId}: report generation failed: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
      }
    } else {
      await supabase
        .from("cm_scan")
        .update({ status: "needs_human", current_step: `Fix attempts exhausted (${maxFixAttempts}), needs human review` })
        .eq("id", scanId);
      console.log(`[fix] scan ${scanId}: fix attempts exhausted, needs human`);
    }
  } finally {
    await ops.cleanup(workDir).catch(() => undefined);
  }
}
