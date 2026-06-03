import type { CmFinding } from "@conductor/cm-core";

export type UpgradeImpact = "MINOR" | "MID" | "MAJOR";

type SemverParts = { major: number; minor: number; patch: number };

function parseVersion(v: string): SemverParts | null {
  const parts = v.split(".").map((s) => parseInt(s, 10));
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return { major: parts[0]!, minor: parts[1]!, patch: parts[2]! };
}

export function labelUpgradeImpact(current: string, target: string): UpgradeImpact {
  const cur = parseVersion(current);
  const tgt = parseVersion(target);

  if (!cur || !tgt) {
    return "MAJOR";
  }

  if (tgt.major !== cur.major) {
    return "MAJOR";
  }

  if (tgt.minor !== cur.minor) {
    return "MID";
  }

  return "MINOR";
}

export type ScaTestPolicy = "skip-minor" | "test-all";

export type ScaFixResult = {
  finding: CmFinding;
  impact: UpgradeImpact;
  tested: boolean;
  fixStatus: "fixed" | "skipped" | "failed";
};

export function processScaFinding(
  finding: CmFinding,
  policy: ScaTestPolicy,
): ScaFixResult {
  const currentVer = finding.currentVersion ?? "0.0.0";
  const targetVer = finding.fixedVersion ?? currentVer;
  const impact = labelUpgradeImpact(currentVer, targetVer);

  const shouldTest = policy === "test-all" || impact !== "MINOR";

  if (!shouldTest) {
    return {
      finding,
      impact,
      tested: false,
      fixStatus: "skipped",
    };
  }

  const upgradeSuccess = simulateUpgrade(currentVer, targetVer);

  if (!upgradeSuccess) {
    return {
      finding,
      impact,
      tested: true,
      fixStatus: "failed",
    };
  }

  return {
    finding,
    impact,
    tested: true,
    fixStatus: "fixed",
  };
}

function simulateUpgrade(current: string, target: string): boolean {
  const cur = parseVersion(current);
  const tgt = parseVersion(target);

  if (!cur || !tgt) return false;
  if (tgt.major < cur.major) return false;
  if (tgt.major === cur.major && tgt.minor < cur.minor) return false;
  if (tgt.major === cur.major && tgt.minor === cur.minor && tgt.patch < cur.patch) return false;

  return true;
}

export function processScaFindings(
  findings: CmFinding[],
  policy: ScaTestPolicy,
): ScaFixResult[] {
  return findings.map((f) => processScaFinding(f, policy));
}
