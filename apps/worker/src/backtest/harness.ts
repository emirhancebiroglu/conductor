import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { runIdeaPipelineCore, type PipelineCoreResult, type CachedStageOutputs } from "../ideaOrchestrator.js";
import { invalidateConfigCache, setAgentConfig, getAgentConfig, loadAgentConfig, type AgentConfig } from "../agentConfig.js";
import { defaultIdeaAgentConfigs } from "./defaults.js";
import { TEST_DATASET } from "./datasets/ideas.js";
import { scoreCase, computeSummary, type ScoredRun, type CaseScore } from "./scorer.js";
import { CacheManager, computePromptHashes, detectChanges, type CascadeStage } from "./cache.js";
import { scoreReasoning } from "./reasoning.js";
import { runAllAgentEvals, type AgentEvalSummary } from "./per-agent-evals.js";
import type { TestCase } from "./datasets/ideas.js";
import type { IdeaItem } from "@conductor/core";

export type HarnessOptions = {
  runs: number;
  agentConfigOverrides: Record<string, Partial<AgentConfig>> | undefined;
  maxLoops: number;
  debateMax: number;
  filterCaseIds: string[] | undefined;
  cacheDir: string | undefined;
  regression: boolean;
  reasoning: boolean;
  agentEvals: boolean;
  connectToSupabase: boolean;
  onCaseStart: ((testCase: TestCase, runIndex: number) => void) | undefined;
  onCaseComplete: ((testCase: TestCase, runIndex: number, result: PipelineCoreResult, score: CaseScore) => void) | undefined;
  onRunComplete: ((runIndex: number, run: ScoredRun) => void) | undefined;
};

export interface HarnessResult {
  timestamp: string;
  options: {
    runs: number;
    maxLoops: number;
    debateMax: number;
    caseCount: number;
    filterActive: boolean;
    regression: boolean;
    caching: boolean;
    reasoning: boolean;
    agentEvals: boolean;
    connected: boolean;
  };
  runs: ScoredRun[];
  agentEvalResults: AgentEvalSummary | undefined;
  cascadeInfo: string | undefined;
}

let runCounter = 0;

function nextRunId(): string {
  runCounter++;
  return `bt-${Date.now()}-${runCounter}`;
}

function setupAgentConfigs(
  agentConfigOverrides: Record<string, Partial<AgentConfig>> | undefined,
): void {
  // Fill defaults for any agents not yet in the cache
  const defaults = defaultIdeaAgentConfigs();
  for (const [name, cfg] of Object.entries(defaults)) {
    if (!getAgentConfig(name)) {
      setAgentConfig(name, cfg);
    }
  }

  // Apply overrides (always takes precedence)
  if (agentConfigOverrides) {
    for (const [name, cfg] of Object.entries(agentConfigOverrides)) {
      setAgentConfig(name, { enabled: true, ...cfg });
    }
  }
}

function determineCascadeStart(
  cacheManager: CacheManager,
): { stage: CascadeStage; promptHashes: Record<string, string> } {
  const currentHashes = computePromptHashes();
  const cachedHashes = cacheManager.getPromptHashes();
  const stage = detectChanges(currentHashes, cachedHashes);
  return { stage, promptHashes: currentHashes };
}

