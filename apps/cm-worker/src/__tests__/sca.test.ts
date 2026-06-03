import { describe, it, expect } from "vitest";
import { labelUpgradeImpact, processScaFinding, processScaFindings } from "../pipeline/sca.js";
import type { CmFinding } from "@conductor/cm-core";

function makeScaFinding(overrides: Partial<CmFinding> = {}): CmFinding {
  return {
    id: "1", scanId: "s1", workspaceId: "w1",
    source: "sca", severity: "CRITICAL", rule: "CVE-1",
    package: "lodash", currentVersion: "4.17.20", fixedVersion: "4.17.21",
    upgradeImpact: null, file: null, line: null,
    fingerprint: "fp1", fixStatus: "open", fixAttempts: 0, fixNotes: null,
    createdAt: "", updatedAt: "",
    ...overrides,
  };
}

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
});

describe("processScaFinding", () => {
  describe("skip-minor policy", () => {
    it("skips MINOR upgrades without testing", () => {
      const finding = makeScaFinding({ currentVersion: "1.0.0", fixedVersion: "1.0.1" });
      const result = processScaFinding(finding, "skip-minor");

      expect(result.impact).toBe("MINOR");
      expect(result.tested).toBe(false);
      expect(result.fixStatus).toBe("skipped");
    });

    it("tests MID upgrades", () => {
      const finding = makeScaFinding({ currentVersion: "1.0.0", fixedVersion: "1.5.0" });
      const result = processScaFinding(finding, "skip-minor");

      expect(result.impact).toBe("MID");
      expect(result.tested).toBe(true);
      expect(result.fixStatus).toBe("fixed");
    });

    it("tests MAJOR upgrades", () => {
      const finding = makeScaFinding({ currentVersion: "1.0.0", fixedVersion: "2.0.0" });
      const result = processScaFinding(finding, "skip-minor");

      expect(result.impact).toBe("MAJOR");
      expect(result.tested).toBe(true);
      expect(result.fixStatus).toBe("fixed");
    });
  });

  describe("test-all policy", () => {
    it("tests MINOR upgrades", () => {
      const finding = makeScaFinding({ currentVersion: "1.0.0", fixedVersion: "1.0.1" });
      const result = processScaFinding(finding, "test-all");

      expect(result.impact).toBe("MINOR");
      expect(result.tested).toBe(true);
      expect(result.fixStatus).toBe("fixed");
    });

    it("tests MID upgrades", () => {
      const finding = makeScaFinding({ currentVersion: "1.0.0", fixedVersion: "1.5.0" });
      const result = processScaFinding(finding, "test-all");

      expect(result.tested).toBe(true);
      expect(result.fixStatus).toBe("fixed");
    });
  });

  it("marks downgrade attempts as failed", () => {
    const finding = makeScaFinding({ currentVersion: "2.0.0", fixedVersion: "1.0.0" });
    const result = processScaFinding(finding, "test-all");

    expect(result.fixStatus).toBe("failed");
    expect(result.tested).toBe(true);
  });

  it("marks same version as fixed", () => {
    const finding = makeScaFinding({ currentVersion: "1.0.0", fixedVersion: "1.0.0" });
    const result = processScaFinding(finding, "test-all");

    expect(result.fixStatus).toBe("fixed");
  });
});

describe("processScaFindings", () => {
  it("processes multiple findings", () => {
    const findings = [
      makeScaFinding({ package: "a", currentVersion: "1.0.0", fixedVersion: "1.0.1" }),
      makeScaFinding({ package: "b", currentVersion: "1.0.0", fixedVersion: "2.0.0" }),
    ];

    const results = processScaFindings(findings, "skip-minor");

    expect(results).toHaveLength(2);
    expect(results[0]!.fixStatus).toBe("skipped");
    expect(results[1]!.fixStatus).toBe("fixed");
  });
});
