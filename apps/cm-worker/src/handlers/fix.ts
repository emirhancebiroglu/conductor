import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider, AgentRunner } from "@conductor/cm-adapters";
import { GitOps } from "@conductor/cm-adapters";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Command } from "@langchain/langgraph";
import { canTransitionScan } from "@conductor/cm-core";
import type { CmFinding } from "@conductor/cm-core";
import { buildFixGraph, rowToFinding, type CmFindingRow } from "../pipeline/fix-graph.js";
import { resolveCloneBranch } from "../pipeline/branch-resolution.js";

/**
 * Marker written to cm_scan.current_step by the dashboard's resume API route
 * to request that a paused (needs_human) scan's fix graph be resumed. Picked
 * up by index.ts's poll loop, which enqueues a normal QUEUE_FIX job — handleFix
 * detects the paused checkpoint and resumes instead of starting fresh.
 */
export const RESUME_REQUESTED_MARKER = "__resume_requested__";

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

type CmPipelineRow = {
  sca_test_policy: string;
  fix_branch: string;
  severity_threshold: string[];
  max_fix_attempts: number;
  report_dir: string;
};

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

/**
 * Thin entrypoint: loads inputs, then hands off to the durable fix-pipeline
 * graph (pipeline/fix-graph.ts). The graph owns plan→fix→verify→rescan
 * orchestration, checkpointed to Postgres so an interrupted/crashed run
 * resumes instead of restarting from scratch.
 */
export async function handleFix(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  agentRunner: AgentRunner,
  checkpointer: BaseCheckpointSaver,
  scanId: string,
  gitOps?: GitOps,
): Promise<void> {
  const ops = gitOps ?? new GitOps();
  const graph = buildFixGraph({ supabase, scanProvider, agentRunner, ops, checkpointer });
  const threadConfig = { configurable: { thread_id: scanId } };

  // A paused (interrupted) checkpoint takes priority over the normal
  // load-and-start-fresh path — this is what makes "resume from where it
  // was cut off" work: loadFixInputs' canTransitionScan gate would otherwise
  // reject a needs_human scan (needs_human isn't allowed to transition back
  // to "fixing"), so a resumable thread must be detected before that gate.
  const existing = await graph.getState(threadConfig);
  if (existing.next.length > 0) {
    console.log(`[fix] scan ${scanId}: resuming from checkpoint (paused at ${existing.next.join(",")})`);
    await graph.invoke(new Command({ resume: true }), threadConfig);
    return;
  }

  const inputs = await loadFixInputs(supabase, scanId);
  if (!inputs) return;

  const { scan, repo, scaPolicy, severityThreshold, maxFixAttempts, fixBranch, reportDir, findings } = inputs;

  await supabase
    .from("cm_scan")
    .update({ status: "fixing", current_step: "Running fix planner..." })
    .eq("id", scanId);

  const repoUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
  const fallbackBranch = scan.branch_scanned ?? repo.default_branch;
  const { cloneBranch, isExistingFixBranch } = await resolveCloneBranch(ops, repoUrl, fixBranch, fallbackBranch);
  console.log(`[fix] scan ${scanId}: cloning from ${cloneBranch} (${isExistingFixBranch ? "existing fix branch, reusing prior work" : "fallback branch, fix branch will be created fresh"})`);

  await graph.invoke({
    scanId,
    workspaceId: scan.workspace_id,
    repo: { owner: repo.owner, name: repo.name },
    repoUrl,
    cloneBranch,
    fixBranch,
    scaPolicy,
    severityThreshold,
    maxFixAttempts,
    reportDir,
    runConfig: {},
    attempt: 1,
    findings,
    planItems: [],
    baselineBuildOutput: undefined,
    verifyOutcome: undefined,
    verifySummary: undefined,
  }, threadConfig);
}
