import { describe, it, expect, vi } from "vitest";
import { handleScan } from "../handlers/scan.js";
import { MockScanProvider } from "@conductor/cm-adapters";

function createMockScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scan-001",
    repo_id: "repo-001",
    workspace_id: "ws-001",
    status: "queued",
    provider: "checkmarx",
    external_scan_id: null,
    branch_scanned: "main",
    trigger: "manual",
    findings_total: 0,
    findings_actionable: 0,
    error: null,
    current_step: null,
    pr_url: null,
    report_path: null,
    started_at: null,
    finished_at: null,
    created_at: "2026-06-03T12:00:00Z",
    updated_at: "2026-06-03T12:00:00Z",
    ...overrides,
  };
}

describe("handleScan", () => {
  it("loads scan, transitions to scanning, and calls scanProvider", async () => {
    const scanRow = createMockScanRow();

    const capturedUpdates: Record<string, unknown>[] = [];

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_scan") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: scanRow, error: null }),
          update: vi.fn((payload: Record<string, unknown>) => {
            capturedUpdates.push(payload);
            return { eq: vi.fn().mockReturnThis() };
          }),
        };
      }
      if (table === "cm_finding") {
        return { upsert: vi.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });

    const supabase = { from: mockFrom };
    const scanProvider = new MockScanProvider();
    const scanSpy = vi.spyOn(scanProvider, "scan");

    await handleScan(supabase as never, scanProvider, { scanId: "scan-001" });

    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(capturedUpdates.length).toBeGreaterThanOrEqual(2);
    expect(capturedUpdates[0]?.status).toBe("scanning");
  });

  it("skips processing if scan is already past queued state (idempotency)", async () => {
    const scanRow = createMockScanRow({ status: "scanning" });

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_scan") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: scanRow, error: null }),
          update: vi.fn().mockReturnThis(),
        };
      }
      if (table === "cm_finding") {
        return { upsert: vi.fn() };
      }
      return {};
    });

    const supabase = { from: mockFrom };
    const scanProvider = new MockScanProvider();
    const scanSpy = vi.spyOn(scanProvider, "scan");

    await handleScan(supabase as never, scanProvider, { scanId: "scan-001" });

    expect(scanSpy).not.toHaveBeenCalled();
  });

  it("sets scan_failed status when scanProvider throws", async () => {
    const scanRow = createMockScanRow();

    let finalUpdate: Record<string, unknown> = {};

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_scan") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: scanRow, error: null }),
          update: vi.fn((payload: Record<string, unknown>) => {
            finalUpdate = payload;
            return { eq: vi.fn().mockReturnThis() };
          }),
        };
      }
      if (table === "cm_finding") {
        return { upsert: vi.fn() };
      }
      return {};
    });

    const supabase = { from: mockFrom };
    const failingProvider = {
      scan: vi.fn().mockRejectedValue(new Error("Checkmarx connection refused")),
      fetchResults: vi.fn(),
    };

    await expect(
      handleScan(supabase as never, failingProvider, { scanId: "scan-001" }),
    ).rejects.toThrow("Checkmarx connection refused");

    expect(finalUpdate.status).toBe("scan_failed");
    expect(finalUpdate.error).toBe("Checkmarx connection refused");
  });

  it("marks scan_done with correct finding counts", async () => {
    const scanRow = createMockScanRow();

    let finalUpdate: Record<string, unknown> = {};

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_scan") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: scanRow, error: null }),
          update: vi.fn((payload: Record<string, unknown>) => {
            finalUpdate = payload;
            return { eq: vi.fn().mockReturnThis() };
          }),
        };
      }
      if (table === "cm_finding") {
        return { upsert: vi.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });

    const supabase = { from: mockFrom };
    const scanProvider = new MockScanProvider();

    await handleScan(supabase as never, scanProvider, { scanId: "scan-001" });

    expect(finalUpdate.status).toBe("scan_done");
    expect(finalUpdate.findings_total).toBe(4);
    expect(finalUpdate.findings_actionable).toBe(4);
  });

  it("is idempotent: running twice for same scanId produces identical state", async () => {
    let loadCount = 0;
    const upsertCalls: unknown[][] = [];

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_scan") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockImplementation(() => {
            loadCount++;
            const row = loadCount === 1
              ? createMockScanRow()
              : createMockScanRow({ status: "scan_done" });
            return Promise.resolve({ data: row, error: null });
          }),
          update: vi.fn().mockReturnThis(),
        };
      }
      if (table === "cm_finding") {
        return {
          upsert: vi.fn((...args: unknown[]) => {
            upsertCalls.push(args);
            return { error: null };
          }),
        };
      }
      return {};
    });

    const supabase = { from: mockFrom };
    const scanProvider = new MockScanProvider();

    await handleScan(supabase as never, scanProvider, { scanId: "scan-001" });
    const firstUpsertCount = upsertCalls.length;

    await handleScan(supabase as never, scanProvider, { scanId: "scan-001" });
    expect(upsertCalls.length).toBe(firstUpsertCount);
  });
});
