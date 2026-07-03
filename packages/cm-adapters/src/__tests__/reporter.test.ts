import { describe, it, expect } from "vitest";
import { generateReport, saveReport, loadLogo } from "../reporter.js";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFParse } from "pdf-parse";

async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

// Minimal valid 2x1 PNG (IHDR width=2, height=1) for loadLogo dimension probing.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGP4z8DwH4QBEfcD/ePF9e8AAAAASUVORK5CYII=",
  "base64",
);

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

const MOCK_NEEDS_HUMAN = [
  { rule: "CVE-2023-1234", evidence: "No maintained replacement found; manual review required." },
];

describe("generateReport", () => {
  it("produces a valid pdf buffer", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString("utf-8", 0, 5)).toBe("%PDF-");
  });

  it("contains the repo name in the document", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const text = await extractText(buffer);
    expect(text).toContain("ms-test-repo");
  });

  it("contains findings status information", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const text = await extractText(buffer);
    expect(text).toContain("CRITICAL");
    expect(text).toContain("HIGH");
    expect(text).toContain("MEDIUM");
  });

  it("contains the scan summary section", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const text = await extractText(buffer);
    expect(text).toContain("Total findings");
    expect(text).toContain("Actionable");
    expect(text).toContain("Final Status");
  });

  it("contains no secret-like strings", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const text = await extractText(buffer);
    expect(text).not.toContain("api-key");
    expect(text).not.toContain("token");
    expect(text).not.toContain("secret");
  });

  it("includes fixes applied section", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const text = await extractText(buffer);
    expect(text).toContain("Upgraded lodash");
    expect(text).toContain("Parameterized query applied");
  });

  it("includes needs-human section with evidence when present", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES, needsHuman: MOCK_NEEDS_HUMAN });
    const text = await extractText(buffer);
    expect(text).toContain("Needs Human Review");
    expect(text).toContain("No maintained replacement found");
  });

  it("shows a none-found message when needs-human is empty or omitted", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const text = await extractText(buffer);
    expect(text).toContain("None — no findings required human follow-up.");
  });

  it("falls back to a text letterhead when no logos are provided", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
    const text = await extractText(buffer);
    expect(text).toContain("32bit");
  });

  it("embeds operator and customer logos when provided", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cm-report-logo-test-"));
    try {
      const logoPath = join(tmpDir, "logo.png");
      await writeFile(logoPath, TINY_PNG);
      const loaded = await loadLogo(logoPath);
      expect(loaded).toBeDefined();
      expect(loaded?.width).toBe(2);
      expect(loaded?.height).toBe(1);

      const buffer = await generateReport({
        scan: MOCK_SCAN,
        findings: MOCK_FINDINGS,
        fixes: MOCK_FIXES,
        operatorLogo: loaded,
        customerLogo: loaded,
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("loadLogo returns undefined for a missing file", async () => {
    const loaded = await loadLogo(join(tmpdir(), "does-not-exist-12345.png"));
    expect(loaded).toBeUndefined();
  });
});

describe("saveReport", () => {
  it("writes a .pdf file to disk and returns the path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cm-report-test-"));
    try {
      const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, fixes: MOCK_FIXES });
      const filePath = await saveReport(buffer, tmpDir, "ms-test-repo");

      expect(filePath).toContain("ms-test-repo-cm-");
      expect(filePath).toMatch(/\.pdf$/);

      const content = await readFile(filePath);
      expect(content.length).toBeGreaterThan(0);
      expect(content.toString("utf-8", 0, 5)).toBe("%PDF-");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
