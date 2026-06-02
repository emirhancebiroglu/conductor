import type { ScoredRun, CaseScore, SummaryMetrics, ReasoningQuality } from "./scorer.js";
import type { HarnessResult } from "./harness.js";
import type { Difficulty, TestCaseCategory, TestCase } from "./datasets/ideas.js";
import type { PipelineCoreResult } from "../ideaOrchestrator.js";

const SEPARATOR = "─".repeat(80);
const THIN_SEP = "─".repeat(40);

function verdictEmoji(v: string): string {
  switch (v) {
    case "pass": return "[PASS]";
    case "modify": return "[MOD]";
    case "deadlock": return "[BLK]";
    case "idea_exhausted": return "[EXH]";
    case "error": return "[ERR]";
    default: return "[???]";
  }
}

function matchSymbol(match: string): string {
  switch (match) {
    case "correct": return "✓";
    case "false_go": return "✗ FALSE GO";
    case "false_nogo": return "✗ FALSE NO-GO";
    case "ambiguous_ok": return "~";
    case "partial": return "~ PARTIAL";
    case "exhausted_block": return "~ EXHAUSTED (block)";
    case "exhausted_miss": return "✗ EXHAUSTED (miss)";
    case "unexpected": return "? UNEXPECTED";
    default: return "?";
  }
}

export function formatCategoryLabel(cat: string): string {
  switch (cat) {
    case "NO_GO_INCUMBENT": return "INCUMBENT";
    case "NO_GO_GRAVEYARD": return "GRAVEYARD";
    case "NO_GO_NO_MARKET": return "NO-MARKET";
    case "NO_GO_UNIT_ECONOMICS": return "UNIT-ECO";
    case "GO_CLEAR": return "GO-CLEAR";
    case "WEDGE_ON_INCUMBENT": return "WEDGE";
    case "AMBIGUOUS": return "AMBIGUOUS";
    default: return cat;
  }
}

function formatReasoningQuality(rq: ReasoningQuality | undefined): string {
  if (!rq) return "";
  const bar = "█".repeat(rq.score) + "░".repeat(5 - rq.score);
  return `  Reasoning: [${bar}] ${rq.score}/5 — ${rq.explanation.slice(0, 80)}`;
}

function formatCaseScore(s: CaseScore): string {
  const expected = s.expectedVerdict !== null
    ? verdictEmoji(s.expectedVerdict)
    : "[ANY]";
  const actual = verdictEmoji(s.actualVerdict);
  const diff = (s as CaseScore & { difficulty?: Difficulty }).difficulty ?? "";

  const rq = formatReasoningQuality(s.reasoningQuality);
  const errorLine = s.error ? `  ERROR: ${s.error}` : "";
  const killLine = s.killReasonMatch && s.killReasonMatch !== "n/a"
    ? `  Kill reason: ${s.killReasonMatch}`
    : "";

  return [
    `  ${s.testCaseId.padEnd(16)} ${formatCategoryLabel(s.category).padEnd(12)} ${diff.padEnd(8)} Expected: ${expected}  Actual: ${actual}`,
    `  ${matchSymbol(s.match).padEnd(40)} Loops: ${s.loopCount}  Debates: ${s.debateRounds}${s.reasoningQuality ? `  RQ: ${s.reasoningQuality.score}/5` : ""}`,
    killLine,
    rq,
    errorLine,
  ]
    .filter(Boolean)
    .join("\n");
}

function pct(n: number | null, label?: string): string {
  if (n === null) return "N/A";
  const s = (n * 100).toFixed(1) + "%";
  return label ? `${s} (${label})` : s;
}

function formatCI(low: number | null, high: number | null): string {
  if (low === null || high === null) return "";
  return ` [95% CI: ${(low * 100).toFixed(1)}%–${(high * 100).toFixed(1)}%]`;
}

