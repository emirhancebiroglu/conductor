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

export type DiscoverReposOptions = {
  octokit: Octokit;
  owner: string;
  namePrefix?: string;
  configPath?: string;
};

export async function discoverRepos(
  options: DiscoverReposOptions,
): Promise<Array<{ name: string; defaultBranch: string }>> {
  const { octokit, owner, namePrefix = "ms", configPath = ".github/checkmarx_scan.yml" } = options;

  const allRepos = await listRepos(octokit, owner);
  const matched: Array<{ name: string; defaultBranch: string }> = [];

  for (const repo of allRepos) {
    if (!repo.name.startsWith(namePrefix)) continue;

    const hasConfig = await fileExists(octokit, owner, repo.name, configPath, repo.defaultBranch);
    if (!hasConfig) continue;

    matched.push(repo);
  }

  return matched;
}
