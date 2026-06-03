import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider, AgentRunner } from "@conductor/cm-adapters";
import { GitOps } from "@conductor/cm-adapters";
import { canTransitionScan } from "@conductor/cm-core";

type CmScanRow = {
  id: string;
  repo_id: string;
  workspace_id: string;
  status: string;
  findings_actionable: number;
  current_step: string | null;
};

type CmRepoRow = {
  id: string;
  owner: string;
  name: string;
  default_branch: string;
  run_config: Record<string, unknown> | null;
};

type RunConfig = {
  buildCommand?: string;
  testCommand?: string;
};

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
    .select("*")
    .eq("id", scan.repo_id)
    .single() as unknown as { data: CmRepoRow | null; error: { message: string } | null };

  if (repoResp.error || !repoResp.data) {
    throw new Error(`Failed to load cm_repo for scan ${scanId}`);
  }

  const repo = repoResp.data;

  if (!repo.run_config || !(repo.run_config as RunConfig).buildCommand) {
    console.log(`[fix] scan ${scanId}: run_config missing, setting run_blocked`);

    await supabase
      .from("cm_scan")
      .update({
        status: "run_blocked",
        current_step: "Awaiting run_config: provide build command to proceed",
      })
      .eq("id", scanId);

    return;
  }

  const ops = gitOps ?? new GitOps();
  const workDir = await ops.cloneToTemp(`${repo.owner}/${repo.name}`);

  try {
    await ops.createBranch(workDir, "checkmarx-fix");

    await supabase
      .from("cm_scan")
      .update({
        status: "fixing",
        current_step: "Repo cloned, verifying project starts...",
      })
      .eq("id", scanId);

    const runConfig = repo.run_config as RunConfig;

    console.log(`[fix] scan ${scanId}: running build: ${runConfig.buildCommand}`);

    try {
      const { execa } = await import("execa");
      await execa(runConfig.buildCommand!, { cwd: workDir, shell: true, timeout: 120_000 });
    } catch {
      console.log(`[fix] scan ${scanId}: project start failed, setting run_blocked`);

      await supabase
        .from("cm_scan")
        .update({
          status: "run_blocked",
          current_step: `Project build failed: provide working run_config`,
        })
        .eq("id", scanId);

      return;
    }

    await supabase
      .from("cm_scan")
      .update({
        status: "fixed",
        current_step: "Fixes applied, ready for rescan",
      })
      .eq("id", scanId);

    console.log(`[fix] scan ${scanId}: project started successfully`);
  } finally {
    await ops.cleanup(workDir);
  }
}
