import { describe, it, expect, vi } from "vitest";
import { runVerifier } from "../pipeline/verifier.js";
import { extractErrorSignature } from "../pipeline/build-runner.js";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function makeRunner(summary: string) {
  return { run: vi.fn().mockResolvedValue({ summary, changed: false, usage: { inputTokens: 50, outputTokens: 10 } }) };
}

function verdict(outcome: string, summary: string): string {
  return JSON.stringify({ outcome, summary });
}

const OPTS_BASE = {
  scanId: "scan-001",
  workspaceId: "ws-001",
};

describe("runVerifier — deterministic-first classification", () => {
  it("exit code 0 → pass, no agent dispatch at all", async () => {
    const runner = makeRunner(verdict("pass", "should never be called"));
    const result = await runVerifier({
      ...OPTS_BASE, supabase: makeSupabase(), agentRunner: runner,
      buildExitCode: 0, buildOutput: "BUILD SUCCESS",
    });

    expect(result.outcome).toBe("pass");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("failure signature matches baseline exactly → fail_preexisting, no agent dispatch (the real ms-imei/ms-tasier case)", async () => {
    const buildOutput = `$ mvn install -DskipTests
[INFO] Running 'npm install --legacy-peer-deps' in /repo/client
npm ERR! code ENOVERSIONS
npm ERR! No versions available for react-flexy-loader
[ERROR] Failed to execute goal com.github.eirslett:frontend-maven-plugin:1.15.1:npm (npm install) on project imei
BUILD FAILURE`;

    const runner = makeRunner(verdict("fail_regression", "should never be called — deterministic match should short-circuit"));

    // why: baseline check ran the exact same broken build first (unmodified
    // code, same dead npm dependency), so its signature must be derived the
    // same way — a hand-typed array here would just mask an extraction bug.
    const baselineErrorSignature = extractErrorSignature(buildOutput);

    const result = await runVerifier({
      ...OPTS_BASE, supabase: makeSupabase(), agentRunner: runner,
      buildExitCode: 1, buildOutput, baselineErrorSignature,
    });

    expect(result.outcome).toBe("fail_preexisting");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("failure signature differs from baseline → dispatches agent for classification", async () => {
    const supabase = makeSupabase();
    const runner = makeRunner(verdict("fail_regression", "New compile error introduced by the fix"));

    const result = await runVerifier({
      ...OPTS_BASE, supabase, agentRunner: runner,
      buildExitCode: 1,
      buildOutput: "[ERROR] cannot find symbol: method fooBar()\nBUILD FAILURE",
      baselineErrorSignature: ["BUILD FAILURE", "npm ERR! code ENOVERSIONS"],
    });

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("fail_regression");

    const task = runner.run.mock.calls[0]![1] as { description: string };
    expect(task.description).toContain("cannot find symbol: method fooBar()");
    expect(task.description).toContain("npm ERR! code ENOVERSIONS");
  });

  it("no baseline signature available → dispatches agent (can't short-circuit without a baseline)", async () => {
    const runner = makeRunner(verdict("fail_regression", "no baseline to compare against"));
    const result = await runVerifier({
      ...OPTS_BASE, supabase: makeSupabase(), agentRunner: runner,
      buildExitCode: 1, buildOutput: "[ERROR] something broke\nBUILD FAILURE",
    });

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("fail_regression");
  });

  it("agent output wrapped in markdown fences is still parsed", async () => {
    const summary = "```json\n" + verdict("fail_preexisting", "confirmed pre-existing via reasoning") + "\n```";
    const result = await runVerifier({
      ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner(summary),
      buildExitCode: 1, buildOutput: "[ERROR] x\nBUILD FAILURE", baselineErrorSignature: ["[ERROR] y"],
    });
    expect(result.outcome).toBe("fail_preexisting");
  });

  it("missing/invalid JSON from the classification agent → fail-safe to fail_regression", async () => {
    const result = await runVerifier({
      ...OPTS_BASE, supabase: makeSupabase(), agentRunner: makeRunner("no structured verdict given"),
      buildExitCode: 1, buildOutput: "[ERROR] x\nBUILD FAILURE", baselineErrorSignature: ["[ERROR] y"],
    });
    expect(result.outcome).toBe("fail_regression");
  });
});
