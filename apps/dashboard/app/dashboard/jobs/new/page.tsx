import { createClient } from "@/lib/supabase/server";
import type { ProjectRow } from "@conductor/core";
import { NewJobClient } from "./new-job-client";

export default async function NewJobPage() {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  return <NewJobClient projects={(projects ?? []) as ProjectRow[]} />;
}
