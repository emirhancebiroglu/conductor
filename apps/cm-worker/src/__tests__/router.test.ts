import { describe, it, expect } from "vitest";
import { filterAndRouteFindings } from "../pipeline/router.js";
import type { CmFinding } from "@conductor/cm-core";

const criticalSca: CmFinding = {
  id: "1", scanId: "s1", workspaceId: "w1",
  source: "sca", severity: "CRITICAL", rule: "CVE-1", package: "lodash", currentVersion: "4.17.20", fixedVersion: "4.17.21", upgradeImpact: null,
  file: null, line: null, fingerprint: "fp1", fixStatus: "open", fixAttempts: 0, fixNotes: null,
  createdAt: "", updatedAt: "",
};

const highSast: CmFinding = {
  id: "2", scanId: "s1", workspaceId: "w1",
  source: "sast", severity: "HIGH", rule: "SQL Injection", file: "src/users.ts", line: 42,
  package: null, currentVersion: null, fixedVersion: null, upgradeImpact: null,
  fingerprint: "fp2", fixStatus: "open", fixAttempts: 0, fixNotes: null,
  createdAt: "", updatedAt: "",
};

const mediumSca: CmFinding = {
  id: "3", scanId: "s1", workspaceId: "w1",
  source: "sca", severity: "MEDIUM", rule: "CVE-3", package: "minimist", currentVersion: "1.2.5", fixedVersion: "1.2.8", upgradeImpact: null,
  file: null, line: null, fingerprint: "fp3", fixStatus: "open", fixAttempts: 0, fixNotes: null,
  createdAt: "", updatedAt: "",
};

const lowSast: CmFinding = {
  id: "4", scanId: "s1", workspaceId: "w1",
  source: "sast", severity: "LOW", rule: "Debug Endpoint", file: "src/debug.ts", line: 10,
  package: null, currentVersion: null, fixedVersion: null, upgradeImpact: null,
  fingerprint: "fp4", fixStatus: "open", fixAttempts: 0, fixNotes: null,
  createdAt: "", updatedAt: "",
};

describe("filterAndRouteFindings", () => {
  it("splits mixed findings into SCA and SAST", () => {
    const result = filterAndRouteFindings(
      [criticalSca, highSast],
      ["CRITICAL", "HIGH"],
    );

    expect(result.sca).toHaveLength(1);
    expect(result.sca[0]!.package).toBe("lodash");
    expect(result.sast).toHaveLength(1);
    expect(result.sast[0]!.rule).toBe("SQL Injection");
    expect(result.actionable).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it("skips below-threshold findings", () => {
    const result = filterAndRouteFindings(
      [criticalSca, mediumSca, lowSast],
      ["CRITICAL", "HIGH"],
    );

    expect(result.actionable).toHaveLength(1);
    expect(result.actionable[0]!.severity).toBe("CRITICAL");
    expect(result.sca).toHaveLength(1);
    expect(result.sast).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it("marks skipped findings with skipped fixStatus", () => {
    const result = filterAndRouteFindings(
      [criticalSca, mediumSca],
      ["CRITICAL"],
    );

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.fixStatus).toBe("skipped");
  });

  it("handles empty findings list", () => {
    const result = filterAndRouteFindings([], ["CRITICAL", "HIGH"]);

    expect(result.actionable).toHaveLength(0);
    expect(result.sca).toHaveLength(0);
    expect(result.sast).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("includes all findings when threshold is very low", () => {
    const result = filterAndRouteFindings(
      [criticalSca, highSast, mediumSca, lowSast],
      ["LOW"],
    );

    expect(result.actionable).toHaveLength(4);
    expect(result.skipped).toHaveLength(0);
  });
});
