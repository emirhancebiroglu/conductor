import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeRunner } from "../claude-runner.js";

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: mockExeca,
}));

const MOCK_AGENT_CONFIG = {
  agentName: "cm-sca-agent",
  provider: "claude",
  model: "claude-sonnet-4-6",
  systemPrompt: "You are an SCA dependency fixer.",
};

const MOCK_OPCODE_CONFIG = {
  agentName: "cm-sast-agent",
  provider: "opencode",
  model: "opencode-go/deepseek-v4-flash",
  systemPrompt: "You are a SAST code fixer.",
};

const MOCK_CLAUDE_OUTPUT = JSON.stringify({
  edits: [{ file: "package.json", diff: "+++ package.json\n+  \"lodash\": \"4.17.21\"" }],
  summary: "Bumped lodash to 4.17.21",
  usage: { inputTokens: 150, outputTokens: 75 },
});

beforeEach(() => {
  mockExeca.mockReset();
});

describe("ClaudeRunner", () => {
  describe("with claude provider", () => {
    it("invokes claude CLI with correct args from agent_config", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_CLAUDE_OUTPUT });

      const runner = new ClaudeRunner();
      const result = await runner.run(MOCK_AGENT_CONFIG, {
        description: "Bump lodash from 4.17.20 to 4.17.21",
        workingDir: "/tmp/test-repo",
      });

      expect(mockExeca).toHaveBeenCalledTimes(1);
      const [cmd, args, options] = mockExeca.mock.calls[0] as [string, string[], { cwd: string }];
      expect(cmd).toBe("claude");
      expect(args).toContain("-p");
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-6");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(options.cwd).toBe("/tmp/test-repo");

      expect(result.edits).toHaveLength(1);
      expect(result.edits[0]!.file).toBe("package.json");
      expect(result.summary).toBe("Bumped lodash to 4.17.21");
      expect(result.usage.inputTokens).toBe(150);
      expect(result.usage.outputTokens).toBe(75);
    });

    it("uses model and systemPrompt from agent_config (not hardcoded)", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_CLAUDE_OUTPUT });

      const runner = new ClaudeRunner();
      const customConfig = {
        ...MOCK_AGENT_CONFIG,
        model: "claude-opus-4-5",
        systemPrompt: "Custom system prompt for testing",
      };

      await runner.run(customConfig, {
        description: "Test task",
        workingDir: "/tmp/test",
      });

      const [, args] = mockExeca.mock.calls[0] as [string, string[]];
      const modelIndex = args.indexOf("--model");
      expect(args[modelIndex + 1]).toBe("claude-opus-4-5");
      const promptIndex = args.indexOf("-p");
      expect(args[promptIndex + 1]).toContain("Custom system prompt for testing");
    });
  });

  describe("with opencode provider", () => {
    it("invokes opencode CLI with correct args from agent_config", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_CLAUDE_OUTPUT });

      const runner = new ClaudeRunner();
      const result = await runner.run(MOCK_OPCODE_CONFIG, {
        description: "Fix SQL injection in src/users.ts",
        workingDir: "/tmp/test-repo",
      });

      expect(mockExeca).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockExeca.mock.calls[0] as [string, string[]];
      expect(cmd).toBe("opencode");
      expect(args).toContain("run");
      expect(args).toContain("--model");
      expect(args).toContain("opencode-go/deepseek-v4-flash");

      expect(result.edits).toHaveLength(1);
      expect(result.usage.inputTokens).toBe(150);
    });
  });

  describe("output parsing", () => {
    it("handles non-JSON output gracefully", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "Plain text response from LLM" });

      const runner = new ClaudeRunner();
      const result = await runner.run(MOCK_AGENT_CONFIG, {
        description: "Test",
        workingDir: "/tmp/test",
      });

      expect(result.edits).toHaveLength(0);
      expect(result.summary).toBeTruthy();
      expect(result.usage.inputTokens).toBe(0);
    });

    it("handles empty edits gracefully", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({ summary: "No changes needed", usage: { inputTokens: 50, outputTokens: 25 } }),
      });

      const runner = new ClaudeRunner();
      const result = await runner.run(MOCK_AGENT_CONFIG, {
        description: "Review only",
        workingDir: "/tmp/test",
      });

      expect(result.edits).toHaveLength(0);
      expect(result.summary).toBe("No changes needed");
      expect(result.usage.inputTokens).toBe(50);
    });
  });

  describe("error handling", () => {
    it("throws for unsupported provider", async () => {
      const runner = new ClaudeRunner();
      await expect(
        runner.run(
          { agentName: "test", provider: "unsupported", model: "x", systemPrompt: "" },
          { description: "test", workingDir: "/tmp" },
        ),
      ).rejects.toThrow("Unsupported agent provider: unsupported");
    });
  });
});
