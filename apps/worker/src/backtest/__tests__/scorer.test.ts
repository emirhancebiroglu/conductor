import { describe, it, expect } from "vitest";
import { scoreCase, computeSummary } from "../scorer.js";
import type { PipelineCoreResult } from "../../ideaOrchestrator.js";
import type { TestCase } from "../datasets/ideas.js";

function makePassResult(overrides?: Partial<PipelineCoreResult>): PipelineCoreResult {
  return {
    finalVerdict: "pass",
    judgeResult: {
      decision: "pass",
      reasoning: "Good idea with specific evidence",
      product_report: {
        product_name: "Test",
        one_liner: "A test",
        problem: "Testing",
        target_user: "Devs",
        value_proposition: "Saves time",
        mvp_scope: { must: ["feature1"], should: ["feature2"], wont: ["feature3"] },
        first_5_features: [{ title: "F1", description: "desc" }],
        beachhead: "Devs",
        success_metrics: ["users"],
        key_risks: ["competition"],
      },
    },
    stageOutputs: {
      scout: null,
      executioner: null,
      debates: [
        {
          round: 1,
          advocate: {
            idea_title: "Test",
            verdict: "GO",
            timing_argument: { why_now: "Now", evidence: [] },
            best_execution: { day_90: "Build", first_customer_channel: "HN", month_6_milestone: "Revenue" },
            competitive_gap: { gap_description: "Gap", gap_durability: "6mo", gap_reasoning: "Reason" },
            beachhead: { segment: "Devs", size: "1M", access: "Online" },
            strongest_argument: "Timing",
          },
          adversary: {
            idea_title: "Test",
            valid_objection: false,
            objections: [],
            fatal_objection: null,
            overall_assessment: "Looks good",
          },
          judge: { decision: "pass", reasoning: "Solid" },
        },
      ],
    },
    loopCount: 1,
    totalDebates: 1,
    error: undefined,
    ...overrides,
  };
}

function makeDeadlockResult(overrides?: Partial<PipelineCoreResult>): PipelineCoreResult {
  return makePassResult({ finalVerdict: "deadlock", judgeResult: { decision: "deadlock", reasoning: "Competitor dominant in same segment", scout_constraints: { avoid: [], focus_on: [], note: "" } }, ...overrides });
}

function makeExhaustedResult(overrides?: Partial<PipelineCoreResult>): PipelineCoreResult {
  return makePassResult({ finalVerdict: "idea_exhausted", judgeResult: null, ...overrides });
}

function makeDocCase(overrides?: Partial<TestCase>): TestCase {
  return {
    id: "test-01",
    input: "A test idea",
    category: "NO_GO_GRAVEYARD",
    expectedVerdict: "deadlock",
    tolerateAnyVerdict: false,
    difficulty: "easy",
    notes: "Test case",
    ...overrides,
  };
}

// ── scoreCase ────────────────────────────────────────────────────────────────

