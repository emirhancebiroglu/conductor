import type { TestCase, TestCaseCategory } from "./datasets/ideas.js";
import type { PipelineCoreResult } from "../ideaOrchestrator.js";

export type VerdictMatch =
  | "correct"
  | "false_go"        // Predicted pass/modify when label says deadlock (CRITICAL)
  | "false_nogo"      // Predicted deadlock when label says pass
  | "ambiguous_ok"    // Tolerated any verdict on AMBIGUOUS case
  | "partial"         // Passed but through modify path (label=pass, actual=modify)
  | "exhausted_block" // Pipeline exhausted/errored but expected deadlock (not a false_go, but weak signal)
  | "exhausted_miss"  // Pipeline exhausted/errored but expected pass (a miss, counted as wrong)
  | "unexpected";     // Should not occur — logged for debugging

export type KillReasonMatch =
  | "aligned"    // Judge/Executioner named the expected kill reason
  | "misaligned" // Verdict correct but kill reason differs
  | "n/a";       // Case is not a NO_GO or has no expectedKillReason

export interface ReasoningQuality {
  score: number;
  explanation: string;
}

export interface CaseScore {
  testCaseId: string;
  category: TestCaseCategory;
  input: string;
  expectedVerdict: string | null;
  actualVerdict: string;
  match: VerdictMatch;
  killReasonMatch: KillReasonMatch;
  loopCount: number;
  totalDebates: number;
  debateRounds: number;
  error: string | undefined;
  notes: string;
  reasoningQuality: ReasoningQuality | undefined;
}

export interface ScoredRun {
  runId: string;
  runIndex: number;
  timestamp: string;
  cases: CaseScore[];
  summary: SummaryMetrics;
}

export interface SummaryMetrics {
  totalCases: number;
  clearCutCases: number;
  ambiguousCases: number;
  correctCount: number;
  accuracy: number | null;
  accuracyCILow: number | null;
  accuracyCIHigh: number | null;
  falseGOCount: number;
  falseGORate: number | null;        // false_go / total NO_GO cases
  falseNOGOCount: number;
  falseNOGORate: number | null;      // false_nogo / total GO cases
  exhaustedCount: number;            // total exhausted_block + exhausted_miss
  incumbentFalseGOCount: number;     // always 0 — clone testing in per-agent-evals
  incumbentPassCount: number;        // always 0 — clone testing in per-agent-evals
  killReasonAligned: number;
  killReasonGradable: number;
  falseGOFlag: boolean;              // always false — no hard veto in E2E dataset
}

export function scoreCase(
  result: PipelineCoreResult,
  testCase: TestCase,
): CaseScore {
  const actualVerdict = result.finalVerdict;
  const expected = testCase.expectedVerdict;
  const isExhausted = actualVerdict === "idea_exhausted" || !!result.error;

  // AMBIGUOUS: tolerate any verdict
  if (testCase.tolerateAnyVerdict) {
    return {
      testCaseId: testCase.id,
      category: testCase.category,
      input: testCase.input,
      expectedVerdict: null,
      actualVerdict,
      match: "ambiguous_ok",
      killReasonMatch: "n/a",
      loopCount: result.loopCount,
      totalDebates: result.totalDebates,
      debateRounds: result.stageOutputs.debates.length,
      error: result.error,
      notes: testCase.notes,
      reasoningQuality: undefined,
    };
  }

  let match: VerdictMatch;

  if (isExhausted) {
    // Pipeline gave up: treat as a miss in its own bucket (never silently "correct")
    if (expected === "deadlock") {
      match = "exhausted_block"; // blocked by exhaustion rather than reasoning — weak signal
    } else {
      match = "exhausted_miss"; // expected pass but pipeline bailed
    }
  } else if (actualVerdict === expected) {
    match = "correct";
  } else if (expected === "deadlock" && (actualVerdict === "pass" || actualVerdict === "modify")) {
    match = "false_go";
  } else if (expected === "pass" && actualVerdict === "deadlock") {
    match = "false_nogo";
  } else if (expected === "pass" && actualVerdict === "modify") {
    match = "partial"; // passed via modify path — acceptable but imperfect
  } else {
    match = "unexpected";
    console.warn(`[scorer] Unexpected combination: expected=${String(expected)} actual=${actualVerdict} case=${testCase.id}`);
  }

  // Kill-reason grading (only meaningful for NO_GO cases with an expectedKillReason)
  const killReasonMatch = scoreKillReason(result, testCase);

  return {
    testCaseId: testCase.id,
    category: testCase.category,
    input: testCase.input,
    expectedVerdict: expected,
    actualVerdict,
    match,
    killReasonMatch,
    loopCount: result.loopCount,
    totalDebates: result.totalDebates,
    debateRounds: result.stageOutputs.debates.length,
    error: result.error,
    notes: testCase.notes,
    reasoningQuality: undefined,
  };
}

