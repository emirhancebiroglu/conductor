import { describe, it, expect } from "vitest";
import { labelUpgradeImpact } from "../pipeline/sca.js";

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
});