describe("scoreCase — basic verdicts", () => {
  it("marks clone pass as false_go", () => {
    const score = scoreCase(makePassResult(), makeDocCase({ category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" }));
    expect(score.match).toBe("false_go");
  });

  it("marks clone deadlock as correct", () => {
    const score = scoreCase(makeDeadlockResult(), makeDocCase({ category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" }));
    expect(score.match).toBe("correct");
  });

  it("marks graveyard pass as false_go", () => {
    const score = scoreCase(makePassResult(), makeDocCase({ category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" }));
    expect(score.match).toBe("false_go");
  });

  it("marks graveyard modify as false_go", () => {
    const score = scoreCase(makePassResult({ finalVerdict: "modify" }), makeDocCase({ category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" }));
    expect(score.match).toBe("false_go");
  });

  it("marks GO_CLEAR deadlock as false_nogo", () => {
    const score = scoreCase(makeDeadlockResult(), makeDocCase({ category: "GO_CLEAR", expectedVerdict: "pass" }));
    expect(score.match).toBe("false_nogo");
  });

  it("marks GO_CLEAR pass as correct", () => {
    const score = scoreCase(makePassResult(), makeDocCase({ category: "GO_CLEAR", expectedVerdict: "pass" }));
    expect(score.match).toBe("correct");
  });

  it("marks WEDGE_ON_INCUMBENT pass as correct", () => {
    const score = scoreCase(makePassResult(), makeDocCase({ category: "WEDGE_ON_INCUMBENT", expectedVerdict: "pass" }));
    expect(score.match).toBe("correct");
  });

  it("marks WEDGE_ON_INCUMBENT deadlock as false_nogo", () => {
    const score = scoreCase(makeDeadlockResult(), makeDocCase({ category: "WEDGE_ON_INCUMBENT", expectedVerdict: "pass" }));
    expect(score.match).toBe("false_nogo");
  });

  it("marks ambiguous case as ambiguous_ok regardless of verdict", () => {
    const score = scoreCase(makeDeadlockResult(), makeDocCase({ category: "AMBIGUOUS", expectedVerdict: null, tolerateAnyVerdict: true }));
    expect(score.match).toBe("ambiguous_ok");
  });

  it("marks modify as partial when GO_CLEAR expects pass", () => {
    const score = scoreCase(makePassResult({ finalVerdict: "modify" }), makeDocCase({ category: "GO_CLEAR", expectedVerdict: "pass" }));
    expect(score.match).toBe("partial");
  });
});

describe("scoreCase — exhausted pipeline (was: silent 'correct' bug)", () => {
  it("marks exhausted as exhausted_block when expected deadlock (not 'correct')", () => {
    const score = scoreCase(makeExhaustedResult(), makeDocCase({ category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" }));
    expect(score.match).toBe("exhausted_block");
    expect(score.match).not.toBe("correct");
  });

  it("marks exhausted as exhausted_miss when expected pass", () => {
    const score = scoreCase(makeExhaustedResult(), makeDocCase({ category: "GO_CLEAR", expectedVerdict: "pass" }));
    expect(score.match).toBe("exhausted_miss");
    expect(score.match).not.toBe("correct");
    expect(score.match).not.toBe("false_nogo");
  });

  it("exhausted with error preserves error message", () => {
    const score = scoreCase(makeExhaustedResult({ error: "Scout hatası: network timeout" }), makeDocCase({ category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" }));
    expect(score.error).toBe("Scout hatası: network timeout");
    expect(score.match).toBe("exhausted_block");
  });
});

describe("scoreCase — kill reason grading", () => {
  it("returns n/a for GO cases", () => {
    const score = scoreCase(makePassResult(), makeDocCase({ category: "GO_CLEAR", expectedVerdict: "pass" }));
    expect(score.killReasonMatch).toBe("n/a");
  });

  it("returns n/a when no expectedKillReason", () => {
    const score = scoreCase(makeDeadlockResult(), makeDocCase({ category: "NO_GO_NO_MARKET", expectedVerdict: "deadlock" }));
    expect(score.killReasonMatch).toBe("n/a");
  });

  it("returns aligned when judge reasoning mentions expected kill reason keyword", () => {
    const result = makeDeadlockResult({
      judgeResult: { decision: "deadlock", reasoning: "Notion dominant in this space, strong network effect, ağ etkisi çok güçlü — wedge yok", scout_constraints: { avoid: [], focus_on: [], note: "" } },
    });
    const testCase = makeDocCase({
      category: "NO_GO_GRAVEYARD",
      expectedVerdict: "deadlock",
      expectedKillReason: "incumbent",
    });
    const score = scoreCase(result, testCase);
    expect(score.killReasonMatch).toBe("aligned");
  });

  it("returns misaligned when reasoning doesn't match expected kill reason", () => {
    const result = makeDeadlockResult({
      judgeResult: { decision: "deadlock", reasoning: "Pazar çok küçük ve hedef kitle yok — TAM yetersiz", scout_constraints: { avoid: [], focus_on: [], note: "" } },
    });
    const testCase = makeDocCase({
      category: "NO_GO_GRAVEYARD",
      expectedVerdict: "deadlock",
      expectedKillReason: "incumbent",
    });
    const score = scoreCase(result, testCase);
    expect(score.killReasonMatch).toBe("misaligned");
  });

  it("returns aligned for graveyard reason", () => {
    const result = makeDeadlockResult({
      judgeResult: { decision: "deadlock", reasoning: "Bu kategori defalarca denendi ve başarısız oldu — mezarlık vakası", scout_constraints: { avoid: [], focus_on: [], note: "" } },
    });
    const testCase = makeDocCase({
      category: "NO_GO_GRAVEYARD",
      expectedVerdict: "deadlock",
      expectedKillReason: "graveyard",
    });
    const score = scoreCase(result, testCase);
    expect(score.killReasonMatch).toBe("aligned");
  });
});

// ── computeSummary ───────────────────────────────────────────────────────────

describe("computeSummary", () => {
  it("calculates correct accuracy for clear-cut cases", () => {
    const scores = [
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "a", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" })),
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "b", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" })),
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "c", category: "NO_GO_NO_MARKET", expectedVerdict: "deadlock" })),
      scoreCase(makePassResult(), makeDocCase({ id: "d", category: "GO_CLEAR", expectedVerdict: "pass" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.clearCutCases).toBe(4);
    expect(summary.correctCount).toBe(4);
    expect(summary.accuracy).toBe(1);
    expect(summary.falseGOCount).toBe(0);
  });

  it("detects false GO on graveyard cases (no hard veto — clone testing in per-agent-evals)", () => {
    const scores = [
      scoreCase(makePassResult(), makeDocCase({ id: "a", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" })),
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "b", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.falseGOCount).toBe(1);
    // No hard veto in E2E dataset — clone/graveyard testing moved to per-agent-evals
    expect(summary.incumbentFalseGOCount).toBe(0);
    expect(summary.incumbentPassCount).toBe(0);
    expect(summary.falseGOFlag).toBe(false);
  });

  it("does NOT set falseGOFlag for WEDGE_ON_INCUMBENT false_nogo (wedge not in veto)", () => {
    const scores = [
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "w", category: "WEDGE_ON_INCUMBENT", expectedVerdict: "pass" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.falseGOFlag).toBe(false);
    expect(summary.incumbentPassCount).toBe(0);
  });

  it("does NOT set falseGOFlag when WEDGE passes (wedge passing is correct)", () => {
    const scores = [
      scoreCase(makePassResult(), makeDocCase({ id: "w", category: "WEDGE_ON_INCUMBENT", expectedVerdict: "pass" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.falseGOFlag).toBe(false);
    expect(summary.falseGOCount).toBe(0);
  });

  it("computes real false-NO-GO rate from GO cases", () => {
    const scores = [
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "a", category: "GO_CLEAR", expectedVerdict: "pass" })),
      scoreCase(makePassResult(), makeDocCase({ id: "b", category: "GO_CLEAR", expectedVerdict: "pass" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.falseNOGOCount).toBe(1);
    expect(summary.falseNOGORate).toBeCloseTo(0.5);
  });

  it("does NOT count exhausted_block as correct", () => {
    const scores = [
      scoreCase(makeExhaustedResult(), makeDocCase({ id: "a", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.correctCount).toBe(0);
    expect(summary.exhaustedCount).toBe(1);
  });

  it("does NOT count exhausted_miss as false_go", () => {
    const scores = [
      scoreCase(makeExhaustedResult(), makeDocCase({ id: "a", category: "GO_CLEAR", expectedVerdict: "pass" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.falseGOCount).toBe(0);
    expect(summary.falseGOFlag).toBe(false);
    expect(summary.exhaustedCount).toBe(1);
  });

  it("handles ambiguous cases separately from clear-cut", () => {
    const scores = [
      scoreCase(makePassResult(), makeDocCase({ id: "a", category: "GO_CLEAR", expectedVerdict: "pass" })),
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "b", category: "AMBIGUOUS", expectedVerdict: null, tolerateAnyVerdict: true })),
    ];
    const summary = computeSummary(scores);
    expect(summary.clearCutCases).toBe(1);
    expect(summary.ambiguousCases).toBe(1);
    expect(summary.correctCount).toBe(1);
  });

  it("produces Wilson CI (non-null, low < high) for non-empty clear-cut cases", () => {
    const scores = [
      scoreCase(makePassResult(), makeDocCase({ id: "a", category: "GO_CLEAR", expectedVerdict: "pass" })),
      scoreCase(makeDeadlockResult(), makeDocCase({ id: "b", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.accuracyCILow).not.toBeNull();
    expect(summary.accuracyCIHigh).not.toBeNull();
    const low = summary.accuracyCILow ?? -1;
    const high = summary.accuracyCIHigh ?? -1;
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(low).toBeLessThanOrEqual(high);
  });

  it("computes kill-reason alignment counts", () => {
    const result1 = makeDeadlockResult({
      judgeResult: { decision: "deadlock", reasoning: "Notion dominant, ağ etkisi güçlü, aynı segment", scout_constraints: { avoid: [], focus_on: [], note: "" } },
    });
    const result2 = makeDeadlockResult({
      judgeResult: { decision: "deadlock", reasoning: "pazar çok küçük, hedef kitle yok", scout_constraints: { avoid: [], focus_on: [], note: "" } },
    });
    const scores = [
      scoreCase(result1, makeDocCase({ id: "a", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock", expectedKillReason: "incumbent" })),
      scoreCase(result2, makeDocCase({ id: "b", category: "NO_GO_GRAVEYARD", expectedVerdict: "deadlock", expectedKillReason: "incumbent" })),
    ];
    const summary = computeSummary(scores);
    expect(summary.killReasonGradable).toBe(2);
    expect(summary.killReasonAligned).toBe(1);
  });
});
