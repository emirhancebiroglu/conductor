import { createClient } from "@/lib/supabase/server";
import { ProjectsClient } from "./projects-client";
import type { ProjectRow } from "@conductor/core";

export default async function ProjectsPage() {
  const supabase = await createClient();

  const { data: connected, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  const connectedProjects: ProjectRow[] = (connected ?? []) as ProjectRow[];

  return (
    <ProjectsClient
      initialConnected={connectedProjects}
      fetchError={error?.message ?? null}
    />
  );
}
