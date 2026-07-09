const TOKEN = process.env.GITHUB_TOKEN_WORK;
const OWNER = "Toyota-Europe";

async function listAllRepos() {
  const all = [];
  let page = 1;
  const perPage = 100;
  for (;;) {
    const res = await fetch(
      `https://api.github.com/orgs/${OWNER}/repos?per_page=${perPage}&page=${page}&type=all&sort=full_name`,
      { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.v3+json" } },
    );
    if (!res.ok) throw new Error(`API error: ${res.status} ${(await res.json()).message}`);
    const data = await res.json();
    if (data.length === 0) break;
    for (const repo of data) all.push(repo.name);
    console.log(`Page ${page}: ${data.length} repos, total so far: ${all.length}`);
    if (data.length < perPage) break;
    page++;
  }
  return all;
}

async function fileExists(name) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${name}/contents/.github/checkmarx_scan.yml`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.v3+json" } },
  );
  return res.ok;
}

async function main() {
  console.log(`=== Tüm repolar (${OWNER}) ===`);
  const all = await listAllRepos();
  console.log(`\nToplam: ${all.length}`);

  const msRepos = all.filter(r => r.startsWith("ms"));
  console.log(`\n"ms" ile başlayan: ${msRepos.length}`);
  if (msRepos.length > 0) {
    console.log("ms Repos:", msRepos.join(", "));

    // Check config file for first 5
    console.log("\n=== Config file check (.github/checkmarx_scan.yml) ===");
    for (const name of msRepos.slice(0, 10)) {
      const exists = await fileExists(name);
      console.log(`  ${name}: ${exists ? "✅" : "❌"}`);
    }
  } else {
    // Show what prefixes exist
    const prefixes = [...new Set(all.map(r => r.split("-")[0]).filter(p => p.length > 0))].sort();
    console.log("Unique first segments:", prefixes.slice(0, 30).join(", "));
  }
}

main().catch(e => console.error("ERROR:", e));
