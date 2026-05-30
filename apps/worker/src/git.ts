import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type JobForGit = {
  id: string;
  title: string;
};

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildCloneUrl(owner: string, repo: string, token: string): string {
  return `https://${token}@github.com/${owner}/${repo}.git`;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

export async function cloneAndBranch(
  job: JobForGit,
  owner: string,
  repo: string,
  token: string,
): Promise<{ dir: string; branch: string }> {
  const dir = join(tmpdir(), `conductor-${job.id}`);
  const cloneUrl = buildCloneUrl(owner, repo, token);
  const branch = `feature/${toSlug(job.title)}`;

  try {
    await execFileAsync("git", ["clone", "--depth=1", cloneUrl, dir]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // strip token from error message before propagating
    throw new Error(`git clone failed: ${msg.replace(token, "***")}`);
  }

  await git(dir, "checkout", "-b", branch);

  return { dir, branch };
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
