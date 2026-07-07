import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
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

  it("push without force rejects a diverged remote branch; force:true overwrites it (real production bug: fix branch re-cloned fresh every attempt)", async () => {
    const firstDir = await gitOps.cloneToTemp(bareDir);
    const secondDir = await gitOps.cloneToTemp(bareDir);
    try {
      for (const dir of [firstDir, secondDir]) {
        await execa("git", ["config", "user.email", "test@test.com"], { cwd: dir });
        await execa("git", ["config", "user.name", "Test User"], { cwd: dir });
      }

      // First "attempt": pushes fix-branch with its own commit.
      await gitOps.createBranch(firstDir, "checkmarx-fix");
      await writeFile(join(firstDir, "fix.txt"), "attempt one");
      await gitOps.commitAll(firstDir, "fix: attempt one");
      await gitOps.push(firstDir, "checkmarx-fix");

      // Second "attempt": fresh clone from the base branch (doesn't know
      // about the first attempt's commit on checkmarx-fix), same branch name.
      await gitOps.createBranch(secondDir, "checkmarx-fix");
      await writeFile(join(secondDir, "fix.txt"), "attempt two");
      await gitOps.commitAll(secondDir, "fix: attempt two");

      await expect(gitOps.push(secondDir, "checkmarx-fix")).rejects.toThrow();

      // force:true must succeed and make the remote reflect attempt two.
      await gitOps.push(secondDir, "checkmarx-fix", { force: true });

      const verifyDir = await gitOps.cloneToTemp(bareDir, "checkmarx-fix");
      const content = await readFile(join(verifyDir, "fix.txt"), "utf-8");
      expect(content).toBe("attempt two");
      await gitOps.cleanup(verifyDir);
    } finally {
      await gitOps.cleanup(firstDir);
      await gitOps.cleanup(secondDir);
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

  it("diffPatch returns empty string for a clean worktree", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    try {
      const patch = await gitOps.diffPatch(clonedDir);
      expect(patch).toBe("");
    } finally {
      await gitOps.cleanup(clonedDir);
    }
  });

  it("diffPatch captures uncommitted changes, applyPatch replays them onto another clone", async () => {
    const sourceDir = await gitOps.cloneToTemp(bareDir);
    const targetDir = await gitOps.cloneToTemp(bareDir);
    try {
      await writeFile(join(sourceDir, "README.md"), "# test\nadded by source clone\n");

      const patch = await gitOps.diffPatch(sourceDir);
      expect(patch).toContain("added by source clone");

      const applied = await gitOps.applyPatch(targetDir, patch);
      expect(applied).toBe(true);

      const targetContent = await readFile(join(targetDir, "README.md"), "utf-8");
      expect(targetContent).toContain("added by source clone");
    } finally {
      await gitOps.cleanup(sourceDir);
      await gitOps.cleanup(targetDir);
    }
  });

  it("cloneToTemp pins core.autocrlf=false on every clone regardless of the host's global config (real production bug: two independently-checked-out clones on a machine with global core.autocrlf=true produced subtly different line endings, and a patch diffed from one failed to apply onto the other with 'does not match index' — silently dropping SAST's fixes since the merge step treated that as an unresolvable conflict)", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    try {
      const { stdout } = await execa("git", ["config", "core.autocrlf"], { cwd: clonedDir });
      expect(stdout.trim()).toBe("false");
    } finally {
      await gitOps.cleanup(clonedDir);
    }
  });

  it("applyPatch is a no-op returning true for an empty patch", async () => {
    const clonedDir = await gitOps.cloneToTemp(bareDir);
    try {
      const applied = await gitOps.applyPatch(clonedDir, "");
      expect(applied).toBe(true);
    } finally {
      await gitOps.cleanup(clonedDir);
    }
  });

  it("applyPatch returns false on a conflicting patch", async () => {
    const sourceDir = await gitOps.cloneToTemp(bareDir);
    const targetDir = await gitOps.cloneToTemp(bareDir);
    try {
      await writeFile(join(sourceDir, "README.md"), "# test\nsource change\n");
      const patch = await gitOps.diffPatch(sourceDir);

      // Make an incompatible change to the same line in the target so the patch can't apply cleanly.
      await writeFile(join(targetDir, "README.md"), "completely different content, no shared context\n");

      const applied = await gitOps.applyPatch(targetDir, patch);
      expect(applied).toBe(false);
    } finally {
      await gitOps.cleanup(sourceDir);
      await gitOps.cleanup(targetDir);
    }
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
