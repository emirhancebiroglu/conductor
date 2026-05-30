import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createOctokit,
  branchExists,
  createBranch,
  getFileContent,
  commitFile,
  createPR,
} from "@conductor/github";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

async function loadDotEnv(): Promise<void> {
  try {
    const raw = await readFile(join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && val) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env.local not required
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await loadDotEnv();

  const githubToken = requireEnv("GITHUB_TOKEN");
  const repoOwner = requireEnv("SMOKE_REPO_OWNER");
  const repoName = requireEnv("SMOKE_REPO_NAME");


  const timestamp = Date.now().toString();
  const branch = `feature/smoke-${timestamp}`;
  const targetPath = "apps/worker/src/smoke-test.ts";

  console.log(`[smoke] timestamp : ${timestamp}`);
  console.log(`[smoke] branch    : ${branch}`);

  const octokit = createOctokit(githubToken);

  // 1. Validate env — get default branch from repo metadata
  console.log("[smoke] fetching repo info...");
  const { data: repoData } = await octokit.rest.repos.get({ owner: repoOwner, repo: repoName });
  const defaultBranch = repoData.default_branch;
  console.log(`[smoke] default branch: ${defaultBranch}`);

  // 2. Create branch
  console.log("[smoke] creating branch...");
  if (await branchExists(octokit, repoOwner, repoName, branch)) {
    throw new Error(`Branch already exists: ${branch}`);
  }
  await createBranch(octokit, repoOwner, repoName, branch, defaultBranch);

  // 3. Fetch current file content from GitHub, prepend marker
  console.log("[smoke] reading file from GitHub...");
  const currentContent = await getFileContent(octokit, repoOwner, repoName, targetPath, defaultBranch);
  const updatedContent = `// smoke: ${timestamp}\n${currentContent}`;

  // 4. Commit
  console.log("[smoke] committing...");
  await commitFile(
    octokit,
    repoOwner,
    repoName,
    branch,
    targetPath,
    updatedContent,
    `chore: smoke test ${timestamp}`,
  );

  // 5. PR
  console.log("[smoke] opening PR...");
  const prUrl = await createPR(
    octokit,
    repoOwner,
    repoName,
    "🤖 [smoke] Hello Conductor",
    "Otomatik test — güvenle kapat.",
    branch,
    defaultBranch,
  );

  console.log(`\n[smoke] ✅ PR açıldı: ${prUrl}\n`);
}

try {
  await main();
} catch (err: unknown) {
  console.error("[smoke] ❌ FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
}
