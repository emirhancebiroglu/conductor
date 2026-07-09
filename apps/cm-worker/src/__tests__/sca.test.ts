import { describe, it, expect, vi } from "vitest";

const { mockDispatchAgent } = vi.hoisted(() => ({
  mockDispatchAgent: vi.fn(),
}));

vi.mock("../pipeline/dispatch.js", () => ({
  dispatchAgent: mockDispatchAgent,
}));

import { labelUpgradeImpact, processScaFindings } from "../pipeline/sca.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CmFinding } from "@conductor/cm-core";
import type { AgentRunner } from "@conductor/cm-adapters";

// processScaFinding/processScaFindings now require Supabase + AgentRunner — covered by integration tests.
// Unit tests here cover the semver labelling logic which remains pure.

describe("labelUpgradeImpact", () => {
  it("labels patch bump as MINOR", () => {
    expect(labelUpgradeImpact("0.5.5", "0.5.7")).toBe("MINOR");
  });

  it("labels minor bump as MID", () => {
    expect(labelUpgradeImpact("0.5.5", "0.8.6")).toBe("MID");
  });

  it("labels major bump as MAJOR", () => {
    expect(labelUpgradeImpact("0.5.5", "1.1.3")).toBe("MAJOR");
  });

  it("labels major bump within 1.x as MAJOR", () => {
    expect(labelUpgradeImpact("1.0.0", "2.0.0")).toBe("MAJOR");
  });

  it("labels patch on 1.x as MINOR", () => {
    expect(labelUpgradeImpact("1.0.0", "1.0.1")).toBe("MINOR");
  });

  it("labels minor on 1.x as MID", () => {
    expect(labelUpgradeImpact("1.0.0", "1.5.0")).toBe("MID");
  });

  it("treats unparseable versions as MAJOR", () => {
    expect(labelUpgradeImpact("latest", "4.17.21")).toBe("MAJOR");
  });

  it("handles pre-1.0 patch correctly", () => {
    expect(labelUpgradeImpact("0.1.0", "0.1.1")).toBe("MINOR");
  });

  it("handles pre-1.0 minor correctly", () => {
    expect(labelUpgradeImpact("0.1.0", "0.2.0")).toBe("MID");
  });

  // Real production bug: versions with a non-numeric trailing suffix (common
  // in the Java/Maven ecosystem) were falling back to MAJOR because the old
  // parser required every dot-separated part to be a number.
  it("labels a jre-suffixed patch bump as MINOR, not MAJOR (real production case)", () => {
    expect(labelUpgradeImpact("12.8.1.jre11", "12.8.2.jre11")).toBe("MINOR");
  });

  it("labels a .Final-suffixed patch bump as MINOR, not MAJOR (real production case)", () => {
    expect(labelUpgradeImpact("4.1.115.Final", "4.1.133.Final")).toBe("MINOR");
  });

  it("labels a redhat-suffixed patch bump as MINOR", () => {
    expect(labelUpgradeImpact("2.18.1", "2.18.2.redhat-00002")).toBe("MINOR");
  });

  it("still classifies MID/MAJOR correctly when suffixes are present", () => {
    expect(labelUpgradeImpact("6.4.1.Final", "6.5.11.Final")).toBe("MID");
    expect(labelUpgradeImpact("3.4.0.Final", "4.0.0.Final")).toBe("MAJOR");
  });
});

const SCA_FINDING_MINOR: CmFinding = {
  id: "f-sca-001",
  scanId: "scan-001",
  workspaceId: "ws-001",
  source: "sca",
  severity: "HIGH",
  rule: "CVE-2026-41842",
  package: "org.springframework:spring-webmvc",
  currentVersion: "6.2.18",
  fixedVersion: "6.2.19",
  upgradeImpact: null,
  file: null,
  line: null,
  fingerprint: "sca|spring-webmvc|CVE-2026-41842",
  fixStatus: "open",
  fixAttempts: 0,
  fixNotes: null,
  description: null,
  taintFlow: null,
  createdAt: "2026-06-03T12:00:00Z",
  updatedAt: "2026-06-03T12:00:00Z",
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
  runConfig: { buildCommand: "mvn install -DskipTests -q" },
  planItems: [],
};

describe("processScaFindings — skip-minor policy", () => {
  it("still dispatches a CRITICAL/HIGH MINOR-impact finding to the agent under skip-minor policy — must fix it, only skip the test step (real production bug: this used to skip the fix entirely)", async () => {
    mockDispatchAgent.mockClear();
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({
      summary: JSON.stringify({ results: [{ fingerprint: SCA_FINDING_MINOR.fingerprint, fixStatus: "fixed", notes: "bumped to 6.2.19, confirmed via mvn dependency:tree" }] }),
      changed: true, success: true, runId: "r1", agentName: "cm-sca-agent", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 40,
    });

    const results = await processScaFindings({ ...OPTS_BASE, supabase, agentRunner: stubRunner, findings: [SCA_FINDING_MINOR], policy: "skip-minor" });

    expect(mockDispatchAgent).toHaveBeenCalledTimes(1);
    const task = mockDispatchAgent.mock.calls[0]![5] as { description: string };
    expect(task.description).toContain("spring-webmvc");
    expect(task.description).toContain("test: SKIP");
    expect(results.find((r) => r.finding.id === SCA_FINDING_MINOR.id)?.fixStatus).toBe("fixed");
  });

  it("never marks 'fixed' via the changed-status fallback when the agent process itself failed/was killed — must fall back to 'failed' regardless of git diff", async () => {
    mockDispatchAgent.mockClear();
    const { supabase } = makeSupabase();
    mockDispatchAgent.mockResolvedValueOnce({
      summary: "[timeout after 3600s]",
      changed: true, success: false, runId: "r2", agentName: "cm-sca-agent", model: "claude-sonnet-4-6", inputTokens: 50, outputTokens: 20,
    });

    const results = await processScaFindings({ ...OPTS_BASE, supabase, agentRunner: stubRunner, findings: [SCA_FINDING_MINOR], policy: "skip-minor" });

    expect(results.find((r) => r.finding.id === SCA_FINDING_MINOR.id)?.fixStatus).toBe("failed");
  });
});
