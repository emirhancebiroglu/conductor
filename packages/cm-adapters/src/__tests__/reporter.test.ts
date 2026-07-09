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
  // why: pdf-parse reflows table-cell text across line breaks depending on
  // column width (landscape layout wraps differently than the old portrait
  // layout did) — normalize all whitespace/newlines to single spaces so
  // toContain() checks aren't sensitive to exactly where a cell's text wraps.
  return result.text.replace(/\s+/g, " ");
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
    impactLevel: "MINOR" as const,
    test: "No need — minor/mid upgrade, no manual test required.",
    notes: "Upgraded lodash from 4.17.20 to 4.17.21",
  },
  {
    severity: "HIGH",
    source: "sast",
    rule: "SQL Injection",
    package: null,
    currentVersion: null,
    fixedVersion: null,
    fixStatus: "fixed",
    impactLevel: null,
    test: "Verify src/db/query.ts still behaves correctly after the fix (SQL Injection).",
    notes: "Applied parameterized query",
  },
  {
    severity: "MEDIUM",
    source: "sca",
    rule: "CVE-2023-1234",
    package: "minimist",
    currentVersion: "1.2.5",
    fixedVersion: "1.2.8",
    fixStatus: "skipped",
    impactLevel: "MINOR" as const,
    test: "No need — minor/mid upgrade, no manual test required.",
    notes: "MINOR upgrade skipped per sca_test_policy",
  },
];

const MOCK_NEEDS_HUMAN = [
  { rule: "CVE-2023-1234", evidence: "No maintained replacement found; manual review required." },
];

describe("generateReport", () => {
  it("produces a valid pdf buffer", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString("utf-8", 0, 5)).toBe("%PDF-");
  });

  it("contains the repo name in the document", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    const text = await extractText(buffer);
    expect(text).toContain("ms-test-repo");
  });

  it("contains findings status information", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    const text = await extractText(buffer);
    expect(text).toContain("CRITICAL");
    expect(text).toContain("HIGH");
    expect(text).toContain("MEDIUM");
  });

  it("contains per-finding test and notes columns in the single findings table", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    const text = await extractText(buffer);
    expect(text).toContain("Upgraded lodash from 4.17.20 to 4.17.21");
    expect(text).toContain("MINOR upgrade skipped per sca_test_policy");
    expect(text).toContain("No need — minor/mid upgrade, no manual test required.");
    expect(text).toContain("Verify src/db/query.ts still behaves correctly after the fix (SQL Injection).");
  });

  it("does not render the old separate Details or Fixes Applied sections", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    const text = await extractText(buffer);
    expect(text).not.toContain("Findings — Details");
    expect(text).not.toContain("Fixes Applied");
  });

  it("contains the scan summary section", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    const text = await extractText(buffer);
    expect(text).toContain("Total findings");
    expect(text).toContain("Actionable");
    expect(text).toContain("Final Status");
  });

  it("contains no secret-like strings", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    const text = await extractText(buffer);
    expect(text).not.toContain("api-key");
    expect(text).not.toContain("token");
    expect(text).not.toContain("secret");
  });

  it("includes needs-human section with evidence when present", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS, needsHuman: MOCK_NEEDS_HUMAN });
    const text = await extractText(buffer);
    expect(text).toContain("Needs Human Review");
    expect(text).toContain("No maintained replacement found");
  });

  it("shows a none-found message when needs-human is empty or omitted", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
    const text = await extractText(buffer);
    expect(text).toContain("None — no findings required human follow-up.");
  });

  it("falls back to a text letterhead when no logos are provided", async () => {
    const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
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
      const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
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

  it("creates the target directory if it doesn't exist yet (real production failure: ENOENT on a fresh reportDir)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cm-report-test-"));
    const nestedDir = join(tmpDir, "does", "not", "exist", "yet");
    try {
      const buffer = await generateReport({ scan: MOCK_SCAN, findings: MOCK_FINDINGS });
      const filePath = await saveReport(buffer, nestedDir, "ms-test-repo");

      const content = await readFile(filePath);
      expect(content.toString("utf-8", 0, 5)).toBe("%PDF-");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
