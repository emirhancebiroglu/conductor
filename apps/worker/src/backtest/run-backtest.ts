#!/usr/bin/env tsx
/**
 * Backtest harness CLI for the idea evaluation pipeline.
 *
 * Usage:
 *   tsx src/backtest/run-backtest.ts                                # Full baseline (18 cases, 3 runs)
 *   tsx src/backtest/run-backtest.ts --runs 1                        # Single run
 *   tsx src/backtest/run-backtest.ts --case incumbent-01             # Single case
 *   tsx src/backtest/run-backtest.ts --dry-run                       # Validate dataset only
 *   tsx src/backtest/run-backtest.ts --output ./results              # Save to directory
 *
 * Regression (run after prompts change):
 *   tsx src/backtest/run-backtest.ts --regression --cache-dir ./cache/baseline-xxx
 *   # Compares current prompt hashes with cached, re-runs only affected stages
 *
 * Reasoning quality (LLM-as-judge scores each verdict's reasoning):
 *   tsx src/backtest/run-backtest.ts --reasoning
 *
 * Per-agent evals (isolation tests for individual agents):
 *   tsx src/backtest/run-backtest.ts --agent-evals
 *   tsx src/backtest/run-backtest.ts --agent-evals-only   # Skip E2E runs, only agent evals
 *
 * Production prompts (load from Supabase):
 *   tsx src/backtest/run-backtest.ts --connect
 *
 * Config overrides (override specific agent prompts):
 *   tsx src/backtest/run-backtest.ts --config overrides.json
 *
 *   overrides.json: {"adversary": {"systemPrompt": "..."}, "judge": {"systemPrompt": "..."}}
 *
 * Combined:
 *   tsx src/backtest/run-backtest.ts --runs 1 --reasoning --regression --cache-dir ./cache/last --config overrides.json
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runBacktest } from "./harness.js";
import { formatMultiRunReport, formatVerboseCase } from "./reporter.js";
import { TEST_DATASET } from "./datasets/ideas.js";
import { runAllAgentEvals } from "./per-agent-evals.js";
import type { AgentEvalSummary } from "./per-agent-evals.js";

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        result[key] = value;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

function loadOverrides(filePath: string): Record<string, Record<string, unknown>> {
  try {
    const content = readFileSync(filePath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(content);
  } catch (err) {
    console.error(`Failed to load overrides from ${filePath}: ${String(err)}`);
    process.exit(1);
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatAgentEvalSummary(summary: AgentEvalSummary): string {
  const lines: string[] = [];
  lines.push("─".repeat(80));
  lines.push("  PER-AGENT EVALS");
  lines.push("─".repeat(80));
  for (const r of summary.results) {
    lines.push(`  ${r.passed ? "✓" : "✗"} ${r.name}`);
    lines.push(`    ${r.detail}`);
  }
  lines.push(`  ${summary.passed}/${summary.total} passed`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs();

  // ── Dry run ──────────────────────────────────────────────────────────────
  if (args["dry-run"]) {
    console.log("── Dry run: validating dataset ──");
    console.log(`  Total test cases: ${TEST_DATASET.length}`);
    for (const tc of TEST_DATASET) {
      const verdict = tc.expectedVerdict ?? "ANY";
      console.log(`  [${tc.id}] ${tc.category.padEnd(18)} expected=${verdict}  "${tc.input.slice(0, 60)}..."`);
    }
    console.log("\n  Dataset valid. No LLM calls made.");
    return;
  }

  // ── Agent evals only ────────────────────────────────────────────────────
  if (args["agent-evals-only"]) {
    console.log("══ Per-Agent Evals Only ══");
    const result = await runAllAgentEvals();
    console.log(formatAgentEvalSummary(result));
    process.exit(result.failed > 0 ? 1 : 0);
  }

  // ── Parse options ────────────────────────────────────────────────────────
  const runs = args["runs"] ? parseInt(args["runs"], 10) : 3;
  const maxLoops = args["max-loops"] ? parseInt(args["max-loops"], 10) : 3;
  const debateMax = args["debate-max"] ? parseInt(args["debate-max"], 10) : 3;
  const regression = args["regression"] !== undefined && args["regression"] !== "false";
  const reasoning = args["reasoning"] !== undefined && args["reasoning"] !== "false";
  const verbose = args["verbose"] !== undefined && args["verbose"] !== "false";
  const noWebSearch = args["no-websearch"] !== undefined && args["no-websearch"] !== "false";

  // Set env var before any agent spawns — runner.ts reads this at spawn time
  if (noWebSearch) process.env["BACKTEST_NO_WEBSEARCH"] = "1";
  const doAgentEvals = args["agent-evals"] !== undefined && args["agent-evals"] !== "false";
  const connectToSupabase = args["connect"] !== undefined && args["connect"] !== "false";

  const filterCaseIds = args["case"]
    ? args["case"].split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const cacheDir = args["cache-dir"] ?? null;
  const outputDir = args["output"] ?? null;

  let agentConfigOverrides: Record<string, Record<string, unknown>> | undefined;
  if (args["config"]) {
    agentConfigOverrides = loadOverrides(args["config"]);
  }

  // ── Print config ─────────────────────────────────────────────────────────
  console.log("══ Backtest Harness ══");
  console.log(`  Runs per case:    ${runs}`);
  console.log(`  Max loops:        ${maxLoops}`);
  console.log(`  Max debates:      ${debateMax}`);
  console.log(`  Test cases:       ${filterCaseIds ? filterCaseIds.join(", ") : `all ${TEST_DATASET.length}`}`);
  console.log(`  Config overrides: ${args["config"] ?? "none (using defaults)"}`);
  console.log(`  Cache dir:        ${cacheDir ?? "none"}`);
  console.log(`  Regression:       ${regression && cacheDir ? "yes" : "no"}`);
  console.log(`  Reasoning qual:   ${reasoning ? "yes" : "no"}`);
  console.log(`  Verbose output:   ${verbose ? "yes" : "no"}`);
  console.log(`  No websearch:     ${noWebSearch ? "yes (BACKTEST_NO_WEBSEARCH=1)" : "no"}`);
  console.log(`  Agent evals:      ${doAgentEvals ? "yes" : "no"}`);
  console.log(`  Connect Supabase: ${connectToSupabase ? "yes" : "no"}`);
  console.log(`  Output dir:       ${outputDir ?? "stdout only"}`);

  if (agentConfigOverrides) {
    console.log(`  Override agents:  ${Object.keys(agentConfigOverrides).join(", ")}`);
  }
  console.log("");

  // ── Run ──────────────────────────────────────────────────────────────────
  const startTime = Date.now();

  try {
    const result = await runBacktest({
      runs,
      maxLoops,
      debateMax,
      filterCaseIds: filterCaseIds,
      cacheDir: cacheDir ?? undefined,
      regression: regression && !!cacheDir,
      reasoning,
      agentEvals: doAgentEvals,
      connectToSupabase,
      agentConfigOverrides: agentConfigOverrides ? (agentConfigOverrides) : undefined,
      onCaseComplete: verbose
        ? (testCase, _runIndex, pipelineResult, _score) => {
            const verboseOut = formatVerboseCase(testCase, pipelineResult);
            console.log(verboseOut);
            // Also append to verbose file if outputDir is set
            if (outputDir) {
              mkdirSync(outputDir, { recursive: true });
              const verbosePath = join(outputDir, `verbose-${Date.now()}-${testCase.id}.txt`);
              writeFileSync(verbosePath, verboseOut, "utf-8");
            }
          }
        : undefined,
    });

    const duration = Date.now() - startTime;
    const report = formatMultiRunReport(result);

    // ── Output ────────────────────────────────────────────────────────────
    if (outputDir) {
      const timestamp = Date.now();
      const reportPath = join(outputDir, `backtest-${timestamp}.txt`);
      const jsonPath = join(outputDir, `backtest-${timestamp}.json`);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(reportPath, report, "utf-8");
      writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
      console.log(`\n  Report saved to: ${reportPath}`);
      console.log(`  JSON saved to:   ${jsonPath}`);
    } else {
      console.log(report);
    }

    console.log(`\n  Duration: ${formatDuration(duration)}`);

    // ── Exit code ──────────────────────────────────────────────────────────
    const hasVetoViolation = result.runs.some((r) => r.summary.falseGOFlag);
    if (hasVetoViolation) {
      console.error("\n  HARD REQUIREMENT FAILED: Incumbent-owned idea passed through.");
      process.exit(1);
    }
  } catch (err) {
    console.error("\n  Backtest failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();
