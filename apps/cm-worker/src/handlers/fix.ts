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

type CategoryFixOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  sca: CmFinding[];
  sast: CmFinding[];
  scaPolicy: "skip-minor" | "test-all";
  planItems: Parameters<typeof processScaFindings>[0]["planItems"];
  primaryDir: string;
  runConfig: RunConfig;
  ops: GitOps;
  repoUrl: string;
  cloneBranch: string;
  fixBranch: string;
};

/**
 * Runs SCA and SAST fixes for one attempt. If only one category has findings,
 * it runs alone against the primary clone. If both do, they run in parallel
 * against separate clones (agents share nothing, avoiding concurrent-edit
 * races in one worktree), then the SAST clone's diff is merged onto the
 * primary (SCA) clone before verification/commit.
 */
async function runCategoryFixes(opts: CategoryFixOptions): Promise<void> {
  const { supabase, agentRunner, scanId, workspaceId, sca, sast, scaPolicy, planItems, primaryDir, runConfig, ops, repoUrl, cloneBranch, fixBranch } = opts;

  if (sca.length > 0 && sast.length === 0) {
    await processScaFindings({
      supabase, agentRunner, scanId, workspaceId,
      findings: sca, policy: scaPolicy, workingDir: primaryDir, runConfig, planItems,
    });
    return;
  }

  if (sast.length > 0 && sca.length === 0) {
    await processSastFindings({
      supabase, agentRunner, scanId, workspaceId,
      findings: sast, workingDir: primaryDir, runConfig, planItems,
    });
    return;
  }

  if (sca.length === 0 && sast.length === 0) {
    return;
  }

  // Both categories present — parallel clones.
  const secondaryDir = await ops.cloneToTemp(repoUrl, cloneBranch);
  try {
    await ops.createBranch(secondaryDir, fixBranch);

    const [, sastResults] = await Promise.all([
      processScaFindings({
        supabase, agentRunner, scanId, workspaceId,
        findings: sca, policy: scaPolicy, workingDir: primaryDir, runConfig, planItems,
      }),
      processSastFindings({
        supabase, agentRunner, scanId, workspaceId,
        findings: sast, workingDir: secondaryDir, runConfig, planItems,
      }),
    ]);

    const patch = await ops.diffPatch(secondaryDir);
    const applied = await ops.applyPatch(primaryDir, patch);

    if (!applied) {
      console.warn(`[fix] scan ${scanId}: merge conflict applying SAST changes onto SCA clone, deferring SAST fixes to next attempt`);
      for (const r of sastResults) {
        if (r.fixStatus === "fixed") {
          await supabase
            .from("cm_finding")
            .update({ fix_status: "failed", fix_notes: "merge conflict with SCA fixes this attempt, will retry next attempt" })
            .eq("id", r.finding.id);
        }
      }
    }
  } finally {
    await ops.cleanup(secondaryDir).catch(() => undefined);
  }
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

type FixAttemptContext = {
  supabase: SupabaseClient;
  scanProvider: ScanProvider;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  repo: { owner: string; name: string };
  workDir: string;
  ops: GitOps;
  repoUrl: string;
  cloneBranch: string;
  fixBranch: string;
  scaPolicy: "skip-minor" | "test-all";
  severityThreshold: CmFinding["severity"][];
  runConfig: RunConfig;
  attempt: number;
  maxFixAttempts: number;
};

type FixAttemptOutcome =
  | { kind: "clean" }
  | { kind: "verification_failed"; summary: string }
  | { kind: "continue"; remainingFindings: CmFinding[] };

/** Runs one plan→fix→verify→commit→rescan cycle for a single fix attempt. */
async function runFixAttempt(ctx: FixAttemptContext, findings: CmFinding[]): Promise<FixAttemptOutcome> {
  const { supabase, scanProvider, agentRunner, scanId, workspaceId, repo, workDir, ops, repoUrl, cloneBranch, fixBranch, scaPolicy, severityThreshold, runConfig, attempt, maxFixAttempts } = ctx;

  const { sca, sast } = filterAndRouteFindings(findings, severityThreshold);
  const actionable = [...sca, ...sast];
  if (actionable.length === 0) {
    return { kind: "clean" };
  }

  await supabase
    .from("cm_scan")
    .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: planning...` })
    .eq("id", scanId);

  const plan = await runPlanner(supabase, agentRunner, scanId, workspaceId, actionable, workDir);

  const toFix = plan.items.filter((i) => i.strategy !== "skip" && i.strategy !== "needs-human");
  const needsHuman = plan.items.filter((i) => i.strategy === "needs-human");
  if (needsHuman.length > 0) {
    console.log(`[fix] scan ${scanId}: ${needsHuman.length} findings flagged needs-human`);
  }
  console.log(`[fix] scan ${scanId}: ${toFix.length} to fix, ${needsHuman.length} needs-human`);

  const stepLabel = sca.length > 0 && sast.length > 0
    ? `fixing ${sca.length} SCA + ${sast.length} SAST findings in parallel...`
    : `fixing ${sca.length + sast.length} findings...`;
  await supabase
    .from("cm_scan")
    .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: ${stepLabel}` })
    .eq("id", scanId);

  await runCategoryFixes({
    supabase, agentRunner, scanId, workspaceId,
    sca, sast, scaPolicy, planItems: plan.items,
    primaryDir: workDir, runConfig,
    ops, repoUrl, cloneBranch, fixBranch,
  });

  await supabase
    .from("cm_scan")
    .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: verifying...` })
    .eq("id", scanId);

  const { passed, summary: verifySummary } = await runVerifier({
    supabase, agentRunner, scanId, workspaceId, workingDir: workDir, runConfig,
  });

  if (!passed) {
    return { kind: "verification_failed", summary: verifySummary };
  }

  await ops.commitAll(workDir, `chore(security): apply Checkmarx fix(es) [cm-auto attempt ${attempt}]`);

  await supabase
    .from("cm_scan")
    .update({ current_step: `Fix attempt ${attempt}/${maxFixAttempts}: rescanning...` })
    .eq("id", scanId);

  await ops.push(workDir, fixBranch);
  const rescanResult = await rescanFixBranch(supabase, scanProvider, repo, fixBranch);

  if (rescanResult.clean) {
    return { kind: "clean" };
  }

  const nextFindingsResp = await supabase
    .from("cm_finding")
    .select("*")
    .eq("scan_id", scanId)
    .in("fix_status", ["open", "failed"]) as unknown as { data: CmFindingRow[] | null; error: { message: string } | null };

  return { kind: "continue", remainingFindings: (nextFindingsResp.data ?? []).map(rowToFinding) };
}

type FixInputs = {
  scan: CmScanRow;
  repo: CmRepoRow;
  scaPolicy: "skip-minor" | "test-all";
  severityThreshold: CmFinding["severity"][];
  maxFixAttempts: number;
  fixBranch: string;
  reportDir: string;
  findings: CmFinding[];
};

/** Loads and validates everything handleFix needs; returns null when the scan should be skipped (not an error). */
async function loadFixInputs(supabase: SupabaseClient, scanId: string): Promise<FixInputs | null> {
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
    return null;
  }

  if (scan.findings_actionable === 0) {
    console.log(`[fix] scan ${scanId} has no actionable findings, skipping fix`);
    return null;
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

  const pipelineResp = await supabase
    .from("cm_pipeline")
    .select("sca_test_policy, fix_branch, severity_threshold, max_fix_attempts, report_dir")
    .eq("id", repo.pipeline_id)
    .single() as unknown as { data: CmPipelineRow | null; error: { message: string } | null };

  const pipeline = pipelineResp.data;

  const findingsResp = await supabase
    .from("cm_finding")
    .select("*")
    .eq("scan_id", scanId)
    .in("fix_status", ["open", "failed"]) as unknown as { data: CmFindingRow[] | null; error: { message: string } | null };

  if (findingsResp.error || !findingsResp.data || findingsResp.data.length === 0) {
    console.log(`[fix] scan ${scanId}: no open findings to fix`);
    return null;
  }

  return {
    scan,
    repo,
    scaPolicy: (pipeline?.sca_test_policy ?? "skip-minor") as "skip-minor" | "test-all",
    severityThreshold: (pipeline?.severity_threshold ?? ["CRITICAL", "HIGH"]) as CmFinding["severity"][],
    maxFixAttempts: pipeline?.max_fix_attempts ?? 2,
    fixBranch: pipeline?.fix_branch ?? "checkmarx-fix",
    reportDir: pipeline?.report_dir ?? "D:/checkmarx-reports",
    findings: findingsResp.data.map(rowToFinding),
  };
}

export async function handleFix(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  agentRunner: AgentRunner,
  scanId: string,
  gitOps?: GitOps,
): Promise<void> {
  const inputs = await loadFixInputs(supabase, scanId);
  if (!inputs) return;

  const { scan, repo, scaPolicy, severityThreshold, maxFixAttempts, fixBranch, reportDir, findings } = inputs;

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

    let allFindings = findings;
    let attempt = 0;
    let allClean = false;

    const attemptCtx: Omit<FixAttemptContext, "attempt"> = {
      supabase, scanProvider, agentRunner, scanId,
      workspaceId: scan.workspace_id,
      repo, workDir, ops, repoUrl, cloneBranch, fixBranch,
      scaPolicy, severityThreshold, runConfig, maxFixAttempts,
    };

    while (attempt < maxFixAttempts && !allClean) {
      attempt++;
      console.log(`[fix] scan ${scanId}: fix attempt ${attempt}/${maxFixAttempts}`);

      const outcome = await runFixAttempt({ ...attemptCtx, attempt }, allFindings);

      if (outcome.kind === "clean") {
        allClean = true;
        console.log(`[fix] scan ${scanId}: rescan clean — all CRITICAL/HIGH resolved`);
        break;
      }

      if (outcome.kind === "verification_failed") {
        console.log(`[fix] scan ${scanId}: verifier failed — ${outcome.summary.slice(0, 200)}`);
        await supabase
          .from("cm_scan")
          .update({ status: "needs_human", current_step: `Verification failed: ${outcome.summary.slice(0, 300)}` })
          .eq("id", scanId);
        return;
      }

      console.log(`[fix] scan ${scanId}: CRITICAL/HIGH remain after attempt ${attempt}`);
      allFindings = outcome.remainingFindings;
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
