import { createClient } from "@/lib/supabase/server";
import { JobsClient } from "./jobs-client";
import type { JobRow, ProjectRow } from "@conductor/core";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const supabase = await createClient();

  const [{ data: jobs }, { data: projectsRaw }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("projects").select("id, owner, repo"),
  ]);

  const projects = (projectsRaw ?? []) as Pick<ProjectRow, "id" | "owner" | "repo">[];

  const projectMap = new Map<string, Pick<ProjectRow, "owner" | "repo">>();
  for (const p of projects) {
    projectMap.set(p.id, { owner: p.owner, repo: p.repo });
  }

  return (
    <JobsClient
      initialJobs={(jobs ?? []) as JobRow[]}
      projectMap={Object.fromEntries(projectMap)}
    />
  );
}
