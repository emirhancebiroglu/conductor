import { execa } from "execa";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCheckmarxResults } from "@conductor/cm-core";

async function main() {
  const scanId = process.argv[2];
  if (!scanId) { console.error("Usage: tsx dump-cx.ts <scanId>"); process.exit(1); }

  const baseUri = process.env.CX_BASE_URI!;
  const tenant = process.env.CX_TENANT!;
  const apiKey = process.env.CX_APIKEY!;
  if (!baseUri || !tenant || !apiKey) { console.error("Missing: CX_BASE_URI, CX_TENANT, CX_APIKEY"); process.exit(1); }

  const workDir = join(tmpdir(), `cx-dump-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  console.log(`fetching ${scanId}...`);
  const result = await execa("cx", [
    "results", "show",
    "--scan-id", scanId,
    "--report-format", "json",
    "--output-path", workDir,
    "--output-name", "cx_result",
    "--base-uri", baseUri, "--tenant", tenant, "--apikey", apiKey,
  ], { reject: false });

  console.log(`exit: ${result.exitCode}`);

  let json: unknown;
  const outFile = join(workDir, "cx_result.json");
  try {
    const content = await fs.readFile(outFile, "utf-8");
    json = JSON.parse(content);
    await fs.writeFile("cx_raw.json", content, "utf-8");
    console.log("raw written to cx_raw.json");
  } catch {
    json = JSON.parse(result.stdout);
  }

  const raw = json as { results?: unknown[] };
  const results = raw.results ?? [];
  console.log(`total results: ${results.length}`);

  const sast = results.find((r: unknown) => (r as { type: string }).type === "sast");
  const sca = results.find((r: unknown) => (r as { type: string }).type === "sca");
  console.log("\n--- first SAST ---");
  console.log(sast ? JSON.stringify(sast, null, 2) : "(none)");
  console.log("\n--- first SCA ---");
  console.log(sca ? JSON.stringify(sca, null, 2) : "(none)");

  const findings = parseCheckmarxResults(json);
  console.log(`\nparsed: ${findings.length} findings`);
  await fs.writeFile("cx_parsed.json", JSON.stringify(findings, null, 2), "utf-8");
  console.log("parsed written to cx_parsed.json");

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((e) => { console.error(e); process.exit(1); });
