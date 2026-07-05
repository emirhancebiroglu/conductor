import pdfMake from "pdfmake";
import type { Content, TableCell as PdfTableCell } from "pdfmake";

type TDocumentDefinitions = Parameters<typeof pdfMake.createPdf>[0];
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

pdfMake.setFonts({
  Roboto: {
    normal: join(__dirname, "..", "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Regular.ttf"),
    bold: join(__dirname, "..", "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Medium.ttf"),
    italics: join(__dirname, "..", "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Italic.ttf"),
    bolditalics: join(__dirname, "..", "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-MediumItalic.ttf"),
  },
});
pdfMake.setUrlAccessPolicy(() => false);
pdfMake.setLocalAccessPolicy((path) => path.includes("Roboto"));

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
  skipReason: string | null;
  whatWasDone: string | null;
  impactLevel: "MAJOR" | "MID" | "MINOR" | null;
  analystTestNote: string;
};

type ReportFix = {
  findingRule: string;
  applied: boolean;
  result: string;
};

type ReportNeedsHuman = {
  rule: string;
  evidence: string;
};

type ReportLogo = {
  buffer: Buffer;
  width: number;
  height: number;
};

type ReportInput = {
  scan: ReportScan;
  findings: ReportFinding[];
  fixes: ReportFix[];
  needsHuman?: ReportNeedsHuman[] | undefined;
  operatorLogo?: ReportLogo | undefined;
  customerLogo?: ReportLogo | undefined;
};

// ---------------------------------------------------------------------------
// Theme — single place to tune the report's look. 32bit brand: dark/crimson
// accent, severity colors stay standard (not brand-overridden) so the table
// remains scannable at a glance.
// ---------------------------------------------------------------------------

const REPORT_THEME = {
  crimson: "#C23B3B",
  crimsonDark: "#8C2A2A",
  ink: "#1A1A1A",
  muted: "#5C5C5C",
  paper: "#FFFFFF",
} as const;

function severityColor(severity: string): string {
  switch (severity) {
    case "CRITICAL": return "#CC0000";
    case "HIGH": return "#E07B00";
    case "MEDIUM": return "#B8A300";
    case "LOW": return "#707070";
    default: return REPORT_THEME.ink;
  }
}

function logoDataUrl(logo: ReportLogo): string {
  return `data:image/png;base64,${logo.buffer.toString("base64")}`;
}

function headerCell(text: string): PdfTableCell {
  return { text, bold: true, color: REPORT_THEME.paper, fillColor: REPORT_THEME.crimsonDark, fontSize: 9 };
}

function dataCell(text: string, color?: string): PdfTableCell {
  return { text, fontSize: 9, ...(color ? { color } : {}) };
}

function buildLetterhead(operatorLogo?: ReportLogo, customerLogo?: ReportLogo): Content {
  const maxWidth = 120;
  const maxHeight = 45;

  const left: Content = operatorLogo
    ? { image: logoDataUrl(operatorLogo), fit: [maxWidth, maxHeight] }
    : { text: "32bit", bold: true, color: REPORT_THEME.crimson, fontSize: 16 };

  const right: Content = customerLogo
    ? { image: logoDataUrl(customerLogo), fit: [maxWidth, maxHeight], alignment: "right" }
    : { text: "" };

  return {
    margin: [40, 20, 40, 0],
    stack: [
      {
        columns: [
          { width: "50%", stack: [left] },
          { width: "50%", stack: [right] },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 2, lineColor: REPORT_THEME.crimson }] },
    ],
  };
}

function buildFooter(currentPage: number, pageCount: number): Content {
  return {
    margin: [40, 10, 40, 0],
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#CCCCCC" }] },
      {
        margin: [0, 4, 0, 0],
        columns: [
          { text: "32bit Bilgisayar Hizmetleri — Security Scan Report", color: REPORT_THEME.muted, fontSize: 8 },
          { text: `Page ${currentPage} of ${pageCount}`, color: REPORT_THEME.muted, fontSize: 8, alignment: "right" },
        ],
      },
    ],
  };
}

