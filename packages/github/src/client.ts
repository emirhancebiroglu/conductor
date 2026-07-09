import { Octokit } from "@octokit/rest";

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function branchExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<boolean> {
  try {
    await octokit.rest.repos.getBranch({ owner, repo, branch });
    return true;
  } catch {
    return false;
  }
}

export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  fromBranch: string
): Promise<void> {
  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${fromBranch}`,
  });
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: ref.object.sha,
  });
}

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
  if (!Array.isArray(data) && data.type === "file") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  throw new Error(`${path} is not a file`);
}

export async function commitFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string
): Promise<void> {
  let sha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });
    if (!Array.isArray(data) && "sha" in data) sha = data.sha;
  } catch {
    // file does not exist yet
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
    ...(sha !== undefined ? { sha } : {}),
  });
}

export async function createPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<string> {
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
  });
  return data.html_url;
}

export async function listRepos(
  octokit: Octokit,
  owner: string,
): Promise<Array<{ name: string; defaultBranch: string }>> {
  const repos: Array<{ name: string; defaultBranch: string }> = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const { data } = await octokit.rest.repos.listForOrg({
      org: owner,
      page,
      per_page: perPage,
      type: "all",
      sort: "full_name",
    });

    for (const repo of data) {
      repos.push({ name: repo.name, defaultBranch: repo.default_branch ?? "main" });
    }

    if (data.length < perPage) break;
    page++;
  }

  return repos;
}

export async function fileExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch?: string,
): Promise<boolean> {
  try {
    const ref = branch ?? "HEAD";
    await octokit.rest.repos.getContent({ owner, repo, path, ref });
    return true;
  } catch {
    return false;
  }
}

// Returns true if branchName contains any of the comma-separated glob segments (case-insensitive).
// Segments are stripped of leading/trailing '*' before matching (substring check).
function matchesExcludePattern(branchName: string, pattern: string): boolean {
  const lower = branchName.toLowerCase();
  return pattern
    .split(",")
    .map((s) => s.trim().replace(/^\*|\*$/g, "").toLowerCase())
    .filter((s) => s.length > 0)
    .some((segment) => lower.includes(segment));
}

export async function listBranches(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string[]> {
  const branches: string[] = [];
  let page = 1;
  for (;;) {
    const { data } = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
      page,
    });
    for (const b of data) branches.push(b.name);
    if (data.length < 100) break;
    page++;
  }
  return branches;
}

export async function getBranchAheadCount(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  base: string,
): Promise<number> {
  try {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${branch}`,
    });
    return data.ahead_by;
  } catch {
    return -1;
  }
}

export async function selectBestBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  githubDefaultBranch: string,
  excludePattern = "*kubernetes*,*k8s*",
  base?: string,
): Promise<string> {
  const allBranches = await listBranches(octokit, owner, repo);

  const candidates = allBranches.filter(
    (b) => !matchesExcludePattern(b, excludePattern),
  );

  if (candidates.length === 0) {
    console.warn(`[selectBestBranch] ${owner}/${repo}: all branches excluded, using default (${githubDefaultBranch})`);
    return githubDefaultBranch;
  }

  if (candidates.length === 1) {
    return candidates[0] ?? githubDefaultBranch;
  }

  // Prefer "master" as comparison base; fall back to githubDefaultBranch
  const compareBase = base ?? (allBranches.includes("master") ? "master" : githubDefaultBranch);

  // Remove base itself from candidates — comparing base to itself yields 0
  const nonBaseCandidates = candidates.filter((b) => b !== compareBase);
  if (nonBaseCandidates.length === 0) {
    return compareBase;
  }

  const counts = await Promise.all(
    nonBaseCandidates.map((b) => getBranchAheadCount(octokit, owner, repo, b, compareBase)),
  );

  let best: string = nonBaseCandidates[0] ?? githubDefaultBranch;
  let bestCount: number = counts[0] ?? -Infinity;
  for (let i = 1; i < nonBaseCandidates.length; i++) {
    const c = counts[i] ?? -Infinity;
    const b = nonBaseCandidates[i] ?? "";
    if (c > bestCount || (c === bestCount && b < best)) {
      best = b;
      bestCount = c;
    }
  }

  if (bestCount < 0) {
    console.warn(`[selectBestBranch] ${owner}/${repo}: all compares failed, using default (${githubDefaultBranch})`);
    return githubDefaultBranch;
  }

  return best;
}

async function withSemaphore<T>(
  fn: () => Promise<T>,
  state: { active: number; queue: Array<() => void> },
  limit: number,
): Promise<T> {
  if (state.active >= limit) {
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active++;
  try {
    return await fn();
  } finally {
    state.active--;
    state.queue.shift()?.();
  }
}

export type DiscoverReposOptions = {
  octokit: Octokit;
  owner: string;
  namePrefix?: string;
  configPath?: string;
  branchExcludePattern?: string;
};

export async function discoverRepos(
  options: DiscoverReposOptions,
): Promise<Array<{ name: string; defaultBranch: string }>> {
  const {
    octokit,
    owner,
    namePrefix = "ms",
    configPath = ".github/checkmarx_scan.yml",
    branchExcludePattern: _branchExcludePattern = "*kubernetes*,*k8s*",
  } = options;

  const allRepos = await listRepos(octokit, owner);
  const semState = { active: 0, queue: [] as Array<() => void> };
  const CONCURRENCY = 5;

  const results = await Promise.all(
    allRepos
      .filter((repo) => repo.name.startsWith(namePrefix))
      .map((repo) =>
        withSemaphore(
          async () => {
            const hasConfig = await fileExists(octokit, owner, repo.name, configPath);
            if (!hasConfig) return null;

            return { name: repo.name, defaultBranch: "uat" };
          },
          semState,
          CONCURRENCY,
        ),
      ),
  );

  return results.filter((r): r is { name: string; defaultBranch: string } => r !== null);
}
