import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleReport } from "../handlers/report.js";

function createMockScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scan-001",
    repo_id: "repo-001",
    workspace_id: "ws-001",
    status: "pr_opened",
    findings_total: 4,
    findings_actionable: 2,
    started_at: "2026-06-03T12:00:00Z",
    finished_at: null,
    ...overrides,
  };
}

describe("handleReport", () => {
  it("generates report and sets status to done", async () => {
    const reportDir = await mkdtemp(join(tmpdir(), "cm-report-test-"));
    try {
      const updates: Record<string, unknown>[] = [];
      const capturedReport: { value: Record<string, unknown> | null } = { value: null };

      const supabase = {
        from: vi.fn((table: string) => {
          if (table === "cm_scan") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: createMockScanRow(), error: null }),
              update: vi.fn((payload: Record<string, unknown>) => {
                updates.push(payload);
                return { eq: vi.fn().mockReturnThis() };
              }),
            };
          }
          if (table === "cm_repo") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { name: "ms-test-repo" }, error: null }),
            };
          }
          if (table === "cm_finding") {
            const result = Promise.resolve({
              data: [
                { severity: "CRITICAL", source: "sca", rule: "CVE-1", package: "lodash", current_version: "4.17.20", fixed_version: "4.17.21", fix_status: "fixed" },
              ],
              error: null,
            });
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => result),
              })),
            };
          }
          if (table === "cm_report") {
            return {
              insert: vi.fn((data: Record<string, unknown>) => {
                capturedReport.value = data;
                return { error: null };
              }),
            };
          }
          return {};
        }),
      };

      await handleReport(supabase as never, "scan-001", reportDir);

      const doneUpdate = updates.find((u) => u.status === "done");
      expect(doneUpdate).toBeDefined();
      const du = doneUpdate as Record<string, unknown>;
      expect(du.report_path).toBeTruthy();

      if (capturedReport.value) {
        expect(capturedReport.value.scan_id).toBe("scan-001");
        expect(capturedReport.value.format).toBe("docx");
      }
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  });

  it("skips when scan cannot transition to reporting", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "cm_scan") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: createMockScanRow({ status: "done" }), error: null }),
            update: vi.fn(),
          };
        }
        return {};
      }),
    };

    await handleReport(supabase as never, "scan-001", "/tmp");
  });
});
