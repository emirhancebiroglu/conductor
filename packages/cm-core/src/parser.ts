import { fingerprint } from "./fingerprint.js";
import type { CmFinding } from "./types.js";

// Real cx json-v2 shape (results show --report-format json)
type CxNode = {
  fileName?: string;
  line?: number;
  column?: number;
  name?: string;
  fullName?: string;
};
type CxResult = {
  type: string;
  id?: string;           // CVE ID for SCA (top-level)
  severity: string;
  description?: string;
  status?: string;
  state?: string;
  data?: {
    // SAST
    queryName?: string;
    languageName?: string;
    nodes?: CxNode[];
    // SCA
    packageIdentifier?: string;    // "Maven-groupId:artifactId-VERSION" or "Npm-name-VERSION"
    packageName?: string;
    packageVersion?: string;
    recommendedVersion?: string;
    fixedVersion?: string;
    cveId?: string;
    cveName?: string;
    scaPackageData?: {
      locations?: string[];
      isDirectDependency?: boolean;
      typeOfDependency?: string;
    };
  };
  vulnerabilityDetails?: {
    cveName?: string;
    cvssScore?: number;
    cweId?: string | number;
  };
};

type CxReport = {
  results?: CxResult[];
};

// Extract version from cx package identifier string
// "Maven-org.springframework.boot:spring-boot-autoconfigure-3.5.12" → "3.5.12"
// "Npm-sha.js-2.4.11" → "2.4.11"
function extractVersionFromIdentifier(identifier: string): string | null {
  // Try last segment after final hyphen that looks like a version (semver-ish)
  const match = /-(\d+\.\d+[\w.-]*)$/.exec(identifier);
  return match ? (match[1] ?? null) : null;
}

// Extract clean package name from identifier (strip ecosystem prefix and version)
// "Maven-org.springframework.boot:spring-boot-autoconfigure-3.5.12" → "org.springframework.boot:spring-boot-autoconfigure"
// "Npm-sha.js-2.4.11" → "sha.js"
function extractPackageName(identifier: string): string {
  // Remove ecosystem prefix (Maven-, Npm-, Pip-, etc.)
  const withoutPrefix = identifier.replace(/^[A-Za-z]+-/, "");
  // Remove trailing version
  const version = extractVersionFromIdentifier(identifier);
  if (version) {
    return withoutPrefix.slice(0, -(version.length + 1)); // remove "-VERSION"
  }
  return withoutPrefix;
}

const SEVERITY_MAP: Record<string, "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"> = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INFO: "LOW",
};

function mapSeverity(raw: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  return SEVERITY_MAP[raw.toUpperCase()] ?? "LOW";
}

export function parseCheckmarxResults(json: unknown): CmFinding[] {
  const report = json as CxReport;
  const results = report?.results ?? [];
  const findings: CmFinding[] = [];

  for (const r of results) {
    const type = (r.type ?? "").toLowerCase();
    const severity = mapSeverity(r.severity ?? "LOW");

    if (type === "sast") {
      const queryName = r.data?.queryName ?? "Unknown";
      const nodes = r.data?.nodes ?? [];
      const firstNode = nodes[0];
      const file = firstNode?.fileName ?? null;
      const line = firstNode?.line ?? null;

      const taintFlow = nodes.length > 0
        ? nodes.map((n) => ({
            fileName: n.fileName ?? "",
            line: n.line ?? 0,
            column: n.column,
            name: n.name,
            fullName: n.fullName,
          }))
        : null;

      const fp = fingerprint({
        source: "sast",
        rule: queryName,
        file: file ?? "",
        lineContent: null,
      });

      findings.push({
        id: "",
        scanId: "",
        workspaceId: "",
        source: "sast",
        severity,
        rule: queryName,
        package: null,
        currentVersion: null,
        fixedVersion: null,
        upgradeImpact: null,
        file,
        line,
        fingerprint: fp,
        fixStatus: "open",
        fixAttempts: 0,
        fixNotes: null,
        description: r.description ?? null,
        taintFlow,
        createdAt: "",
        updatedAt: "",
      });
    } else if (type === "sca") {
      const identifier = r.data?.packageIdentifier ?? r.data?.packageName ?? "unknown";
      const pkgName = extractPackageName(identifier);
      const currentVersion = r.data?.packageVersion ?? extractVersionFromIdentifier(identifier);
      const fixedVersion = r.data?.recommendedVersion ?? r.data?.fixedVersion ?? null;
      // CVE ID: top-level r.id, fallback to vulnerabilityDetails, fallback to data fields
      const rule = r.id ?? r.vulnerabilityDetails?.cveName ?? r.data?.cveId ?? r.data?.cveName ?? "SCA";
      const scaFile = r.data?.scaPackageData?.locations?.[0] ?? null;

      const fp = fingerprint({
        source: "sca",
        package: pkgName,
        rule,
      });

      findings.push({
        id: "",
        scanId: "",
        workspaceId: "",
        source: "sca",
        severity,
        rule,
        package: pkgName,
        currentVersion,
        fixedVersion,
        upgradeImpact: null,
        file: scaFile,
        line: null,
        fingerprint: fp,
        fixStatus: "open",
        fixAttempts: 0,
        fixNotes: null,
        description: r.description ?? null,
        taintFlow: null,
        createdAt: "",
        updatedAt: "",
      });
    }
  }

  return findings;
}
