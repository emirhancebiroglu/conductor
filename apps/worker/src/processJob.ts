import { cloneAndBranch, cleanup } from "./git.js";
import { runPipeline } from "./orchestrator.js";
import { runIdeaPipeline, runScaffoldPhase } from "./ideaOrchestrator.js";
import { invalidateConfigCache } from "./agentConfig.js";

// why: supabase any client passed through — typed at call site
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

export type Job = {
  id: string;
  project_id: string;
  workspace_id?: string | null;
  title: string;
  description: string;
  type: string;
  lane_preference: string;
  answers?: Record<string, string> | null;
  idea_loop_count?: number | null;
  idea_constraints?: unknown | null;
  research_output?: unknown | null;
  prd?: string | null;
  prd_approved?: boolean | null;
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
  invalidateConfigCache();
  console.log(`[worker] processing job ${job.id} type=${job.type} workspace=${job.workspace_id ?? "unset"}`);

  // ── Idea pipeline: no repo clone needed ────────────────────────────────────
  if (job.type === "idea") {
    if (job.prd_approved === true) {
      // PRD human-approved → scaffold phase
      try {
        await updateJob(supabase, job.id, { status: "scaffolding", started_at: new Date().toISOString() });
        await runScaffoldPhase(supabase, job);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker] scaffold job ${job.id} unhandled error: ${msg}`);
        await updateJob(supabase, job.id, { status: "failed", error: msg }).catch(() => {});
      } finally {
        await updateJob(supabase, job.id, { current_agent: null, current_step_message: null }).catch(() => {});
      }
    } else {
      // Research + debate + PRD generation
      try {
        await updateJob(supabase, job.id, { status: "researching", started_at: new Date().toISOString() });
        await runIdeaPipeline(supabase, job);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker] idea job ${job.id} unhandled error: ${msg}`);
        await updateJob(supabase, job.id, { status: "failed", error: msg }).catch(() => {});
      } finally {
        await updateJob(supabase, job.id, { current_agent: null, current_step_message: null }).catch(() => {});
      }
    }
    return;
  }

  // ── Feature pipeline: requires repo clone ──────────────────────────────────
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
      job.answers ?? undefined,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} unhandled error: ${msg}`);
    await updateJob(supabase, job.id, { status: "failed", error: msg }).catch(() => {});
  } finally {
    await updateJob(supabase, job.id, { current_agent: null, current_step_message: null }).catch(() => {});
    if (repoDir) cleanup(repoDir);
  }
}
