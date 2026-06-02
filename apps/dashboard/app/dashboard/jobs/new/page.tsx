import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";
import type { ProjectRow } from "@conductor/core";
import { NewJobClient } from "./new-job-client";

const FIXTURE_WORK_PROJECT: ProjectRow = {
  id: "bbbbbbbb-0000-0000-0000-000000000001",
  owner: "acme-corp", repo: "api-service", default_branch: "main",
  workspace_id: "aaaaaaaa-0000-0000-0000-000000000001",
  created_at: new Date().toISOString(),
};
const FIXTURE_PERSONAL_PROJECT: ProjectRow = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  owner: "emirhancebiroglu", repo: "side-project", default_branch: "main",
  workspace_id: "aaaaaaaa-0000-0000-0000-000000000002",
  created_at: new Date().toISOString(),
};

export default async function NewJobPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  // E2E fixture bypass — never active in production
  if (process.env["NODE_ENV"] !== "production") {
    const hdrs = await headers();
    const fixture = hdrs.get("x-fixture") ?? (await searchParams)?.["__fixture"];
    if (fixture === "workspace_work") {
      return <NewJobClient projects={[FIXTURE_WORK_PROJECT]} />;
    }
    if (fixture === "workspace_personal") {
      return <NewJobClient projects={[FIXTURE_PERSONAL_PROJECT]} />;
    }
  }

  const supabase = await createClient();
  const kind = await getActiveWorkspaceKind();
  const workspaceId = await resolveWorkspaceId(supabase, kind);

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return <NewJobClient projects={(projects ?? []) as ProjectRow[]} />;
}
