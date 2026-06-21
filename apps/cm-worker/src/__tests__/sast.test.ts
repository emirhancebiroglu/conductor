import { describe, it, expect, vi } from "vitest";

const { mockDispatchAgent } = vi.hoisted(() => ({
  mockDispatchAgent: vi.fn(),
}));

vi.mock("../pipeline/dispatch.js", () => ({
  dispatchAgent: mockDispatchAgent,
}));

import { processSastFinding } from "../pipeline/sast.js";
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

function makeSupabase() {
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from: vi.fn((_table: string) => ({
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: vi.fn().mockReturnThis() };
      }),
    })),
  } as unknown as SupabaseClient;
  return { supabase, updates };
}

const stubRunner = {} as AgentRunner;

const OPTS_BASE = {
  scanId: "scan-001",
  workspaceId: "ws-001",
  finding: SAST_FINDING,
  workingDir: "/tmp/repo",
  runConfig: { buildCommand: "npm run build" },
};

describe("processSastFinding", () => {
  it("dispatches cm-sast-agent with file and taint context in description", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({ summary: "Fixed SQLi", changed: true, runId: "r1", agentName: "cm-sast-agent", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 40 });

    await processSastFinding({ ...OPTS_BASE, supabase, agentRunner: stubRunner });

    expect(mockDispatchAgent).toHaveBeenCalledWith(
      supabase,
      stubRunner,
      "cm-sast-agent",
      "scan-001",
      "ws-001",
      expect.objectContaining({
        description: expect.stringContaining("src/routes/users.ts"),
      }),
    );
    const task = mockDispatchAgent.mock.calls[0]![5];
    expect(task.description).toContain("src/api/input.ts");
    expect(task.description).toContain("SQL Injection");
  });

  it("skips dispatch when planItem.strategy is skip", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockClear();

    const result = await processSastFinding({
      ...OPTS_BASE,
      supabase,
      agentRunner: stubRunner,
      planItem: {
        fingerprint: SAST_FINDING.fingerprint,
        strategy: "skip",
        category: "backend",
        reachable: false,
        exploitable: false,
        falsePositive: true,
        priority: 1,
        confidence: 0.9,
        notes: "not exploitable in this context",
      },
    });

    expect(mockDispatchAgent).not.toHaveBeenCalled();
    expect(result.fixStatus).toBe("skipped");
  });

  it("sets fixStatus fixed when dispatch returns changed=true", async () => {
    const { supabase, updates } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({ summary: "Applied parameterized query", changed: true, runId: "r2", agentName: "cm-sast-agent", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 40 });

    const result = await processSastFinding({ ...OPTS_BASE, supabase, agentRunner: stubRunner });

    expect(result.fixStatus).toBe("fixed");
    const finalUpdate = updates.find((u) => u.fix_status === "fixed");
    expect(finalUpdate).toBeDefined();
  });

  it("sets fixStatus failed when dispatch returns changed=false", async () => {
    const { supabase, updates } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({ summary: "Could not apply fix", changed: false, runId: "r3", agentName: "cm-sast-agent", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 40 });

    const result = await processSastFinding({ ...OPTS_BASE, supabase, agentRunner: stubRunner });

    expect(result.fixStatus).toBe("failed");
    const finalUpdate = updates.find((u) => u.fix_status === "failed");
    expect(finalUpdate).toBeDefined();
  });

  it("sets fixStatus failed and does NOT throw when dispatch throws", async () => {
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockRejectedValueOnce(new Error("agent timeout"));

    const result = await processSastFinding({ ...OPTS_BASE, supabase, agentRunner: stubRunner });

    expect(result.fixStatus).toBe("failed");
    expect(result.summary).toContain("agent timeout");
  });
});
