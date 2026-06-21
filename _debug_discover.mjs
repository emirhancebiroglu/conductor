import { createOctokit, discoverRepos, listRepos } from "@conductor/github";

const owner = "YOUR_GITHUB_ORG";  // pipeline'daki github_owner
const token = process.env.GITHUB_TOKEN_WORK;

if (!token) {
  console.error("GITHUB_TOKEN_WORK env var not set");
  process.exit(1);
}

const octokit = createOctokit(token);

async function debug() {
  console.log("=== Step 1: listRepos ===");
  const allRepos = await listRepos(octokit, owner);
  console.log(`Total repos in org: ${allRepos.length}`);
  if (allRepos.length > 0) {
    console.log("First 5:", allRepos.slice(0, 5).map(r => r.name).join(", "));
  }

  const namePrefix = "ms";
  const prefixed = allRepos.filter(r => r.name.startsWith(namePrefix));
  console.log(`\n=== Step 2: prefix "${namePrefix}" filter ===`);
  console.log(`After prefix filter: ${prefixed.length}`);
  if (prefixed.length === 0 && allRepos.length > 0) {
    console.log("REPO NAMES:", allRepos.slice(0, 10).map(r => r.name).join(", "));
  }

  console.log(`\n=== Step 3: full discoverRepos ===`);
  const result = await discoverRepos({
    octokit, owner,
    namePrefix,
    configPath: ".github/checkmarx_scan.yml",
    branchExcludePattern: "*kubernetes*,*k8s*",
  });
  console.log(`discoverRepos result: ${result.length}`);
  if (result.length > 0) {
    console.log("Discovered:", result.map(r => r.name).join(", "));
  }
}

debug().catch(err => console.error("ERROR:", err instanceof Error ? err.message : err));
