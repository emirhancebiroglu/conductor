import type { SupabaseClient } from "@supabase/supabase-js";
import type { PgBoss } from "pg-boss";

const QUEUE_SCAN = "cm.scan";

type CmRepoRow = {
  id: string;
  pipeline_id: string;
  workspace_id: string;
  owner: string;
  name: string;
  default_branch: string;
  source: string;
  priority: number;
  enabled: boolean;
};

type CmPipelineRow = {
  id: string;
  workspace_id: string;
  enabled: boolean;
  cron: string;
};

// why: avoid re-logging the same "skipping" state on every poll tick
let lastLoggedSkipReason: string | null = null;

function logSkipOnce(reason: string): void {
  if (lastLoggedSkipReason !== reason) {
    console.log(reason);
    lastLoggedSkipReason = reason;
  }
}

export async function runScheduler(
  supabase: SupabaseClient,
  boss: PgBoss,
): Promise<void> {
  // why: supabase-js returns untyped rows
  const pipelineResp = await supabase
    .from("cm_pipeline")
    .select("*")
    .limit(1)
    .single() as unknown as { data: CmPipelineRow | null; error: { message: string } | null };

  if (pipelineResp.error || !pipelineResp.data) {
    logSkipOnce("[scheduler] no pipeline configured, skipping");
    return;
  }

  const pipeline = pipelineResp.data;

  if (!pipeline.enabled) {
    logSkipOnce("[scheduler] pipeline is disabled, skipping");
    return;
  }

  lastLoggedSkipReason = null;

  const reposResp = await supabase
    .from("cm_repo")
    .select("*")
    .eq("enabled", true)
    .order("priority", { ascending: true }) as unknown as { data: CmRepoRow[] | null; error: { message: string } | null };

  if (reposResp.error || !reposResp.data) {
    console.log("[scheduler] no repos found, skipping");
    return;
  }

  const repos = reposResp.data;

  console.log(`[scheduler] enqueuing ${repos.length} repos for scanning`);

  for (const repo of repos) {
    await boss.send(QUEUE_SCAN, {
      scanId: repo.id,
      repoOwner: repo.owner,
      repoName: repo.name,
      branch: repo.default_branch,
      trigger: "schedule",
    });
  }

  console.log(`[scheduler] enqueued ${repos.length} scan jobs`);
}

export async function registerCron(
  boss: PgBoss,
  cronExpression: string,
  pipelineId?: string,
): Promise<void> {
  await boss.schedule(
    "cm.scheduler",
    cronExpression,
    { pipelineId },
  );
}

export async function enqueueManualScan(
  boss: PgBoss,
  repo: { id: string; owner: string; name: string; defaultBranch: string },
): Promise<string> {
  const jobId = await boss.send(QUEUE_SCAN, {
    scanId: repo.id,
    repoOwner: repo.owner,
    repoName: repo.name,
    branch: repo.defaultBranch,
    trigger: "manual",
  });
  return jobId as string;
}
