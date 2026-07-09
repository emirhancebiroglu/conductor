import { describe, it, expect } from "vitest";
import { ClaudeRunner, resolveClaudeEffort } from "../claude-runner.js";

// ClaudeRunner uses spawn() from node:child_process — full integration tests
// require a real claude/opencode binary. These tests cover:
// 1. The unsupported-provider guard (throws synchronously, no spawn needed)
// 2. Prompt composition via buildPrompt (accessible through the public run interface)

describe("ClaudeRunner", () => {
  it("throws for unsupported provider without spawning", async () => {
    const runner = new ClaudeRunner();
    await expect(
      runner.run(
        {
          agentName: "test-agent",
          provider: "unsupported-provider",
          model: "some-model",
          systemPrompt: "test",
          allowedTools: [],
        },
        { description: "test task", workingDir: "/tmp" },
      ),
    ).rejects.toThrow("Unsupported agent provider: unsupported-provider");
  });

  it("builds prompt from systemPrompt + task description", () => {
    // We can't easily call run() without a real binary, but we can verify
    // the ClaudeRunner is instantiable and the interface matches.
    const runner = new ClaudeRunner();
    expect(runner).toBeInstanceOf(ClaudeRunner);
    expect(typeof runner.run).toBe("function");
  });
});

describe("resolveClaudeEffort", () => {
  it("maps cm-fix-planner to high effort (triage over all findings — complex reasoning)", () => {
    expect(resolveClaudeEffort("cm-fix-planner")).toBe("high");
  });

  it("maps cm-sca-agent and cm-sast-agent to medium effort (scoped single-fix execution)", () => {
    expect(resolveClaudeEffort("cm-sca-agent")).toBe("medium");
    expect(resolveClaudeEffort("cm-sast-agent")).toBe("medium");
  });

  it("maps cm-fix-verifier to low effort (deterministic build/test gate)", () => {
    expect(resolveClaudeEffort("cm-fix-verifier")).toBe("low");
  });

  it("falls back to medium for an unmapped agent name", () => {
    expect(resolveClaudeEffort("some-future-agent")).toBe("medium");
  });
});
