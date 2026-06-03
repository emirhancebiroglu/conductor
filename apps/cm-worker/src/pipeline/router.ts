import type { CmFinding } from "@conductor/cm-core";

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export type FilteredFindings = {
  actionable: CmFinding[];
  sca: CmFinding[];
  sast: CmFinding[];
  skipped: CmFinding[];
};

export function filterAndRouteFindings(
  findings: CmFinding[],
  threshold: string[],
): FilteredFindings {
  const actionable: CmFinding[] = [];
  const sca: CmFinding[] = [];
  const sast: CmFinding[] = [];
  const skipped: CmFinding[] = [];

  const minSeverity = Math.min(
    ...threshold.map((s) => SEVERITY_ORDER[s] ?? 0),
  );

  for (const finding of findings) {
    const severityLevel = SEVERITY_ORDER[finding.severity] ?? 0;

    if (severityLevel < minSeverity) {
      skipped.push({ ...finding, fixStatus: "skipped" });
      continue;
    }

    actionable.push(finding);

    if (finding.source === "sca") {
      sca.push(finding);
    } else if (finding.source === "sast") {
      sast.push(finding);
    }
  }

  return { actionable, sca, sast, skipped };
}
