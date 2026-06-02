import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";
import { JobsClient } from "./jobs-client";
import type { JobRow, ProjectRow } from "@conductor/core";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// E2E fixture data (never used in production)
// ---------------------------------------------------------------------------
const FIXTURE_WORKSPACE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const FIXTURE_WORK_JOB: JobRow = {
  id: "dddddddd-0000-0000-0000-000000000001",
  project_id: "bbbbbbbb-0000-0000-0000-000000000001",
  parent_job_id: null,
  workspace_id: FIXTURE_WORKSPACE_ID,
  type: "feature", title: "Work Feature Alpha",
  description: "A work feature", lane_preference: "auto", status: "queued",
  branch: null, pr_url: null, spec: null, plan: null, answers: null,
  prd: null, prd_approved: false, research_output: null, scaffold_repo: null,
  idea_loop_count: 0, idea_constraints: null, error: null,
  current_agent: null, current_step_message: null, started_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};
const FIXTURE_PERSONAL_JOB: JobRow = {
  ...FIXTURE_WORK_JOB,
  id: "dddddddd-0000-0000-0000-000000000002",
  workspace_id: "aaaaaaaa-0000-0000-0000-000000000002",
  title: "Personal Side Project",
};

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  // E2E fixture bypass — never active in production
  if (process.env["NODE_ENV"] !== "production") {
    const hdrs = await headers();
    const fixture = hdrs.get("x-fixture") ?? (await searchParams ?? {}).__fixture;
    if (fixture === "workspace_work") {
      return <JobsClient initialJobs={[FIXTURE_WORK_JOB]} projectMap={{}} costByJob={{}} workspaceId={FIXTURE_WORKSPACE_ID} />;
    }
    if (fixture === "workspace_personal") {
      return <JobsClient initialJobs={[FIXTURE_PERSONAL_JOB]} projectMap={{}} costByJob={{}} workspaceId="aaaaaaaa-0000-0000-0000-000000000002" />;
    }
  }

  const supabase = await createClient();

  const kind = await getActiveWorkspaceKind();
  const workspaceId = await resolveWorkspaceId(supabase, kind);

  const [{ data: jobs }, { data: projectsRaw }] = await Promise.all([
    supabase.from("jobs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("projects").select("id, owner, repo"),
  ]);

  const projects = (projectsRaw ?? []) as Pick<ProjectRow, "id" | "owner" | "repo">[];
  const projectMap = new Map<string, Pick<ProjectRow, "owner" | "repo">>();
  for (const p of projects) {
    projectMap.set(p.id, { owner: p.owner, repo: p.repo });
  }

  // Aggregate cost per job via runs → usage_log
  const costByJob: Record<string, number> = {};
  const jobList = (jobs ?? []) as JobRow[];

  if (jobList.length > 0) {
    const jobIds = jobList.map((j) => j.id);

    // Fetch runs for these jobs
    const { data: runRows } = await supabase
      .from("runs")
      .select("id, job_id")
      .in("job_id", jobIds);

    const runList = (runRows ?? []) as { id: string; job_id: string }[];
    const runIds = runList.map((r) => r.id);
    const jobIdByRunId = new Map<string, string>(runList.map((r) => [r.id, r.job_id]));

    if (runIds.length > 0) {
      const { data: usageLogs } = await supabase
        .from("usage_log")
        .select("run_id, est_cost_usd")
        .in("run_id", runIds);

      for (const log of usageLogs ?? []) {
        const l = log as { run_id: string; est_cost_usd: number | null };
        const jobId = jobIdByRunId.get(l.run_id);
        if (jobId && l.est_cost_usd !== null) {
          costByJob[jobId] = (costByJob[jobId] ?? 0) + l.est_cost_usd;
        }
      }
    }
  }

  return (
    <JobsClient
      initialJobs={jobList}
      projectMap={Object.fromEntries(projectMap)}
      costByJob={costByJob}
      workspaceId={workspaceId}
    />
  );
}
