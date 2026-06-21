/**
 * Dump raw cx results JSON for a given scan ID.
 * Usage: node --loader ts-node/esm scripts/dump-cx-results.ts <scanId>
 *   OR:  apps\cm-worker\node_modules\.bin\tsx.CMD --tsconfig apps/cm-worker/tsconfig.json scripts/dump-cx-results.ts <scanId>
 * Output: cx_raw.json (raw cx output), cx_parsed.json (parsed findings)
 */
import { execa } from "execa";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCheckmarxResults } from "../packages/cm-core/src/index.js";

async function main() {
  const scanId = process.argv[2];
  if (!scanId) {
    console.error("Usage: tsx scripts/dump-cx-results.ts <scanId>");
    process.exit(1);
  }

  const baseUri = process.env.CX_BASE_URI!;
  const tenant = process.env.CX_TENANT!;
  const apiKey = process.env.CX_APIKEY!;

  if (!baseUri || !tenant || !apiKey) {
    console.error("Missing env: CX_BASE_URI, CX_TENANT, CX_APIKEY");
    process.exit(1);
  }

  const workDir = join(tmpdir(), `cx-dump-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  console.log(`[dump] fetching results for scan ${scanId}...`);

  const result = await execa("cx", [
    "results", "show",
    "--scan-id", scanId,
    "--report-format", "json",
    "--output-path", workDir,
    "--output-name", "cx_result",
    "--base-uri", baseUri,
    "--tenant", tenant,
    "--apikey", apiKey,
  ], { reject: false });

  console.log(`[dump] cx exit code: ${result.exitCode}`);

  let json: unknown;
  try {
    const content = await fs.readFile(join(workDir, "cx_result.json"), "utf-8");
    json = JSON.parse(content);
    await fs.writeFile("cx_raw.json", content, "utf-8");
    console.log(`[dump] raw JSON written to cx_raw.json`);
  } catch {
    console.error("[dump] no result file, trying stdout");
    json = JSON.parse(result.stdout);
  }

  const raw = json as { results?: unknown[] };
  if (raw.results && raw.results.length > 0) {
    console.log(`\n[dump] total results: ${raw.results.length}`);

    const sast = raw.results.find((r: unknown) => (r as { type: string }).type === "sast");
    console.log(`\n[dump] first SAST result:`);
    if (sast) console.log(JSON.stringify(sast, null, 2));
    else console.log("(none)");

    const sca = raw.results.find((r: unknown) => (r as { type: string }).type === "sca");
    console.log(`\n[dump] first SCA result:`);
    if (sca) console.log(JSON.stringify(sca, null, 2));
    else console.log("(none)");
  }

  const findings = parseCheckmarxResults(json);
  console.log(`\n[dump] parsed ${findings.length} findings`);
  await fs.writeFile("cx_parsed.json", JSON.stringify(findings, null, 2), "utf-8");
  console.log(`[dump] parsed findings written to cx_parsed.json`);

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((err) => { console.error(err); process.exit(1); });
