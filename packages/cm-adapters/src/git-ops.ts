import { execa } from "execa";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const TEMP_PREFIX = "cm-worker-";

function isUnderRoot(dir: string, root: string): boolean {
  const resolvedDir = resolve(dir);
  const resolvedRoot = resolve(root);
  if (resolvedDir === resolvedRoot) return false;
  return resolvedDir.startsWith(resolvedRoot + sep);
}

export class GitOps {
  private readonly tempRoot: string;

  constructor(tempRoot?: string) {
    this.tempRoot = tempRoot ?? join(tmpdir(), "cm-git-ops");
  }

  async cloneToTemp(repoUrl: string): Promise<string> {
    const dir = await mkdtemp(join(this.tempRoot, TEMP_PREFIX));
    await execa("git", ["clone", repoUrl, dir], { timeout: 120_000 });
    return dir;
  }

  async createBranch(dir: string, name: string): Promise<void> {
    this.ensureUnderTempRoot(dir);
    await execa("git", ["checkout", "-b", name], { cwd: dir });
  }

  async commitAll(dir: string, message: string): Promise<void> {
    this.ensureUnderTempRoot(dir);
    await execa("git", ["add", "-A"], { cwd: dir });
    await execa("git", ["commit", "-m", message], { cwd: dir });
  }

  async push(dir: string, branch: string): Promise<void> {
    this.ensureUnderTempRoot(dir);
    await execa("git", ["push", "origin", branch], { cwd: dir, timeout: 60_000 });
  }

  async cleanup(dir: string): Promise<void> {
    if (!isUnderRoot(dir, this.tempRoot)) {
      throw new Error(
        `Path traversal blocked: ${dir} is not under the temp root ${this.tempRoot}`,
      );
    }
    await rm(dir, { recursive: true, force: true });
  }

  private ensureUnderTempRoot(dir: string): void {
    if (!isUnderRoot(dir, this.tempRoot)) {
      throw new Error(
        `Path traversal blocked: ${dir} is not under the temp root ${this.tempRoot}`,
      );
    }
  }
}
