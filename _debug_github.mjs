const GITHUB_TOKEN = process.env.GITHUB_TOKEN_WORK;
const OWNER = process.env.GITHUB_OWNER || "your-org";

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN_WORK not set. Pass it inline: $env:GITHUB_TOKEN_WORK='...'");
  process.exit(1);
}

async function main() {
  // Step 1: Test token validity
  console.log("=== Step 1: Token check ===");
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  const user = await userRes.json();
  console.log(`Rate limit: ${userRes.headers.get("x-ratelimit-remaining")}/${userRes.headers.get("x-ratelimit-limit")}`);
  if (!userRes.ok) {
    console.error(`Token invalid: ${user.message}`);
    process.exit(1);
  }
  console.log(`Authenticated as: ${user.login}`);

  // Step 2: list repos for org
  console.log(`\n=== Step 2: List repos for org "${OWNER}" ===`);
  const repoRes = await fetch(
    `https://api.github.com/orgs/${OWNER}/repos?per_page=100&type=all&sort=full_name`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } },
  );
  const repos = await repoRes.json();
  if (!repoRes.ok) {
    console.error(`Failed to list repos: ${repos.message}`);
    process.exit(1);
  }
  console.log(`Total repos in org: ${repos.length}`);
  if (repos.length > 0) {
    const names = repos.map(r => r.name);
    console.log(`Names: ${names.slice(0, 10).join(", ")}`);
  } else {
    console.log("ORG NOT FOUND or empty — maybe wrong owner name?");
    process.exit(1);
  }

  // Step 3: Filter by prefix "ms"
  const PREFIX = "ms";
  const prefixed = repos.filter(r => r.name.startsWith(PREFIX));
  console.log(`\n=== Step 3: Prefix "${PREFIX}" filter ===`);
  console.log(`After prefix filter: ${prefixed.length}/${repos.length}`);
  if (prefixed.length === 0) {
    console.log(`No repos start with "${PREFIX}". Sample names: ${repos.slice(0, 10).map(r => r.name).join(", ")}`);
  } else {
    console.log(`Prefix-matched: ${prefixed.map(r => r.name).join(", ")}`);
  }

  // Step 4: Check config file
  console.log(`\n=== Step 4: Check .github/checkmarx_scan.yml ===`);
  for (const repo of prefixed.slice(0, 5)) {
    const fileRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${repo.name}/contents/.github/checkmarx_scan.yml`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } },
    );
    const exists = fileRes.ok;
    console.log(`  ${repo.name}: config file ${exists ? "✅" : "❌"}`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Token: valid (${user.login})`);
  console.log(`Org: ${OWNER} — ${repos.length} repos`);
  console.log(`Prefix "ms": ${prefixed.length} repos match`);
}

main().catch(e => console.error("ERROR:", e.message));