export function formatSummary(summary: SummaryMetrics, mode?: string): string {
  const lines: string[] = [];
  lines.push(THIN_SEP);
  lines.push(`  SUMMARY${mode ? ` — ${mode}` : ""}`);
  lines.push(THIN_SEP);
  lines.push(`  Total test cases:      ${summary.totalCases}`);
  lines.push(`  Clear-cut cases:       ${summary.clearCutCases}`);
  lines.push(`  Ambiguous cases:       ${summary.ambiguousCases}`);
  lines.push("");
  lines.push(`  Correct (clear-cut):   ${summary.correctCount}/${summary.clearCutCases}`);
  lines.push(`  Accuracy:              ${pct(summary.accuracy)}${formatCI(summary.accuracyCILow, summary.accuracyCIHigh)}`);
  lines.push("");
  lines.push(`  False GO count:        ${summary.falseGOCount}  (rate: ${pct(summary.falseGORate, "of NO_GO cases")})`);
  lines.push(`  False NO-GO count:     ${summary.falseNOGOCount}  (rate: ${pct(summary.falseNOGORate, "of GO cases")})`);
  lines.push(`  Exhausted pipelines:   ${summary.exhaustedCount}`);
  lines.push("");
  lines.push(`  Incumbent clone FALSE GO: ${summary.incumbentFalseGOCount}`);
  lines.push(`  Incumbent clone PASS:     ${summary.incumbentPassCount} ${summary.falseGOFlag ? "*** HARD VETO VIOLATION ***" : "✓"}`);
  lines.push("");
  lines.push(`  Kill reason accuracy:  ${summary.killReasonAligned}/${summary.killReasonGradable}${summary.killReasonGradable > 0 ? ` = ${(summary.killReasonAligned / summary.killReasonGradable * 100).toFixed(0)}%` : " (N/A)"}`);

  if (summary.falseGOFlag) {
    lines.push("");
    lines.push("  !! HARD REQUIREMENT FAILED: Zero false-GO on incumbent clones.");
    lines.push("  At least one clone idea passed through. Fix prompts before shipping.");
  }

  return lines.join("\n");
}

function formatDifficultyBreakdown(cases: CaseScore[]): string {
  const difficultyLevels: Difficulty[] = ["easy", "medium", "hard"];
  const lines: string[] = [];
  lines.push(THIN_SEP);
  lines.push("  ACCURACY BY DIFFICULTY");
  lines.push(THIN_SEP);

  for (const diff of difficultyLevels) {
    const diffCases = cases.filter(
      (c) => (c as CaseScore & { difficulty?: Difficulty }).difficulty === diff && c.category !== "AMBIGUOUS",
    );
    if (diffCases.length === 0) continue;
    const correct = diffCases.filter((c) => c.match === "correct").length;
    const pctStr = diffCases.length > 0 ? (correct / diffCases.length * 100).toFixed(0) + "%" : "N/A";
    lines.push(`  ${diff.padEnd(8)} ${correct}/${diffCases.length} = ${pctStr}`);
  }

  lines.push("");
  return lines.join("\n");
}

