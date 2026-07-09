import { describe, it, expect, vi } from "vitest";

const { mockDispatchAgent } = vi.hoisted(() => ({
  mockDispatchAgent: vi.fn(),
}));

vi.mock("../pipeline/dispatch.js", () => ({
  dispatchAgent: mockDispatchAgent,
}));

import { processSastFindings } from "../pipeline/sast.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CmFinding } from "@conductor/cm-core";
import type { AgentRunner } from "@conductor/cm-adapters";

const SAST_FINDING: CmFinding = {
  id: "f-sast-001",
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
  taintFlow: [{ fileName: "src/api/input.ts", line: 10 }, { fileName: "src/routes/users.ts", line: 42 }],
  createdAt: "2026-06-03T12:00:00Z",
  updatedAt: "2026-06-03T12:00:00Z",
};

const SAST_FINDING_2: CmFinding = {
  ...SAST_FINDING,
  id: "f-sast-002",
  file: "src/routes/orders.ts",
  line: 17,
  fingerprint: "sast|orders.ts|XSS|17",
  rule: "XSS",
  taintFlow: null,
};

function makeSupabase() {
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from: vi.fn((_table: string) => ({
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
        };
      }),
    })),
  } as unknown as SupabaseClient;
  return { supabase, updates };
}

const stubRunner = {} as AgentRunner;

const OPTS_BASE = {
  scanId: "scan-001",
  workspaceId: "ws-001",
  workingDir: "/tmp/repo",
  runConfig: { buildCommand: "npm run build" },
  planItems: [],
};

describe("processSastFindings", () => {
  it("dispatches cm-sast-agent once with all findings' file/taint context in one task", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({
      summary: JSON.stringify({
        results: [
          { fingerprint: SAST_FINDING.fingerprint, fixStatus: "fixed", notes: "parameterized query" },
          { fingerprint: SAST_FINDING_2.fingerprint, fixStatus: "fixed", notes: "encoded output" },
        ],
      }),
      changed: true, success: true, runId: "r1", agentName: "cm-sast-agent", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 40,
    });

    await processSastFindings({ ...OPTS_BASE, supabase, agentRunner: stubRunner, findings: [SAST_FINDING, SAST_FINDING_2] });

    expect(mockDispatchAgent).toHaveBeenCalledTimes(1);
    const task = mockDispatchAgent.mock.calls[0]![5] as { description: string };
    expect(task.description).toContain("src/routes/users.ts");
    expect(task.description).toContain("src/routes/orders.ts");
    expect(task.description).toContain("src/api/input.ts");
    expect(task.description).toContain("SQL Injection");
    expect(task.description).toContain("XSS");
  });

  it("skips dispatch entirely when planItem.strategy is skip for all findings", async () => {
    mockDispatchAgent.mockClear();
    const { supabase } = makeSupabase();

    const results = await processSastFindings({
      ...OPTS_BASE,
      supabase,
      agentRunner: stubRunner,
      findings: [SAST_FINDING],
      planItems: [{
        fingerprint: SAST_FINDING.fingerprint,
        strategy: "skip",
        category: "backend",
        reachable: false,
        exploitable: false,
        falsePositive: true,
        priority: 1,
        confidence: 0.9,
        notes: "not exploitable in this context",
      }],
    });

    expect(mockDispatchAgent).not.toHaveBeenCalled();
    expect(results[0]!.fixStatus).toBe("skipped");
  });

  it("marks needs-human findings without dispatching, still dispatches the rest", async () => {
    mockDispatchAgent.mockClear();
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({
      summary: JSON.stringify({ results: [{ fingerprint: SAST_FINDING_2.fingerprint, fixStatus: "fixed", notes: "fixed" }] }),
      changed: true, success: true, runId: "r2", agentName: "cm-sast-agent", model: "claude-sonnet-4-6", inputTokens: 50, outputTokens: 20,
    });

    const results = await processSastFindings({
      ...OPTS_BASE,
      supabase,
      agentRunner: stubRunner,
      findings: [SAST_FINDING, SAST_FINDING_2],
      planItems: [{
        fingerprint: SAST_FINDING.fingerprint,
        strategy: "needs-human",
        category: "backend",
        reachable: true,
        exploitable: true,
        falsePositive: false,
        priority: 5,
        confidence: 0.5,
        notes: "requires architecture change",
      }],
    });

    expect(mockDispatchAgent).toHaveBeenCalledTimes(1);
    const task = mockDispatchAgent.mock.calls[0]![5] as { description: string };
    expect(task.description).not.toContain("SQL Injection");
    expect(results.find((r) => r.finding.id === SAST_FINDING.id)?.fixStatus).toBe("needs_human");
    expect(results.find((r) => r.finding.id === SAST_FINDING_2.id)?.fixStatus).toBe("fixed");
  });

  it("falls back to overall changed status per finding when agent output has no valid JSON", async () => {
    mockDispatchAgent.mockClear();
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({
      summary: "I fixed everything, trust me.",
      changed: true, success: true, runId: "r3", agentName: "cm-sast-agent", model: "claude-sonnet-4-6", inputTokens: 50, outputTokens: 20,
    });

    const results = await processSastFindings({ ...OPTS_BASE, supabase, agentRunner: stubRunner, findings: [SAST_FINDING, SAST_FINDING_2] });

    expect(results).toHaveLength(2);
    for (const r of results) expect(r.fixStatus).toBe("fixed");
  });

  it("never marks 'fixed' via the changed-status fallback when the agent process itself failed/was killed (e.g. timeout) — must fall back to 'failed' regardless of git diff", async () => {
    mockDispatchAgent.mockClear();
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({
      summary: "[timeout after 3600s]",
      changed: true, success: false, runId: "r4", agentName: "cm-sast-agent", model: "claude-sonnet-4-6", inputTokens: 50, outputTokens: 20,
    });

    const results = await processSastFindings({ ...OPTS_BASE, supabase, agentRunner: stubRunner, findings: [SAST_FINDING, SAST_FINDING_2] });

    expect(results).toHaveLength(2);
    for (const r of results) expect(r.fixStatus).toBe("failed");
  });

  it("marks all dispatched findings failed and does NOT throw when dispatch throws", async () => {
    mockDispatchAgent.mockClear();
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockRejectedValueOnce(new Error("agent timeout"));

    const results = await processSastFindings({ ...OPTS_BASE, supabase, agentRunner: stubRunner, findings: [SAST_FINDING] });

    expect(results[0]!.fixStatus).toBe("failed");
    expect(results[0]!.summary).toContain("agent timeout");
  });
});
