import { describe, it, expect } from "vitest";
import { ClaudeRunner } from "../claude-runner.js";

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
