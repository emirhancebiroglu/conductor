import { createClient } from "@/lib/supabase/server";
import { JobsClient } from "./jobs-client";
import type { JobRow, ProjectRow } from "@conductor/core";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const supabase = await createClient();

  const [{ data: jobs }, { data: projectsRaw }] = await Promise.all([
    supabase.from("jobs").select("*").order("created_at", { ascending: false }),
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
    />
  );
}
