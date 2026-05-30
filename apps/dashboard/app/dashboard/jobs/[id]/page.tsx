import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JobDetailClient } from "./job-detail-client";
import type { JobRow, RunRow } from "@conductor/core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: job }, { data: runs }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("runs")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!job) notFound();

  return (
    <JobDetailClient
      initialJob={job as JobRow}
      initialRuns={(runs ?? []) as RunRow[]}
    />
  );
}