async function runSingleCase(
  testCase: TestCase,
  runId: string,
  runIndex: number,
  options: {
    maxLoops: number;
    debateMax: number;
    reasoning: boolean;
  },
  cachedOutputs?: CachedStageOutputs,
): Promise<{ result: PipelineCoreResult; score: CaseScore }> {
  const repoDir = join(tmpdir(), `backtest-${runId}-${testCase.id}`);
  mkdirSync(repoDir, { recursive: true });

  try {
    const result = await runIdeaPipelineCore(testCase.input, repoDir, {
      stopAfterJudge: true,
      maxLoops: options.maxLoops,
      debateMax: options.debateMax,
      cachedOutputs,
      onStep: (event) => {
        console.log(`  [${testCase.id}] ${event.agent}: ${event.message}`);
      },
    });

    const score = scoreCase(result, testCase);

    // Reasoning quality scoring (only if enabled and we got a verdict)
    if (options.reasoning && result.judgeResult) {
      try {
        const rq = await scoreReasoning(
          testCase.input,
          result.finalVerdict,
          result.judgeResult.reasoning,
        );
        score.reasoningQuality = rq;
      } catch (err) {
        console.warn(`  [${testCase.id}] Reasoning scoring failed: ${String(err)}`);
      }
    }

    return { result, score };
  } finally {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export async function runBacktest(
  options?: Partial<HarnessOptions>,
): Promise<HarnessResult> {
  const {
    runs = 3,
    agentConfigOverrides = undefined,
    maxLoops = 3,
    debateMax = 3,
    filterCaseIds = undefined,
    cacheDir = undefined,
    regression = false,
    reasoning = false,
    agentEvals = false,
    connectToSupabase = false,
    onCaseStart = undefined,
    onCaseComplete = undefined,
    onRunComplete = undefined,
  } = options ?? {};

  const timestamp = new Date().toISOString();
  const allRuns: ScoredRun[] = [];
  let cascadeInfo: string | undefined;

  // ── Setup agent configs ──────────────────────────────────────────────────
  // Order: (1) defaults, (2) DB, (3) overrides — each step overwrites the previous
  invalidateConfigCache();

  // Start with defaults
  const defaults = defaultIdeaAgentConfigs();
  for (const [name, cfg] of Object.entries(defaults)) {
    setAgentConfig(name, cfg);
  }

  // If connected to Supabase, load DB configs (overwrites defaults)
  if (connectToSupabase) {
    const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
    const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (supabaseUrl && supabaseKey) {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(supabaseUrl, supabaseKey);
      await loadAgentConfig(supabase);
      console.log("[backtest] Loaded agent configs from Supabase");
    } else {
      console.warn("[backtest] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — using defaults");
    }
  }

  // Fill in any missing agents (DB might not have all idea agents)
  setupAgentConfigs(agentConfigOverrides);

  // ── Setup cache manager ──────────────────────────────────────────────────
  const cacheManager = new CacheManager(
    cacheDir ?? join(tmpdir(), `backtest-cache-${Date.now()}`),
  );

  if (regression) {
    const loaded = cacheManager.load();
    if (!loaded) {
      console.warn("[backtest] No cache found for regression mode. Running full baseline.");
    } else {
      const { stage, promptHashes } = determineCascadeStart(cacheManager);
      cascadeInfo = JSON.stringify({ stage, hashes: promptHashes });
      console.log(`[backtest] Regression mode. Cascade start: ${stage}`);
    }
  }

  if (!regression || !cacheManager.getData()) {
    const promptHashes = computePromptHashes();
    cacheManager.init(`baseline-${Date.now()}`, promptHashes);
  }

  // ── Determine test cases ─────────────────────────────────────────────────
  const cases = filterCaseIds
    ? TEST_DATASET.filter((tc) => filterCaseIds.includes(tc.id))
    : TEST_DATASET;

  // ── Run per-agent evals first (if enabled) ───────────────────────────────
  let agentEvalResults: AgentEvalSummary | undefined;
  if (agentEvals) {
    console.log("");
    console.log("══ Per-Agent Evals ══");
    agentEvalResults = await runAllAgentEvals();
    for (const r of agentEvalResults.results) {
      console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}: ${r.detail}`);
    }
    console.log(`  ${agentEvalResults.passed}/${agentEvalResults.total} passed`);
    console.log("");
  }

  // ── Main runs ────────────────────────────────────────────────────────────
  for (let runIndex = 0; runIndex < runs; runIndex++) {
    const runId = nextRunId();
    const scores: CaseScore[] = [];

    for (const testCase of cases) {
      onCaseStart?.(testCase, runIndex);

      // Determine cascade outputs for this case
      let cachedOutputs: CachedStageOutputs | undefined;
      if (regression && cacheManager.getData() && cacheManager.getData()!.cases.length > 0) {
        const cached = cacheManager.getCase(testCase.id);
        if (cached && cached.runs[runIndex]) {
          const cr = cached.runs[runIndex]!;
          const stage: CascadeStage = cascadeInfo
            ? (JSON.parse(cascadeInfo) as { stage: CascadeStage }).stage
            : "scout";

          if (stage === "scout") {
            // Re-run everything — cachedOutputs stays undefined
          } else if (stage === "executioner") {
            const s = cr.result.stageOutputs.scout ?? undefined;
            cachedOutputs = { scout: s, executioner: undefined, winningIdea: undefined };
          } else if (stage === "debate") {
            const s = cr.result.stageOutputs.scout ?? undefined;
            const e = cr.result.stageOutputs.executioner ?? undefined;
            let w = undefined as IdeaItem | undefined;
            if (e && s) {
              const rank = e.survivors[0];
              if (rank !== undefined) {
                w = s.ideas.find((i) => i.rank === rank);
              }
            }
            cachedOutputs = { scout: s, executioner: e, winningIdea: w };
          }
        }
      }

      const { result, score } = await runSingleCase(
        testCase, runId, runIndex,
        { maxLoops, debateMax, reasoning },
        cachedOutputs,
      );

      scores.push(score);
      cacheManager.putCaseRun(testCase.id, testCase.input, runIndex, result, score);
      onCaseComplete?.(testCase, runIndex, result, score);
    }

    // Save cache after each run
    cacheManager.save();

    const run: ScoredRun = {
      runId,
      runIndex,
      timestamp: new Date().toISOString(),
      cases: scores,
      summary: computeSummary(scores),
    };

    allRuns.push(run);
    onRunComplete?.(runIndex, run);
  }

  return {
    timestamp,
    options: {
      runs,
      maxLoops,
      debateMax,
      caseCount: cases.length,
      filterActive: !!filterCaseIds && filterCaseIds.length > 0,
      regression,
      caching: !!cacheDir,
      reasoning,
      agentEvals,
      connected: connectToSupabase,
    },
    runs: allRuns,
    agentEvalResults,
    cascadeInfo,
  };
}
