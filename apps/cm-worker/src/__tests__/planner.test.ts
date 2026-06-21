import { describe, it, expect, vi } from "vitest";

const { mockDispatchAgent } = vi.hoisted(() => ({
  mockDispatchAgent: vi.fn(),
}));

vi.mock("../pipeline/dispatch.js", () => ({
  dispatchAgent: mockDispatchAgent,
}));

import { runPlanner } from "../pipeline/planner.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import type { CmFinding } from "@conductor/cm-core";

const BASE_FINDING: CmFinding = {
  id: "f-001",
  scanId: "scan-001",
  workspaceId: "ws-001",
  source: "sca",
  severity: "CRITICAL",
  rule: "CVE-2024-1234",
  package: "lodash",
  currentVersion: "4.17.20",
  fixedVersion: "4.17.21",
  upgradeImpact: null,
  file: null,
  line: null,
  fingerprint: "sca|lodash|CVE-2024-1234",
  fixStatus: "open",
  fixAttempts: 0,
  fixNotes: null,
  description: "Prototype pollution in lodash",
  taintFlow: null,
  createdAt: "2026-06-03T12:00:00Z",
  updatedAt: "2026-06-03T12:00:00Z",
};

const SAST_FINDING: CmFinding = {
  id: "f-002",
  scanId: "scan-001",
  workspaceId: "ws-001",
  source: "sast",
  severity: "HIGH",
  rule: "SQL Injection",
  package: null,
  currentVersion: null,
  fixedVersion: null,
  upgradeImpact: null,
  file: "src/routes/users.ts",
  line: 42,
  fingerprint: "sast|users.ts|SQLi|42",
  fixStatus: "open",
  fixAttempts: 0,
  fixNotes: null,
  description: "Unsanitized user input in SQL query",
  taintFlow: null,
  createdAt: "2026-06-03T12:00:00Z",
  updatedAt: "2026-06-03T12:00:00Z",
};

// Track updates keyed by fingerprint via the chained .eq("scan_id",...).eq("fingerprint",...)
function makeSupabase() {
  const updates: Array<{ fingerprint: string; fix_status: string; fix_notes: string }> = [];

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "cm_finding") {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            let capturedFingerprint = "";
            const eqChain = {
              eq: vi.fn((_col: string, val: unknown) => {
                if (_col === "fingerprint") capturedFingerprint = val as string;
                if (capturedFingerprint) {
                  updates.push({
                    fingerprint: capturedFingerprint,
                    fix_status: payload.fix_status as string,
                    fix_notes: payload.fix_notes as string,
                  });
                }
                return eqChain;
              }),
            };
            return eqChain;
          }),
        };
      }
      return {};
    }),
  } as unknown as SupabaseClient;

  return { supabase, updates };
}

const stubRunner = {} as AgentRunner;

function makePlanJson(findings: Array<Record<string, unknown>>) {
  return JSON.stringify({ findings });
}

function dispatchResult(summary: string) {
  return { summary, changed: false, runId: "r1", agentName: "cm-fix-planner", model: "claude-opus-4-8", inputTokens: 100, outputTokens: 50 };
}

describe("runPlanner", () => {
  it("parses valid extended JSON from agent output", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce(dispatchResult(makePlanJson([{
      fingerprint: BASE_FINDING.fingerprint,
      strategy: "upgrade",
      category: "backend",
      reachable: true,
      exploitable: true,
      falsePositive: false,
      mitigationKind: "none",
      priority: 9,
      confidence: 0.95,
      notes: "CVE confirmed reachable",
      targetVersion: "4.17.21",
    }])));

    const result = await runPlanner(supabase, stubRunner, "scan-001", "ws-001", [BASE_FINDING], "/tmp/repo");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.strategy).toBe("upgrade");
    expect(result.items[0]!.category).toBe("backend");
    expect(result.items[0]!.confidence).toBe(0.95);
    expect(result.items[0]!.targetVersion).toBe("4.17.21");
    expect(result.items[0]!.falsePositive).toBe(false);
  });

  it("sorts by priority descending", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce(dispatchResult(makePlanJson([
      { fingerprint: BASE_FINDING.fingerprint, strategy: "upgrade", category: "backend", reachable: true, exploitable: true, falsePositive: false, priority: 5, confidence: 0.8, notes: "low prio" },
      { fingerprint: SAST_FINDING.fingerprint, strategy: "code-fix", category: "backend", reachable: true, exploitable: true, falsePositive: false, priority: 9, confidence: 0.9, notes: "high prio" },
    ])));

    const result = await runPlanner(supabase, stubRunner, "scan-001", "ws-001", [BASE_FINDING, SAST_FINDING], "/tmp/repo");

    expect(result.items[0]!.priority).toBe(9);
    expect(result.items[1]!.priority).toBe(5);
  });

  it("fallback plan covers every finding when JSON is malformed", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce(dispatchResult("sorry I cannot help with this"));

    const result = await runPlanner(supabase, stubRunner, "scan-001", "ws-001", [BASE_FINDING, SAST_FINDING], "/tmp/repo");

    expect(result.items).toHaveLength(2);
    const scaItem = result.items.find((i) => i.fingerprint === BASE_FINDING.fingerprint);
    const sastItem = result.items.find((i) => i.fingerprint === SAST_FINDING.fingerprint);
    expect(scaItem?.strategy).toBe("upgrade");
    expect(sastItem?.strategy).toBe("code-fix");
  });

  it("mitigate strategy passes through mitigationKind=override", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce(dispatchResult(makePlanJson([{
      fingerprint: BASE_FINDING.fingerprint,
      strategy: "mitigate",
      category: "backend",
      reachable: true,
      exploitable: true,
      falsePositive: false,
      mitigationKind: "override",
      priority: 8,
      confidence: 0.85,
      notes: "no clean upgrade; use npm overrides",
    }])));

    const result = await runPlanner(supabase, stubRunner, "scan-001", "ws-001", [BASE_FINDING], "/tmp/repo");

    expect(result.items[0]!.strategy).toBe("mitigate");
    expect(result.items[0]!.mitigationKind).toBe("override");
  });

  it("needs-human strategy persists fix_status=needs_human", async () => {
    const { supabase, updates } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce(dispatchResult(makePlanJson([{
      fingerprint: BASE_FINDING.fingerprint,
      strategy: "needs-human",
      category: "infra",
      reachable: true,
      exploitable: true,
      falsePositive: false,
      priority: 7,
      confidence: 0.6,
      notes: "no safe automated fix exists for this transitive chain",
    }])));

    await runPlanner(supabase, stubRunner, "scan-001", "ws-001", [BASE_FINDING], "/tmp/repo");

    const update = updates.find((u) => u.fingerprint === BASE_FINDING.fingerprint);
    expect(update?.fix_status).toBe("needs_human");
  });

  it("skip with falsePositive=true persists fix_status=skipped", async () => {
    const { supabase, updates } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce(dispatchResult(makePlanJson([{
      fingerprint: BASE_FINDING.fingerprint,
      strategy: "skip",
      category: "backend",
      reachable: false,
      exploitable: false,
      falsePositive: true,
      priority: 1,
      confidence: 0.95,
      notes: "dependency not used in any reachable code path",
    }])));

    await runPlanner(supabase, stubRunner, "scan-001", "ws-001", [BASE_FINDING], "/tmp/repo");

    const update = updates.find((u) => u.fingerprint === BASE_FINDING.fingerprint);
    expect(update?.fix_status).toBe("skipped");
  });
});
