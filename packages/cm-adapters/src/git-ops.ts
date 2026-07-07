import { execa } from "execa";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

  async cloneToTemp(repoUrl: string, branch?: string): Promise<string> {
    await mkdir(this.tempRoot, { recursive: true });
    const dir = await mkdtemp(join(this.tempRoot, TEMP_PREFIX));
    // why: core.autocrlf=false at clone time (not just at diff/apply time) —
    // the CRLF<->LF conversion happens on checkout, so setting it only for
    // later diff/apply calls is too late once the working tree already has
    // whatever line endings the global config produced. Every clone this
    // class ever makes gets a consistent, config-independent checkout, so
    // diffPatch/applyPatch (which move a patch between two separately cloned
    // worktrees) never disagree over line endings regardless of the host's
    // global git config (confirmed as a real production cause: SAST's own
    // "fixed" verdict on application.properties files never survived
    // applyPatch onto the SCA clone, both were plain independent clones on a
    // machine with core.autocrlf=true).
    const args = branch
      ? ["-c", "core.autocrlf=false", "clone", "--branch", branch, "--single-branch", repoUrl, dir]
      : ["-c", "core.autocrlf=false", "clone", repoUrl, dir];
    await execa("git", args, { timeout: 120_000 });
    // why: `-c` only scopes the clone invocation itself — every subsequent
    // command against this clone (commitAll, diffPatch, applyPatch, push) is
    // a separate process that would otherwise fall back to the host's global
    // config. Writing it into this clone's own .git/config makes the setting
    // stick for the clone's whole lifetime, not just the one command.
    await execa("git", ["config", "core.autocrlf", "false"], { cwd: dir });
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

  /**
   * why: force is opt-in for a reason — only safe for branches this pipeline
   * exclusively owns (the auto-generated fix branch, re-cloned from scratch
   * every attempt). Without it, any pre-existing remote commit on that branch
   * (from a prior run) permanently rejects every future push as non-fast-forward,
   * since each attempt re-clones from the base branch, not from the fix branch.
   */
  async push(dir: string, branch: string, options: { force?: boolean } = {}): Promise<void> {
    this.ensureUnderTempRoot(dir);
    const args = ["push", "origin", branch];
    if (options.force) args.push("--force");
    await execa("git", args, { cwd: dir, timeout: 60_000 });
  }

  async pushBranch(dir: string, branch: string): Promise<void> {
    return this.push(dir, branch);
  }

  async diffPatch(dir: string): Promise<string> {
    this.ensureUnderTempRoot(dir);
    // why: execa strips the trailing newline from stdout by default, which
    // corrupts a patch whose last line is a context/added line — git apply
    // requires the final line to end with \n (or an explicit no-newline marker).
    // (core.autocrlf is forced false per-clone in cloneToTemp — see its
    // comment for why that matters specifically for diffPatch/applyPatch.)
    const { stdout } = await execa("git", ["diff", "--binary"], { cwd: dir });
    return stdout ? `${stdout}\n` : stdout;
  }

  async applyPatch(dir: string, patch: string): Promise<boolean> {
    this.ensureUnderTempRoot(dir);
    if (!patch.trim()) return true;
    try {
      await execa("git", ["apply", "--3way"], { cwd: dir, input: patch });
      return true;
    } catch (err) {
      // why: this failure was previously swallowed entirely — a real
      // production run had SAST fixes silently dropped (never applied to the
      // primary worktree, never committed/pushed) with zero diagnostic
      // information beyond a generic "merge conflict" log at the call site.
      // Surface the actual git apply stderr/exit code so the real cause
      // (line-ending mismatch, unexpected context, etc.) is visible next time.
      const execaErr = err as { stderr?: string; exitCode?: number; message?: string };
      console.warn(`[git-ops] applyPatch failed in ${dir} (exit ${execaErr.exitCode ?? "?"}): ${(execaErr.stderr ?? execaErr.message ?? String(err)).slice(0, 1000)}`);
      return false;
    }
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
