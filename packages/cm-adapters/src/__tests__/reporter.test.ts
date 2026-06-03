import { describe, it, expect } from "vitest";
import { generateReport, saveReport } from "../reporter.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import mammoth from "mammoth";

const MOCK_SCAN = {
  id: "scan-abc-123",
  repoName: "ms-test-repo",
  status: "done",
  findingsTotal: 4,
  findingsActionable: 2,
  startedAt: "2026-06-03T12:00:00Z",
  finishedAt: "2026-06-03T14:30:00Z",
};

const MOCK_FINDINGS = [
  {
    severity: "CRITICAL",
    source: "sca",
    rule: "CVE-2024-1234",
    package: "lodash",
    currentVersion: "4.17.20",
    fixedVersion: "4.17.21",
    fixStatus: "fixed",
  },
  {
    severity: "HIGH",
    source: "sast",
    rule: "SQL Injection",
    package: null,
    currentVersion: null,
    fixedVersion: null,
    fixStatus: "fixed",
  },
  {
    severity: "MEDIUM",
    source: "sca",
    rule: "CVE-2023-1234",
    package: "minimist",
    currentVersion: "1.2.5",
    fixedVersion: "1.2.8",
    fixStatus: "skipped",
  },
];

const MOCK_FIXES = [
  { findingRule: "CVE-2024-1234", applied: true, result: "Upgraded lodash to 4.17.21" },
  { findingRule: "SQL Injection", applied: true, result: "Parameterized query applied" },
];

describe("generateReport", () => {
  it("produces a valid docx buffer", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString("utf-8", 0, 2)).toBe("PK");
  });

  it("contains the repo name in the document", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain("ms-test-repo");
  });

  it("contains findings status information", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain("CRITICAL");
    expect(result.value).toContain("HIGH");
    expect(result.value).toContain("MEDIUM");
  });

  it("contains the scan summary section", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain("Total findings");
    expect(result.value).toContain("Actionable");
    expect(result.value).toContain("Final Status");
  });

  it("contains no secret-like strings", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).not.toContain("api-key");
    expect(result.value).not.toContain("token");
    expect(result.value).not.toContain("secret");
  });

  it("includes fixes applied section", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain("Upgraded lodash");
    expect(result.value).toContain("Parameterized query applied");
  });
});

describe("saveReport", () => {
  it("writes a .docx file to disk and returns the path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cm-report-test-"));
    try {
      const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
      const filePath = await saveReport(buffer, tmpDir, "ms-test-repo");

      expect(filePath).toContain("ms-test-repo-cm-");
      expect(filePath).toMatch(/\.docx$/);

      const content = await readFile(filePath);
      expect(content.length).toBeGreaterThan(0);
      expect(content.toString("utf-8", 0, 2)).toBe("PK");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