export async function generateReport(input: ReportInput): Promise<Buffer> {
  const heading = (str: string): Content => ({
    text: str,
    bold: true,
    color: REPORT_THEME.crimsonDark,
    fontSize: 14,
    margin: [0, 16, 0, 8],
  });

  const subheading = (str: string): Content => ({
    text: str,
    bold: true,
    color: REPORT_THEME.ink,
    fontSize: 11,
    margin: [0, 10, 0, 4],
  });

  const body = (str: string): Content => ({ text: str, fontSize: 9, margin: [0, 0, 0, 4] });

  const findingsTable: Content = {
    table: {
      headerRows: 1,
      widths: ["10%", "8%", "27%", "20%", "10%", "25%"],
      body: [
        ["Severity", "Source", "Rule / Package", "Version", "Status", "Impact"].map(headerCell),
        ...input.findings.map((f) => [
          dataCell(f.severity, severityColor(f.severity)),
          dataCell(f.source),
          dataCell(f.rule ?? f.package ?? ""),
          dataCell(f.source === "sca" ? `${f.currentVersion ?? ""} -> ${f.fixedVersion ?? ""}` : ""),
          dataCell(f.fixStatus),
          dataCell(f.impactLevel ?? (f.source === "sast" ? "n/a" : "")),
        ]),
      ],
    },
    layout: { hLineColor: () => "#DDDDDD", vLineColor: () => "#DDDDDD" },
  };

  const findingsDetail: Content = {
    stack: input.findings.map((f): Content => {
      const label = f.rule ?? f.package ?? "unknown";
      const lines: string[] = [];
      if (f.fixStatus === "fixed" && f.whatWasDone) {
        lines.push(`What was done: ${f.whatWasDone}`);
      }
      if ((f.fixStatus === "skipped" || f.fixStatus === "failed" || f.fixStatus === "needs_human") && f.skipReason) {
        lines.push(`Reason: ${f.skipReason}`);
      }
      lines.push(`Analyst test note: ${f.analystTestNote}`);

      return {
        margin: [0, 0, 0, 8],
        stack: [
          { text: `${label} (${f.severity}, ${f.source.toUpperCase()}) — ${f.fixStatus}`, bold: true, fontSize: 9, color: REPORT_THEME.ink },
          ...lines.map((line) => ({ text: line, fontSize: 8, color: REPORT_THEME.muted, margin: [8, 1, 0, 0] as [number, number, number, number] })),
        ],
      };
    }),
  };

  const fixesTable: Content =
    input.fixes.length > 0
      ? {
          table: {
            headerRows: 1,
            widths: ["35%", "15%", "50%"],
            body: [
              ["Finding", "Applied", "Result"].map(headerCell),
              ...input.fixes.map((f) => [
                dataCell(f.findingRule),
                dataCell(f.applied ? "Yes" : "No"),
                dataCell(f.result),
              ]),
            ],
          },
          layout: { hLineColor: () => "#DDDDDD", vLineColor: () => "#DDDDDD" },
        }
      : body("No fixes were applied.");

  const needsHuman = input.needsHuman ?? [];
  const needsHumanTable: Content =
    needsHuman.length > 0
      ? {
          table: {
            headerRows: 1,
            widths: ["30%", "70%"],
            body: [
              ["Finding", "Evidence / Reason"].map(headerCell),
              ...needsHuman.map((n) => [dataCell(n.rule), dataCell(n.evidence)]),
            ],
          },
          layout: { hLineColor: () => "#DDDDDD", vLineColor: () => "#DDDDDD" },
        }
      : body("None — no findings required human follow-up.");

  const docDefinition: TDocumentDefinitions = {
    info: { title: `CM Report - ${input.scan.repoName}`, subject: "32bit Checkmarx Pipeline Scan Report" },
    pageSize: "A4",
    pageMargins: [40, 90, 40, 60],
    header: buildLetterhead(input.operatorLogo, input.customerLogo),
    footer: buildFooter,
    defaultStyle: { font: "Roboto" },
    content: [
      heading("Security Scan Report"),
      body(`Repo: ${input.scan.repoName}`),
      body(`Scan ID: ${input.scan.id}`),
      body(`Status: ${input.scan.status}`),
      body(`Total findings: ${input.scan.findingsTotal}`),
      body(`Actionable (CRIT/HIGH): ${input.scan.findingsActionable}`),
      body(`Started: ${input.scan.startedAt ?? "N/A"}`),
      body(`Finished: ${input.scan.finishedAt ?? "N/A"}`),

      subheading("Findings"),
      findingsTable,

      subheading("Findings — Details"),
      findingsDetail,

      subheading("Fixes Applied"),
      fixesTable,

      subheading("Needs Human Review"),
      needsHumanTable,

      subheading("Final Status"),
      body(input.scan.status === "done" || input.scan.status === "verified" ? "All issues resolved." : `Pipeline ended with status: ${input.scan.status}`),
    ],
  };

  return await pdfMake.createPdf(docDefinition).getBuffer();
}

export async function saveReport(buffer: Buffer, dir: string, repoName: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${repoName}-cm-${timestamp}.pdf`;
  const filePath = join(dir, fileName);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, buffer);
  return filePath;
}

/**
 * Loads a logo PNG from disk and probes its pixel dimensions from the IHDR
 * chunk (bytes 16-23) so generateReport can scale it without a full image
 * decode. Returns undefined if the file doesn't exist — callers should treat
 * missing logos as optional (report falls back to text letterhead).
 */
export async function loadLogo(filePath: string): Promise<ReportLogo | undefined> {
  try {
    const buffer = await readFile(filePath);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { buffer, width, height };
  } catch {
    return undefined;
  }
}
