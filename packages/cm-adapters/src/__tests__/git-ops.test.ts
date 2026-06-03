import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { GitOps } from "../git-ops.js";

async function createBareRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "git-ops-bare-"));
  await execa("git", ["init", "--bare", dir]);
  return dir;
}

async function createInitialCommit(bareDir: string): Promise<void> {
  const cloneDir = await mkdtemp(join(tmpdir(), "git-ops-init-"));
  await execa("git", ["clone", bareDir, cloneDir]);
  await writeFile(join(cloneDir, "README.md"), "# test\n");
  await execa("git", ["config", "user.email", "test@test.com"], { cwd: cloneDir });
  await execa("git", ["config", "user.name", "Test User"], { cwd: cloneDir });
  await execa("git", ["add", "-A"], { cwd: cloneDir });
  await execa("git", ["commit", "-m", "Initial commit"], { cwd: cloneDir });
  await execa("git", ["push", "origin", "main"], { cwd: cloneDir });
  await rm(cloneDir, { recursive: true, force: true });
}

describe("GitOps", () => {
  let bareDir: string;
  let gitOps: GitOps;
  let tempRoot: string;

  beforeEach(async () => {
    bareDir = await createBareRepo();
    await createInitialCommit(bareDir);
    tempRoot = await mkdtemp(join(tmpdir(), "git-ops-test-root-"));
    gitOps = new GitOps(tempRoot);
  });

  afterEach(async () => {
    if (bareDir) await rm(bareDir, { recursive: true, force: true }).catch(() => {});
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("cloneToTemp clones the bare repo into a temp dir", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    try {
      expect(existsSync(clonedDir)).toBe(true);
      expect(existsSync(join(clonedDir, "README.md"))).toBe(true);

      const { stdout } = await execa("git", ["log", "--oneline", "-1"], { cwd: clonedDir });
      expect(stdout).toBeTruthy();
    } finally {
      await gitOps.cleanup(clonedDir);
    }
  });

  it("createBranch creates and switches to a new branch", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    try {
      await execa("git", ["config", "user.email", "test@test.com"], { cwd: clonedDir });
      await execa("git", ["config", "user.name", "Test User"], { cwd: clonedDir });

      await gitOps.createBranch(clonedDir, "checkmarx-fix");
      await writeFile(join(clonedDir, "fix.txt"), "fixed");
      await gitOps.commitAll(clonedDir, "fix: apply checkmarx fix");
      await gitOps.push(clonedDir, "checkmarx-fix");

      const { stdout } = await execa("git", ["branch", "-r"], { cwd: clonedDir });
      expect(stdout).toContain("checkmarx-fix");
    } finally {
      await gitOps.cleanup(clonedDir);
    }
  });

  it("commitAll stages and commits all changes", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    try {
      await execa("git", ["config", "user.email", "test@test.com"], { cwd: clonedDir });
      await execa("git", ["config", "user.name", "Test User"], { cwd: clonedDir });

      await writeFile(join(clonedDir, "new-file.txt"), "new content");
      await gitOps.commitAll(clonedDir, "test: add new file");

      const status = await execa("git", ["status", "--porcelain"], { cwd: clonedDir });
      expect(status.stdout).toBe("");
    } finally {
      await gitOps.cleanup(clonedDir);
    }
  });

  it("cleanup removes the temp dir and nothing else", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    expect(existsSync(clonedDir)).toBe(true);

    await gitOps.cleanup(clonedDir);
    expect(existsSync(clonedDir)).toBe(false);
    expect(existsSync(bareDir)).toBe(true);
  });

  it("cleanup throws on path traversal attempt", async () => {
    await expect(gitOps.cleanup("../malicious")).rejects.toThrow("Path traversal blocked");
    await expect(gitOps.cleanup(join(tmpdir(), "outside"))).rejects.toThrow("Path traversal blocked");
  });

  it("full round-trip: clone → branch → commit → push", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    try {
      await execa("git", ["config", "user.email", "test@test.com"], { cwd: clonedDir });
      await execa("git", ["config", "user.name", "Test User"], { cwd: clonedDir });

      await gitOps.createBranch(clonedDir, "checkmarx-auto");
      await writeFile(join(clonedDir, "package.json"), '{"version": "2.0.0"}');
      await gitOps.commitAll(clonedDir, "fix: upgrade vulnerable deps");
      await gitOps.push(clonedDir, "checkmarx-auto");

      const { stdout } = await execa("git", ["ls-remote", bareDir, "refs/heads/checkmarx-auto"]);
      expect(stdout).toBeTruthy();
      expect(stdout).toContain("refs/heads/checkmarx-auto");
    } finally {
      await gitOps.cleanup(clonedDir);
    }
  });
});
