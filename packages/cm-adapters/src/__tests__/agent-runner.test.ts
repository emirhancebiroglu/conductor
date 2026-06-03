import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { StubRunner } from "../stub-runner.js";

describe("StubRunner", () => {
  it("applies a deterministic edit to a temp file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "stub-runner-test-"));
    try {
      const runner = new StubRunner();
      const result = await runner.run(
        {
          agentName: "cm-sca-agent",
          provider: "opencode",
          model: "opencode-go/deepseek-v4-flash",
          systemPrompt: "test prompt",
        },
        {
          description: "Bump lodash from 4.17.20 to 4.17.21",
          workingDir: tmpDir,
          files: [
            {
              path: "package.json",
              content: JSON.stringify({
                dependencies: { lodash: "4.17.21" },
              }),
            },
          ],
        },
      );

      expect(result.edits).toHaveLength(1);
      expect(result.edits[0]!.file).toBe("package.json");
      expect(result.edits[0]!.diff).toContain("package.json");

      expect(result.summary).toContain("Bump lodash");
      expect(result.summary).toContain("1 file(s)");

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);

      const writtenPath = join(tmpDir, "package.json");
      expect(existsSync(writtenPath)).toBe(true);
      const content = JSON.parse(readFileSync(writtenPath, "utf-8")) as {
        dependencies: Record<string, string>;
      };
      expect(content.dependencies.lodash).toBe("4.17.21");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("applies multiple files in one run", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "stub-runner-multi-"));
    try {
      const runner = new StubRunner();
      const result = await runner.run(
        {
          agentName: "cm-sca-agent",
          provider: "opencode",
          model: "opencode-go/deepseek-v4-flash",
          systemPrompt: "test prompt",
        },
        {
          description: "Fix multiple vulnerabilities",
          workingDir: tmpDir,
          files: [
            {
              path: "package.json",
              content: JSON.stringify({ dependencies: { lodash: "4.17.21", axios: "1.6.0" } }),
            },
            {
              path: "src/config.ts",
              content: "export const version = '1.0.0';",
            },
          ],
        },
      );

      expect(result.edits).toHaveLength(2);
      expect(result.usage.inputTokens).toBe(100);
      expect(existsSync(join(tmpDir, "package.json"))).toBe(true);
      expect(existsSync(join(tmpDir, "src/config.ts"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles empty files list", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "stub-runner-empty-"));
    try {
      const runner = new StubRunner();
      const result = await runner.run(
        {
          agentName: "cm-sast-agent",
          provider: "claude",
          model: "claude-sonnet-4-6",
          systemPrompt: "test prompt",
        },
        {
          description: "Review only, no changes",
          workingDir: tmpDir,
        },
      );

      expect(result.edits).toHaveLength(0);
      expect(result.summary).toContain("0 file(s)");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