function scoreKillReason(result: PipelineCoreResult, testCase: TestCase): KillReasonMatch {
  const expectedKillReason = (testCase as TestCase & { expectedKillReason?: string }).expectedKillReason;
  if (!expectedKillReason) return "n/a";
  if (testCase.expectedVerdict !== "deadlock") return "n/a";

  // Extract reasoning from executioner kill_reasons or judge reasoning
  const execResult = result.stageOutputs.executioner;
  const judgeResult = result.judgeResult;

  const killReasonsText = execResult
    ? Object.values(execResult.kill_reasons as Record<string, string>).join(" ")
    : "";
  const reasoningText = [killReasonsText, judgeResult?.reasoning ?? ""].join(" ").toLowerCase();

  const keywordMap: Record<string, string[]> = {
    incumbent: ["incumbent", "mevcut oyuncu", "dominant", "copilot", "notion", "stripe", "linear", "jira", "cursor", "zapier", "klue", "crayon", "ağ etkisi", "network effect", "moat"],
    graveyard: ["graveyard", "mezarlık", "başarısız oldu", "kapandı", "battı", "iflas", "failed", "shut down", "closed"],
    no_market: ["pazar çok küçük", "tam çok", "niche çok", "market too small", "hedef kitle yok", "talep yok"],
    unit_economics: ["birim ekonomi", "unit economics", "marj", "margin", "cac", "ltv", "sermaye yoğun", "capital intensive"],
    distribution: ["dağıtım kanalı yok", "distribution", "erişim yok", "kanal yok"],
  };

  const keywords = keywordMap[expectedKillReason] ?? [];
  const matched = keywords.some((kw) => reasoningText.includes(kw));
  return matched ? "aligned" : "misaligned";
}

/** Wilson score confidence interval for a proportion p = k/n at 95% confidence */
function wilsonCI(k: number, n: number): { low: number; high: number } | null {
  if (n === 0) return null;
  const z = 1.96; // 95%
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const spread = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

export function computeSummary(scores: CaseScore[]): SummaryMetrics {
  const totalCases = scores.length;
  const ambiguousCases = scores.filter((s) => s.category === "AMBIGUOUS").length;
  const clearCutCases = totalCases - ambiguousCases;
  const clearCutScores = scores.filter((s) => s.category !== "AMBIGUOUS");

  // Correct = exact match (excludes exhausted_block, exhausted_miss, partial, unexpected)
  const correctCount = clearCutScores.filter((s) => s.match === "correct").length;
  const accuracy = clearCutCases > 0 ? correctCount / clearCutCases : null;
  const ci = clearCutCases > 0 ? wilsonCI(correctCount, clearCutCases) : null;

  // False GO (predicted pass/modify when should be deadlock)
  // NO_GO categories moved to per-agent-evals — E2E dataset has no NO_GO cases
  const falseGOCases = scores.filter((s) => s.match === "false_go");
  const falseGOCount = falseGOCases.length;
  const totalNOGO = scores.filter((s) => s.expectedVerdict === "deadlock").length;
  const falseGORate = totalNOGO > 0 ? falseGOCount / totalNOGO : null;

  // False NO-GO (predicted deadlock when should pass)
  const falseNOGOCases = scores.filter((s) => s.match === "false_nogo");
  const falseNOGOCount = falseNOGOCases.length;
  const totalGO = scores.filter(
    (s) =>
      (s.category === "GO_CLEAR" || s.category === "WEDGE_ON_INCUMBENT") &&
      s.expectedVerdict === "pass",
  ).length;
  const falseNOGORate = totalGO > 0 ? falseNOGOCount / totalGO : null;

  // Exhausted cases
  const exhaustedCount = scores.filter(
    (s) => s.match === "exhausted_block" || s.match === "exhausted_miss",
  ).length;

  // No hard veto in dataset — clone testing moved to per-agent-evals.ts
  const incumbentFalseGOCount = 0;
  const incumbentPassCount = 0;

  // Kill-reason accuracy
  const gradableKillReasons = scores.filter((s) => s.killReasonMatch !== "n/a");
  const alignedKillReasons = gradableKillReasons.filter((s) => s.killReasonMatch === "aligned");

  return {
    totalCases,
    clearCutCases,
    ambiguousCases,
    correctCount,
    accuracy,
    accuracyCILow: ci?.low ?? null,
    accuracyCIHigh: ci?.high ?? null,
    falseGOCount,
    falseGORate,
    falseNOGOCount,
    falseNOGORate,
    exhaustedCount,
    incumbentFalseGOCount,
    incumbentPassCount,
    killReasonAligned: alignedKillReasons.length,
    killReasonGradable: gradableKillReasons.length,
    falseGOFlag: incumbentPassCount > 0,
  };
}
