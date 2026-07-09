import type { GitOps } from "@conductor/cm-adapters";

export type ResolvedCloneBranch = {
  cloneBranch: string;
  isExistingFixBranch: boolean;
};

/**
 * Decides which branch a fix attempt should clone from: the bot-owned fix
 * branch (e.g. "checkmarx-auto") if it already exists remotely — so repeated
 * attempts build on prior work instead of discarding it — or the fallback
 * (uat/default_branch) when no fix branch exists yet, in which case it'll be
 * created fresh by the caller as today.
 */
export async function resolveCloneBranch(
  ops: GitOps,
  repoUrl: string,
  fixBranch: string,
  fallbackBranch: string,
): Promise<ResolvedCloneBranch> {
  try {
    const dir = await ops.cloneToTemp(repoUrl, fixBranch);
    await ops.cleanup(dir).catch(() => undefined);
    return { cloneBranch: fixBranch, isExistingFixBranch: true };
  } catch {
    return { cloneBranch: fallbackBranch, isExistingFixBranch: false };
  }
}
