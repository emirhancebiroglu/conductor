import { describe, it, expect, vi } from "vitest";
import { processSastFinding, processSastFindings } from "../pipeline/sast.js";
import type { CmFinding } from "@conductor/cm-core";
import type { AgentRunner } from "@conductor/cm-adapters";

function makeSastFinding(overrides: Partial<CmFinding> = {}): CmFinding {
  return {
    id: "1", scanId: "s1", workspaceId: "w1",
    source: "sast", severity: "HIGH", rule: "SQL Injection",
    file: "src/users.ts", line: 42,
    package: null, currentVersion: null, fixedVersion: null, upgradeImpact: null,
    fingerprint: "fp-sast-sqli", fixStatus: "open", fixAttempts: 0, fixNotes: null,
    createdAt: "", updatedAt: "",
    ...overrides,
  };
}

function mockAgentRunner(): AgentRunner {
  return { run: vi.fn() };
}

describe("processSastFinding", () => {
  it("marks as fixed when behavior is preserved", async () => {
    const finding = makeSastFinding();
    const agentRunner = mockAgentRunner();

    const captureBehavior = vi.fn().mockResolvedValue("test output: all tests passed");

    const result = await processSastFinding(finding, agentRunner, "/tmp/repo", captureBehavior);

    expect(result.behaviorChanged).toBe(false);
    expect(result.fixStatus).toBe("fixed");
    expect(captureBehavior).toHaveBeenCalledTimes(2);
  });

  it("marks as failed when behavior changes (regression)", async () => {
    const finding = makeSastFinding();
    const agentRunner = mockAgentRunner();

    const captureBehavior = vi.fn()
      .mockResolvedValueOnce("test output: all tests passed")
      .mockResolvedValueOnce("test output: 2 tests failed, 1 error");

    const result = await processSastFinding(finding, agentRunner, "/tmp/repo", captureBehavior);

    expect(result.behaviorChanged).toBe(true);
    expect(result.fixStatus).toBe("failed");
    expect(captureBehavior).toHaveBeenCalledTimes(2);
  });

  it("records before and after behavior", async () => {
    const finding = makeSastFinding();
    const agentRunner = mockAgentRunner();

    const captureBehavior = vi.fn()
      .mockResolvedValueOnce("before: 10 tests passed")
      .mockResolvedValueOnce("after: 10 tests passed");

    const result = await processSastFinding(finding, agentRunner, "/tmp/repo", captureBehavior);

    expect(result.beforeBehavior).toBe("before: 10 tests passed");
    expect(result.afterBehavior).toBe("after: 10 tests passed");
    expect(result.behaviorChanged).toBe(true);
    expect(result.fixStatus).toBe("failed");
  });
});

describe("processSastFindings", () => {
  it("processes multiple SAST findings", async () => {
    const sqli = makeSastFinding({ rule: "SQL Injection", fingerprint: "fp1" });
    const xss = makeSastFinding({ rule: "Stored XSS", fingerprint: "fp2" });
    const agentRunner = mockAgentRunner();

    const captureBehavior = vi.fn().mockResolvedValue("all tests passed");

    const results = await processSastFindings(
      [sqli, xss],
      agentRunner,
      "/tmp/repo",
      captureBehavior,
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.fixStatus).toBe("fixed");
    expect(results[1]!.fixStatus).toBe("fixed");
  });
});
