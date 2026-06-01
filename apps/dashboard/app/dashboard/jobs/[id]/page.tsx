import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JobDetailClient } from "./job-detail-client";
import type { JobRow, RunRow, JobStatus } from "@conductor/core";

export const dynamic = "force-dynamic";

const FIXTURE_JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OPEN_QUESTIONS = [
  "Hangi kimlik doğrulama yöntemi kullanılacak? (email/password, OAuth, SSO)",
  "Mevcut kullanıcı tablosu var mı yoksa sıfırdan mı oluşturulsun?",
];
const FIXTURE_WAITING_JOB: JobRow = {
  id: FIXTURE_JOB_ID,
  project_id: "00000000-0000-0000-0000-000000000001",
  parent_job_id: null,
  type: "feature",
  title: "Login ekle",
  description: "Kullanıcıların sisteme giriş yapabilmesini istiyorum.",
  lane_preference: "auto",
  status: "waiting_input",
  branch: null,
  pr_url: null,
  spec: { summary: "Login ekle", user_stories: [], acceptance_criteria: [], out_of_scope: [], open_questions: OPEN_QUESTIONS, research_notes: [] },
  plan: null,
  answers: null,
  prd: null,
  prd_approved: false,
  research_output: null,
  scaffold_repo: null,
  idea_loop_count: 0,
  idea_constraints: null,
  error: null,
  current_agent: null,
  current_step_message: null,
  started_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface Props {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | undefined>>;
}

export default async function JobDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  // Test fixture: bypass DB for E2E tests
  if (process.env["NODE_ENV"] !== "production" && id === FIXTURE_JOB_ID) {
    const fixture = sp["__fixture"];
    if (fixture === "waiting_input") {
      return <JobDetailClient initialJob={FIXTURE_WAITING_JOB} initialRuns={[]} costMap={{}} initialChildJobs={[]} />;
    }
    if (fixture === "queued_no_questions") {
      const queuedJob: JobRow = {
        ...FIXTURE_WAITING_JOB,
        status: "queued",
        spec: { summary: "Login ekle", user_stories: [], acceptance_criteria: [], out_of_scope: [], open_questions: [], research_notes: [] },
      };
      return <JobDetailClient initialJob={queuedJob} initialRuns={[]} costMap={{}} initialChildJobs={[]} />;
    }
  }

  const supabase = await createClient();

  const [{ data: job }, { data: runs }, { data: childJobsRaw }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("runs")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, title, status")
      .eq("parent_job_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!job) notFound();

  const runIds = ((runs ?? []) as RunRow[]).map((r) => r.id);

  // Fetch usage_log for these run_ids
  const costMap: Record<string, number> = {};
  if (runIds.length > 0) {
    const { data: logs } = await supabase
      .from("usage_log")
      .select("run_id, est_cost_usd")
      .in("run_id", runIds);

    for (const log of logs ?? []) {
      const l = log as { run_id: string; est_cost_usd: number | null };
      if (l.est_cost_usd !== null) {
        costMap[l.run_id] = (costMap[l.run_id] ?? 0) + l.est_cost_usd;
      }
    }
  }

  const childJobs = (childJobsRaw ?? []) as { id: string; title: string; status: JobStatus }[];

  return (
    <JobDetailClient
      initialJob={job as JobRow}
      initialRuns={(runs ?? []) as RunRow[]}
      costMap={costMap}
      initialChildJobs={childJobs}
    />
  );
}
