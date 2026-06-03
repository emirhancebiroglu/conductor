import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType } from "docx";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

type ReportScan = {
  id: string;
  repoName: string;
  status: string;
  findingsTotal: number;
  findingsActionable: number;
  startedAt: string | null;
  finishedAt: string | null;
};

type ReportFinding = {
  severity: string;
  source: string;
  rule: string | null;
  package: string | null;
  currentVersion: string | null;
  fixedVersion: string | null;
  fixStatus: string;
};

type ReportFix = {
  findingRule: string;
  applied: boolean;
  result: string;
};

type ReportInput = {
  scan: ReportScan;
  findings: ReportFinding[];
  fixes: ReportFix[];
};

const HEADER_FONT = { font: "Calibri", size: 24 } as const;
const SUBHEADER_FONT = { font: "Calibri", size: 20 } as const;
const BODY_FONT = { font: "Calibri", size: 18 } as const;
const MONO_FONT = { font: "Consolas", size: 16 } as const;

function severityColor(severity: string): string {
  switch (severity) {
    case "CRITICAL": return "FF0000";
    case "HIGH": return "FF6600";
    case "MEDIUM": return "CCCC00";
    case "LOW": return "666666";
    default: return "000000";
  }
}

function headerCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, ...BODY_FONT })] })],
    width: { size: 20, type: WidthType.PERCENTAGE },
  });
}

function dataCell(text: string, color?: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, ...(color ? { color } : {}), ...MONO_FONT })],
    })],
  });
}

export async function generateReport(input: ReportInput): Promise<Buffer> {
  const text = (str: string, opts?: Partial<{ bold: boolean; size: number; color: string }>) =>
    new TextRun({ text: str ?? "", ...BODY_FONT, ...opts });

  const heading = (str: string) =>
    new Paragraph({ children: [new TextRun({ text: str, bold: true, ...HEADER_FONT })], spacing: { before: 400, after: 200 } });

  const subheading = (str: string) =>
    new Paragraph({ children: [new TextRun({ text: str, bold: true, ...SUBHEADER_FONT })], spacing: { before: 300, after: 100 } });

  const body = (str: string) =>
    new Paragraph({ children: [text(str)], spacing: { after: 100 } });

  const findingsTableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: ["Severity", "Source", "Rule / Package", "Version", "Status"].map(headerCell),
    }),
    ...input.findings.map(
      (f) =>
        new TableRow({
          children: [
            dataCell(f.severity, severityColor(f.severity)),
            dataCell(f.source),
            dataCell(f.rule ?? f.package ?? ""),
            dataCell(f.source === "sca" ? `${f.currentVersion ?? ""} → ${f.fixedVersion ?? ""}` : ""),
            dataCell(f.fixStatus),
          ],
        }),
    ),
  ];

  const fixesRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: ["Finding", "Applied", "Result"].map(headerCell),
    }),
    ...input.fixes.map(
      (f) =>
        new TableRow({
          children: [
            dataCell(f.findingRule),
            dataCell(f.applied ? "Yes" : "No"),
            dataCell(f.result),
          ],
        }),
    ),
  ];

  const doc = new Document({
    title: `CM Report - ${input.scan.repoName}`,
    description: "Checkmarx Pipeline Scan Report",
    sections: [
      {
        children: [
          heading("Checkmarx Pipeline Report"),
          body(`Repo: ${input.scan.repoName}`),
          body(`Scan ID: ${input.scan.id}`),
          body(`Status: ${input.scan.status}`),
          body(`Total findings: ${input.scan.findingsTotal}`),
          body(`Actionable (CRIT/HIGH): ${input.scan.findingsActionable}`),
          body(`Started: ${input.scan.startedAt ?? "N/A"}`),
          body(`Finished: ${input.scan.finishedAt ?? "N/A"}`),

          subheading("Findings"),
          new Table({
            rows: findingsTableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),

          subheading("Fixes Applied"),
          input.fixes.length > 0
            ? new Table({
                rows: fixesRows,
                width: { size: 100, type: WidthType.PERCENTAGE },
              })
            : body("No fixes were applied."),

          subheading("Final Status"),
          body(input.scan.status === "done" ? "All issues resolved." : `Pipeline ended with status: ${input.scan.status}`),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export async function saveReport(buffer: Buffer, dir: string, repoName: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${repoName}-cm-${timestamp}.docx`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, buffer);
  return filePath;
}
