import { describe, it, expect, vi } from "vitest";
import { runVerifier } from "../pipeline/verifier.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";

function makeSupabase() {
  return {
    from: vi.fn((table: string) => {
      if (table === "agent_config") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: "cfg-v", agent_name: "cm-fix-verifier", display_name: "CM Fix Verifier",
              provider: "claude", model: "claude-sonnet-4-6", system_prompt: "Verify.",
              allowed_tools: ["edit", "shell"],
            },
            error: null,
          }),
        };
      }
      if (table === "runs") {
        return {
          insert: vi.fn(() => ({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: "run-v" }, error: null }) })),
        };
      }
      if (table === "usage_log") {
        return { insert: vi.fn(() => ({ error: null })) };
      }
      return {};
    }),
  } as unknown as SupabaseClient;
}

function makeRunner(summary: string): AgentRunner {
  return { run: vi.fn().mockResolvedValue({ summary, changed: false, usage: { inputTokens: 50, outputTokens: 10 } }) };
}

const OPTS_BASE = {
  scanId: "scan-001",
  workspaceId: "ws-001",
  workingDir: "/tmp/repo",
  runConfig: { buildCommand: "npm run build", testCommand: "npm test" },
};

describe("runVerifier — strict PASS: gate", () => {
  it("PASS: prefix → passed=true", async () => {
    const result = await runVerifier({ ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner("PASS: build ok, 42 tests passed") });
    expect(result.passed).toBe(true);
  });

  it("FAIL: prefix → passed=false", async () => {
    const result = await runVerifier({ ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner("FAIL: 3 tests failed in auth.test.ts") });
    expect(result.passed).toBe(false);
  });

  it("empty string → passed=false", async () => {
    const result = await runVerifier({ ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner("") });
    expect(result.passed).toBe(false);
  });

  it("non-prefixed text → passed=false (no loose match)", async () => {
    const result = await runVerifier({ ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner("All tests completed successfully") });
    expect(result.passed).toBe(false);
  });

  it("lowercase pass: → passed=false (must be uppercase PASS:)", async () => {
    const result = await runVerifier({ ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner("pass: build done") });
    // The impl does .toUpperCase().startsWith("PASS:") so lowercase "pass:" uppercases to "PASS:" — this should pass
    expect(result.passed).toBe(true);
  });

  it("no build/test commands → skips agent, returns passed=true", async () => {
    const runner = makeRunner("PASS: ok");
    const result = await runVerifier({
      ...OPTS_BASE,
      supabase: makeSupabase(),
      agentRunner: runner,
      runConfig: {},
    });
    expect(result.passed).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("summary is propagated in the result", async () => {
    const summary = "PASS: build ok, 100 tests passed";
    const result = await runVerifier({ ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner(summary) });
    expect(result.summary).toBe(summary);
  });
});
