import { createOctokit, discoverRepos, listRepos } from "@conductor/github";

const token = process.env.GITHUB_TOKEN_WORK;
const owner = "Toyota-Europe";

const octokit = createOctokit(token);

async function main() {
  console.log("=== listRepos (all pages) ===");
  const all = await listRepos(octokit, owner);
  console.log(`Total: ${all.length}`);
  const ms = all.filter(r => r.name.startsWith("ms"));
  console.log(`ms-prefixed: ${ms.length}`);
  if (ms.length > 0) {
    console.log("ms repos:", ms.map(r => r.name).join(", "));
  } else {
    // Show last 10 to understand ordering
    console.log("Last 10:", all.slice(-10).map(r => r.name).join(", "));
  }

  console.log("\n=== discoverRepos ===");
  const result = await discoverRepos({
    octokit, owner,
    namePrefix: "ms",
    configPath: ".github/checkmarx_scan.yml",
    branchExcludePattern: "*kubernetes*,*k8s*",
  });
  console.log(`Discovered: ${result.length}`);
  if (result.length > 0) {
    console.log("Names:", result.map(r => r.name).join(", "));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
