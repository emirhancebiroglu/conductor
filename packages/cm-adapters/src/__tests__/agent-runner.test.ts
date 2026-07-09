import { describe, it, expect } from "vitest";
import { StubRunner } from "../stub-runner.js";

describe("StubRunner", () => {
  it("returns a summary and usage for a basic task", async () => {
    const runner = new StubRunner();
    const result = await runner.run(
      {
        agentName: "cm-sca-agent",
        provider: "opencode",
        model: "opencode-go/deepseek-v4-flash",
        systemPrompt: "test prompt",
        allowedTools: ["edit", "shell"],
      },
      {
        description: "Bump lodash from 4.17.20 to 4.17.21",
        workingDir: "/tmp",
      },
    );

    expect(result.summary).toContain("cm-sca-agent");
    expect(result.changed).toBe(false);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  it("handles empty allowedTools", async () => {
    const runner = new StubRunner();
    const result = await runner.run(
      {
        agentName: "cm-fix-planner",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "triage prompt",
        allowedTools: [],
      },
      {
        description: "Triage 3 findings",
        workingDir: "/tmp",
      },
    );

    expect(result.summary).toContain("cm-fix-planner");
    expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });

  it("handles contextFiles in task", async () => {
    const runner = new StubRunner();
    const result = await runner.run(
      {
        agentName: "cm-sast-agent",
        provider: "opencode",
        model: "opencode-go/deepseek-v4-flash",
        systemPrompt: "fix prompt",
        allowedTools: ["context7", "edit"],
      },
      {
        description: "Fix SQL injection in users.ts",
        workingDir: "/tmp",
        contextFiles: [{ path: "src/users.ts", label: "vulnerable file" }],
      },
    );

    expect(result.summary).toBeDefined();
    expect(result.changed).toBe(false);
  });
});
