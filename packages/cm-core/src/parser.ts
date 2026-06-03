import { fingerprint } from "./fingerprint.js";
import type { CmFinding } from "./types.js";

type CheckmarxScaFinding = {
  packageName: string;
  packageVersion: string;
  fixedVersion: string;
  severity: string;
  cveId: string;
  cveDescription?: string;
  recommendedVersion?: string;
  type: string;
};

type CheckmarxSastFinding = {
  queryName: string;
  severity: string;
  fileName: string;
  line: number;
  codeSnippet?: string;
  language?: string;
  type: string;
};

type CheckmarxReport = {
  results: {
    sca?: { findings: CheckmarxScaFinding[] };
    sast?: { findings: CheckmarxSastFinding[] };
  };
};

const SEVERITY_MAP: Record<string, "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"> = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

function mapSeverity(raw: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  return SEVERITY_MAP[raw.toUpperCase()] ?? "LOW";
}

export function parseCheckmarxResults(json: unknown): CmFinding[] {
  const report = json as CheckmarxReport;
  const findings: CmFinding[] = [];

  const scaFindings = report?.results?.sca?.findings ?? [];
  for (const f of scaFindings) {
    const fp = fingerprint({
      source: "sca",
      package: f.packageName,
      rule: f.cveId,
    });

    findings.push({
      id: "",
      scanId: "",
      workspaceId: "",
      source: "sca",
      severity: mapSeverity(f.severity),
      rule: f.cveId,
      package: f.packageName,
      currentVersion: f.packageVersion,
      fixedVersion: f.fixedVersion,
      upgradeImpact: null,
      file: null,
      line: null,
      fingerprint: fp,
      fixStatus: "open",
      fixAttempts: 0,
      fixNotes: null,
      createdAt: "",
      updatedAt: "",
    });
  }

  const sastFindings = report?.results?.sast?.findings ?? [];
  for (const f of sastFindings) {
    const fp = fingerprint({
      source: "sast",
      rule: f.queryName,
      file: f.fileName,
      lineContent: f.codeSnippet ?? null,
    });

    findings.push({
      id: "",
      scanId: "",
      workspaceId: "",
      source: "sast",
      severity: mapSeverity(f.severity),
      rule: f.queryName,
      package: null,
      currentVersion: null,
      fixedVersion: null,
      upgradeImpact: null,
      file: f.fileName,
      line: f.line,
      fingerprint: fp,
      fixStatus: "open",
      fixAttempts: 0,
      fixNotes: null,
      createdAt: "",
      updatedAt: "",
    });
  }

  return findings;
}