function formatCategoryBreakdown(cases: CaseScore[]): string {
  const cats: TestCaseCategory[] = [
    "NO_GO_GRAVEYARD", "NO_GO_NO_MARKET", "NO_GO_UNIT_ECONOMICS",
    "GO_CLEAR", "WEDGE_ON_INCUMBENT", "AMBIGUOUS",
  ];
  const lines: string[] = [];
  lines.push(THIN_SEP);
  lines.push("  ACCURACY BY CATEGORY");
  lines.push(THIN_SEP);

  for (const cat of cats) {
    const catCases = cases.filter((c) => c.category === cat);
    if (catCases.length === 0) continue;
    const isAmbiguous = cat === "AMBIGUOUS";
    if (isAmbiguous) {
      lines.push(`  ${formatCategoryLabel(cat).padEnd(12)} ${catCases.length} cases (any verdict ok)`);
    } else {
      const correct = catCases.filter((c) => c.match === "correct").length;
      const exhausted = catCases.filter((c) => c.match === "exhausted_block" || c.match === "exhausted_miss").length;
      const pctStr = (correct / catCases.length * 100).toFixed(0) + "%";
      const exhaustedNote = exhausted > 0 ? ` [${exhausted} exhausted]` : "";
      lines.push(`  ${formatCategoryLabel(cat).padEnd(12)} ${correct}/${catCases.length} = ${pctStr}${exhaustedNote}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatErrorSplit(cases: CaseScore[]): string {
  const wrongVerdict = cases.filter((c) => c.match === "false_go" || c.match === "false_nogo").length;
  const exhaustedBlock = cases.filter((c) => c.match === "exhausted_block").length;
  const exhaustedMiss = cases.filter((c) => c.match === "exhausted_miss").length;
  const unexpected = cases.filter((c) => c.match === "unexpected").length;
  if (wrongVerdict + exhaustedBlock + exhaustedMiss + unexpected === 0) return "";

  const lines: string[] = [];
  lines.push(THIN_SEP);
  lines.push("  FAILURE BREAKDOWN");
  lines.push(THIN_SEP);
  if (wrongVerdict > 0) lines.push(`  Wrong verdict:         ${wrongVerdict}`);
  if (exhaustedBlock > 0) lines.push(`  Exhausted (blocked):   ${exhaustedBlock}  (pipeline gave up, not wrong — but weak)`);
  if (exhaustedMiss > 0) lines.push(`  Exhausted (miss):      ${exhaustedMiss}  (expected pass, pipeline bailed)`);
  if (unexpected > 0) lines.push(`  Unexpected:            ${unexpected}  (bug — check scorer)`);
  lines.push("");
  return lines.join("\n");
}

function formatStability(allCaseRuns: CaseScore[]): string {
  const caseIds = [...new Set(allCaseRuns.map((c) => c.testCaseId))];
  let stableCount = 0;
  let unstableCount = 0;
  const lines: string[] = [];

  for (const caseId of caseIds) {
    const runs = allCaseRuns.filter((c) => c.testCaseId === caseId);
    const matches = runs.map((r) => r.match);
    const uniqueMatches = [...new Set(matches)];
    const isStable = uniqueMatches.length === 1;
    if (isStable) stableCount++;
    else unstableCount++;

    const matchStr = uniqueMatches.join(", ");
    const cat = runs[0] ? formatCategoryLabel(runs[0].category) : "";
    lines.push(`  ${caseId.padEnd(16)} ${cat.padEnd(12)} ${isStable ? "✓ stable" : "✦ UNSTABLE"} [${matchStr}]`);
  }

  const total = stableCount + unstableCount;
  const stabilityPct = total > 0 ? (stableCount / total * 100).toFixed(0) : "N/A";

  const result: string[] = [];
  result.push(THIN_SEP);
  result.push(`  STABILITY (across runs)`);
  result.push(THIN_SEP);
  result.push(`  Stable:   ${stableCount}/${total} (${stabilityPct}%)`);
  result.push(`  Unstable: ${unstableCount}/${total}`);
  result.push("");
  result.push(...lines);
  result.push("");

  return result.join("\n");
}

function formatDiffSection(cascadeInfo: string | undefined): string {
  if (!cascadeInfo) return "";
  try {
    const info = JSON.parse(cascadeInfo) as { stage: string; hashes: Record<string, string> };
    return `  Cascade mode: ${info.stage}\n`;
  } catch {
    return `  Cascade info: ${cascadeInfo}\n`;
  }
}

export function formatFullReport(run: ScoredRun, cascadeInfo?: string): string {
  const lines: string[] = [];
  const summary = run.summary;

  lines.push(SEPARATOR);
  lines.push(`  BACKTEST RUN #${run.runIndex + 1}  |  ${run.timestamp}`);
  lines.push(`  Run ID: ${run.runId}`);
  if (cascadeInfo) lines.push(...formatDiffSection(cascadeInfo).trim().split("\n").map((l) => `  ${l}`));
  lines.push(SEPARATOR);
  lines.push("");

  const categories: TestCaseCategory[] = [
    "NO_GO_GRAVEYARD", "NO_GO_NO_MARKET", "NO_GO_UNIT_ECONOMICS",
    "GO_CLEAR", "WEDGE_ON_INCUMBENT", "AMBIGUOUS",
  ];
  for (const cat of categories) {
    const catCases = run.cases.filter((s) => s.category === cat);
    if (catCases.length === 0) continue;

    const correct = catCases.filter((s) => s.match === "correct").length;
    const label = cat === "AMBIGUOUS" ? `${catCases.length} cases` : `${correct}/${catCases.length} correct`;
    lines.push(`  [${formatCategoryLabel(cat)}]  ${label}`);
    lines.push(SEPARATOR);

    for (const s of catCases) {
      lines.push(formatCaseScore(s));
      lines.push("");
    }
  }

  lines.push(formatSummary(summary));
  lines.push("");
  lines.push(formatDifficultyBreakdown(run.cases));
  lines.push(formatCategoryBreakdown(run.cases));
  lines.push(formatErrorSplit(run.cases));
  lines.push(SEPARATOR);
  lines.push("");

  return lines.join("\n");
}

export function formatMultiRunReport(result: HarnessResult): string {
  const { runs, agentEvalResults, cascadeInfo } = result;
  const lines: string[] = [];

  lines.push(SEPARATOR);
  lines.push("  MULTI-RUN REPORT  |  " + new Date().toISOString());
  lines.push(SEPARATOR);

  // Config info
  lines.push(`  Runs: ${result.options.runs}  |  Max loops: ${result.options.maxLoops}  |  Max debates: ${result.options.debateMax}`);
  lines.push(`  Cases: ${result.options.caseCount}  |  Caching: ${result.options.caching ? "on" : "off"}  |  Regression: ${result.options.regression ? "on" : "off"}  |  Reasoning: ${result.options.reasoning ? "on" : "off"}`);
  lines.push(`  Agent evals: ${result.options.agentEvals ? "on" : "off"}  |  Connected: ${result.options.connected ? "yes" : "no"}`);
  lines.push("");

  // Cascade info
  if (cascadeInfo) {
    lines.push(formatDiffSection(cascadeInfo));
    lines.push("");
  }

  // Per-agent eval results
  if (agentEvalResults) {
    lines.push(SEPARATOR);
    lines.push("  PER-AGENT EVALS");
    lines.push(SEPARATOR);
    for (const r of agentEvalResults.results) {
      lines.push(`  ${r.passed ? "✓" : "✗"} ${r.name}`);
      lines.push(`    ${r.detail}`);
    }
    lines.push(`  ${agentEvalResults.passed}/${agentEvalResults.total} passed`);
    lines.push("");
  }

  // Individual runs
  for (const run of runs) {
    lines.push(formatFullReport(run, cascadeInfo));
  }

  // Aggregate across runs
  lines.push(SEPARATOR);
  lines.push("  AGGREGATE (across runs)");
  lines.push(SEPARATOR);
  lines.push("");

  const allCases = runs.flatMap((r) => r.cases);
  const caseIds = [...new Set(allCases.map((c) => c.testCaseId))];

  for (const caseId of caseIds) {
    const caseRuns = allCases.filter((c) => c.testCaseId === caseId);
    const firstCase = caseRuns[0]!;
    const matchCounts: Record<string, number> = {};
    for (const cr of caseRuns) {
      matchCounts[cr.match] = (matchCounts[cr.match] ?? 0) + 1;
    }
    const matchSummary = Object.entries(matchCounts)
      .map(([m, n]) => `${m}=${n}/${caseRuns.length}`)
      .join(", ");

    // Show reasoning quality average
    const rqScores = caseRuns.map((cr) => cr.reasoningQuality?.score).filter((s): s is number => s !== undefined);
    const rqAvg = rqScores.length > 0 ? `  RQ avg: ${(rqScores.reduce((a, b) => a + b, 0) / rqScores.length).toFixed(1)}` : "";

    const diff = (firstCase as CaseScore & { difficulty?: Difficulty }).difficulty ?? "";
    lines.push(`  ${caseId.padEnd(16)} ${formatCategoryLabel(firstCase.category).padEnd(12)} ${diff.padEnd(8)} ${matchSummary}${rqAvg}`);
  }

  // Stability across runs
  lines.push("");
  lines.push(formatStability(allCases));

  // Aggregate metrics with CI
  const aggCorrect = runs.reduce((sum, r) => sum + r.summary.correctCount, 0);
  const aggTotal = runs.reduce((sum, r) => sum + r.summary.clearCutCases, 0);
  const aggAccuracy = aggTotal > 0 ? (aggCorrect / aggTotal * 100).toFixed(1) : "N/A";
  const aggFalseGO = runs.reduce((sum, r) => sum + r.summary.falseGOCount, 0);
  const aggFalseNOGO = runs.reduce((sum, r) => sum + r.summary.falseNOGOCount, 0);
  const aggExhausted = runs.reduce((sum, r) => sum + r.summary.exhaustedCount, 0);
  const runsWithVeto = runs.filter((r) => r.summary.falseGOFlag).length;

  // Aggregate CI
  const allCiLows = runs.map((r) => r.summary.accuracyCILow).filter((v): v is number => v !== null);
  const allCiHighs = runs.map((r) => r.summary.accuracyCIHigh).filter((v): v is number => v !== null);
  const avgCILow = allCiLows.length > 0 ? allCiLows.reduce((a, b) => a + b, 0) / allCiLows.length : null;
  const avgCIHigh = allCiHighs.length > 0 ? allCiHighs.reduce((a, b) => a + b, 0) / allCiHighs.length : null;

  lines.push(`  Aggregate accuracy:     ${aggCorrect}/${aggTotal} = ${aggAccuracy}%${formatCI(avgCILow, avgCIHigh)}`);
  lines.push(`  Total false GO:         ${aggFalseGO} across ${runs.length} runs`);
  lines.push(`  Total false NO-GO:      ${aggFalseNOGO} across ${runs.length} runs`);
  lines.push(`  Exhausted pipelines:    ${aggExhausted} across ${runs.length} runs`);
  lines.push(`  Veto violations:        ${runsWithVeto}/${runs.length} runs`);

  if (runsWithVeto > 0) {
    lines.push("");
    lines.push("  *** HARD VETO VIOLATED in at least one run ***");
    lines.push("  Incumbent CLONES must NEVER pass. Fix prompts before any skill edits.");
    lines.push("  (Wedge-on-incumbent passes are NOT veto violations — they are expected.)");
  }

  lines.push("");
  lines.push(SEPARATOR);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Verbose per-case output — shows full intermediate pipeline state
// ---------------------------------------------------------------------------

export function formatVerboseCase(testCase: TestCase, result: PipelineCoreResult): string {
  const W = "═".repeat(60);
  const lines: string[] = [];

  lines.push("");
  lines.push(`${W}`);
  lines.push(`  VERBOSE: ${testCase.id}  |  loops=${result.loopCount}  debates=${result.totalDebates}  verdict=${verdictEmoji(result.finalVerdict)}`);
  lines.push(`  seed: "${testCase.input.slice(0, 100)}${testCase.input.length > 100 ? "…" : ""}"`);
  lines.push(`${W}`);

  if (result.error) {
    lines.push(`  ERROR: ${result.error}`);
  }

  // Scout output
  const scout = result.stageOutputs.scout;
  if (scout) {
    lines.push("");
    lines.push(`  ── SCOUT (${scout.ideas.length} ideas generated) ──`);
    lines.push(`  research_areas: ${(scout.research_areas ?? []).join(", ") || "N/A"}`);
    lines.push(`  top_5_ids: [${scout.top_5_ids.join(", ")}]`);
    lines.push("");
    for (const idea of scout.ideas) {
      const isTop = scout.top_5_ids.includes(idea.rank);
      const tag = isTop ? "★" : " ";
      lines.push(`  ${tag} rank=${idea.rank}  score=${idea.scores.opportunity_score.toFixed(1)}  title="${idea.title}"`);
      lines.push(`       one_liner: "${idea.one_liner}"`);
      lines.push(`       competitors: [${idea.top_competitors.join(", ")}]`);
      lines.push(`       gap: "${idea.competitor_gap}"`);
      if (idea.pain_evidence?.length > 0) {
        lines.push(`       evidence[0]: "${idea.pain_evidence[0]!.quote}" (${idea.pain_evidence[0]!.source})`);
      }
    }
  }

  // Executioner output
  const exec = result.stageOutputs.executioner;
  if (exec) {
    lines.push("");
    lines.push(`  ── EXECUTIONER ──`);
    lines.push(`  survivors: [${exec.survivors.join(", ")}]`);
    lines.push(`  killed:    [${exec.killed.join(", ")}]`);
    const killReasons = exec.kill_reasons as Record<string, string>;
    for (const [rank, reason] of Object.entries(killReasons)) {
      lines.push(`  kill[${rank}]: ${reason}`);
    }
  }

  // Debate rounds
  for (const debate of result.stageOutputs.debates) {
    lines.push("");
    lines.push(`  ── DEBATE ${debate.round} ──`);

    // Advocate
    const adv = debate.advocate;
    lines.push(`  ADVOCATE:`);
    lines.push(`    timing: "${adv.timing_argument.why_now}"`);
    lines.push(`    gap_durability: ${adv.competitive_gap.gap_durability}`);
    lines.push(`    gap: "${adv.competitive_gap.gap_description}"`);
    lines.push(`    beachhead: ${adv.beachhead.segment} (${adv.beachhead.size})`);
    lines.push(`    strongest: "${adv.strongest_argument}"`);

    // Adversary
    const adr = debate.adversary;
    lines.push(`  ADVERSARY: valid_objection=${String(adr.valid_objection)}  fatal=${adr.fatal_objection ? `"${adr.fatal_objection.slice(0, 100)}"` : "null"}`);
    for (const obj of (adr.objections ?? [])) {
      lines.push(`    [${obj.severity}] ${obj.category}: ${obj.counter}`);
    }
    if (!adr.valid_objection && (adr as { reason?: string }).reason) {
      lines.push(`    reason: "${(adr as { reason?: string }).reason}"`);
    }

    // Judge
    const j = debate.judge;
    lines.push(`  JUDGE: decision=${j.decision.toUpperCase()}`);
    lines.push(`    reasoning: "${j.reasoning}"`);
    if (j.decision === "modify" && j.modification) {
      lines.push(`    modified_idea: "${j.modification.modified_idea}"`);
    }
    if (j.decision === "deadlock" && j.scout_constraints) {
      const sc = j.scout_constraints as { avoid?: string[]; focus_on?: string[]; note?: string };
      if (sc.avoid?.length) lines.push(`    avoid: ${sc.avoid.join("; ")}`);
      if (sc.focus_on?.length) lines.push(`    focus_on: ${sc.focus_on.join("; ")}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
