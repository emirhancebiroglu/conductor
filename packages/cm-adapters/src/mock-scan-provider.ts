import type { ScanProvider, ScanResult } from "./scan-provider.js";
import type { CmFinding } from "@conductor/cm-core";

const MOCK_SCA_FINDINGS: CmFinding[] = [
  {
    id: "",
    scanId: "",
    workspaceId: "",
    source: "sca",
    severity: "CRITICAL",
    rule: "CVE-2024-1234",
    package: "lodash",
    currentVersion: "4.17.20",
    fixedVersion: "4.17.21",
    upgradeImpact: null,
    file: null,
    line: null,
    fingerprint: "mock-fp-sca-lodash",
    fixStatus: "open",
    fixAttempts: 0,
    fixNotes: null,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "",
    scanId: "",
    workspaceId: "",
    source: "sca",
    severity: "HIGH",
    rule: "CVE-2024-5678",
    package: "axios",
    currentVersion: "0.27.2",
    fixedVersion: "1.6.0",
    upgradeImpact: null,
    file: null,
    line: null,
    fingerprint: "mock-fp-sca-axios",
    fixStatus: "open",
    fixAttempts: 0,
    fixNotes: null,
    createdAt: "",
    updatedAt: "",
  },
];

const MOCK_SAST_FINDINGS: CmFinding[] = [
  {
    id: "",
    scanId: "",
    workspaceId: "",
    source: "sast",
    severity: "CRITICAL",
    rule: "Stored XSS",
    package: null,
    currentVersion: null,
    fixedVersion: null,
    upgradeImpact: null,
    file: "src/components/Profile.tsx",
    line: 128,
    fingerprint: "mock-fp-sast-xss",
    fixStatus: "open",
    fixAttempts: 0,
    fixNotes: null,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "",
    scanId: "",
    workspaceId: "",
    source: "sast",
    severity: "HIGH",
    rule: "SQL Injection",
    package: null,
    currentVersion: null,
    fixedVersion: null,
    upgradeImpact: null,
    file: "src/users.ts",
    line: 42,
    fingerprint: "mock-fp-sast-sqli",
    fixStatus: "open",
    fixAttempts: 0,
    fixNotes: null,
    createdAt: "",
    updatedAt: "",
  },
];

export class MockScanProvider implements ScanProvider {
  private fetchCount = 0;

  scan(
    _repo: { owner: string; name: string },
    _branch: string,
  ): Promise<ScanResult> {
    return Promise.resolve({ externalScanId: `mock-scan-${_repo.owner}/${_repo.name}-${Date.now()}` });
  }

  fetchResults(_externalScanId: string): Promise<CmFinding[]> {
    this.fetchCount++;
    if (this.fetchCount >= 2) {
      return Promise.resolve([]);
    }
    return Promise.resolve([...MOCK_SCA_FINDINGS, ...MOCK_SAST_FINDINGS]);
  }

  reset(): void {
    this.fetchCount = 0;
  }
}
