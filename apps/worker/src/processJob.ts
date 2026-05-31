import { cloneAndBranch, cleanup } from "./git.js";
import { runPipeline } from "./orchestrator.js";

// why: supabase any client passed through — typed at call site
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

export type Job = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  type: string;
  lane_preference: string;
};

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

async function updateJob(
  supabase: SupabaseAny,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`updateJob failed: ${(error as { message: string }).message}`);
}

export async function processJob(supabase: SupabaseAny, job: Job): Promise<void> {
  const token = requireEnv("CONDUCTOR_GITHUB_TOKEN");

  const { data: project } = await supabase
    .from("projects")
    .select("owner, repo, default_branch")
    .eq("id", job.project_id)
    .single();

  if (!project) throw new Error(`Project not found: ${job.project_id}`);

  const owner = project.owner as string;
  const repo = project.repo as string;
  const defaultBranch = (project.default_branch as string) ?? "main";

  let repoDir: string | null = null;

  try {
    await updateJob(supabase, job.id, { status: "running", started_at: new Date().toISOString() });

    const { dir } = await cloneAndBranch(job, owner, repo, token);
    repoDir = dir;

    await runPipeline(
      supabase,
      { ...job },
      { owner, repo, default_branch: defaultBranch },
      repoDir,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} unhandled error: ${msg}`);
    await updateJob(supabase, job.id, { status: "failed", error: msg }).catch(() => {});
  } finally {
    if (repoDir) cleanup(repoDir);
  }
}
