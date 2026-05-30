import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createOctokit, createPR } from "@conductor/github";
import { cloneAndBranch, cleanup } from "./git.js";
import { runClaudeAgent } from "./runner.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Job = {
  id: string;
  title: string;
  description: string;
  type: string;
  lane_preference: string;
};

// why: supabase any client passed through — same pattern as poll()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function updateJob(
  supabase: SupabaseAny,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`updateJob failed: ${(error as { message: string }).message}`);
}

async function logRun(
  supabase: SupabaseAny,
  jobId: string,
  status: "started" | "ok" | "failed",
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("runs").insert({
    job_id: jobId,
    agent: "claude-code",
    lane: "premium",
    status,
    input: status === "started" ? payload : null,
    output: status !== "started" ? payload : null,
    iteration: 1,
  });
  if (error) {
    // non-fatal: log to console but don't abort the job
    console.error(`[worker] logRun failed: ${(error as { message: string }).message}`);
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function gitCommit(repoDir: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", message], { cwd: repoDir });
}

async function gitPush(repoDir: string, branch: string): Promise<void> {
  await execFileAsync("git", ["push", "--set-upstream", "origin", branch], { cwd: repoDir });
}

// ---------------------------------------------------------------------------
// Prompt + PR body builders
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function buildPrompt(job: Job, owner: string, repo: string): string {
  return `Sen bir feature'ı implement eden senior bir yazılım geliştiricisin.

PROJE: ${owner}/${repo}
FEATURE BAŞLIĞI: ${job.title}
AÇIKLAMA: ${job.description}

Görevin:
1. Bu feature'ı mevcut kod tabanına uygun şekilde implement et
2. Gerekli dosyaları oluştur veya güncelle
3. Kodun çalışır durumda olduğundan emin ol
4. Sadece bu feature'ı implement et, kapsam dışına çıkma

Önemli:
- git commit yapma (worker yapacak)
- Test dosyaları oluşturma (sonraki adımda yapılacak)
- Sadece feature kodunu yaz`;
}

function buildPRBody(job: Job): string {
  return `## ${job.title}

${job.description}

---

🤖 **Conductor tarafından otomatik oluşturuldu**

⚠️ Bu PR insan incelemesi bekliyor — main'e merge etmeden önce kodu inceleyin

**Job ID:** \`${job.id}\``;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function processJob(supabase: SupabaseAny, job: Job): Promise<void> {
  let repoDir: string | null = null;

  const owner = requireEnv("GITHUB_REPO_OWNER");
  const repo = requireEnv("GITHUB_REPO_NAME");
  const token = requireEnv("GITHUB_TOKEN");
  const defaultBranch = process.env["GITHUB_DEFAULT_BRANCH"] ?? "main";

  try {
    await logRun(supabase, job.id, "started", { description: job.description });

    const { dir, branch } = await cloneAndBranch(job, owner, repo, token);
    repoDir = dir;
    await updateJob(supabase, job.id, { branch });

    const prompt = buildPrompt(job, owner, repo);
    const result = await runClaudeAgent({
      repoDir,
      prompt,
      jobId: job.id,
      onLine: (line, stream) => {
        console.log(`[agent:${stream}] ${line}`);
      },
    });

    if (!result.success) throw new Error(result.error);

    const commitMsg = `feat: ${job.title}\n\nConductor tarafından otomatik uygulandı.\nJob: ${job.id}`;
    await gitCommit(repoDir, commitMsg);
    await gitPush(repoDir, branch);

    const octokit = createOctokit(token);
    const prUrl = await createPR(
      octokit,
      owner,
      repo,
      job.title,
      buildPRBody(job),
      branch,
      defaultBranch,
    );

    await updateJob(supabase, job.id, { status: "pr_opened", pr_url: prUrl });
    await logRun(supabase, job.id, "ok", { pr_url: prUrl });

    console.log(`[worker] PR opened: ${prUrl}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} pipeline failed: ${msg}`);
    await updateJob(supabase, job.id, { status: "failed", error: msg }).catch(() => {});
    await logRun(supabase, job.id, "failed", { error: msg });
  } finally {
    if (repoDir) cleanup(repoDir);
  }
}
