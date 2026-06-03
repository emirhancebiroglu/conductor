import { describe, it, expect, vi } from "vitest";
import { createScanWorkHandler, setupScanQueue, QUEUE_SCAN, QUEUE_SCAN_DEAD_LETTER, DEFAULT_RETRY_LIMIT, DEFAULT_RETRY_DELAY_SECONDS } from "../handlers/retry.js";
import { CheckmarxScanError } from "@conductor/cm-adapters";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider } from "@conductor/cm-adapters";

const validRow = {
  id: "scan-001",
  repo_id: "repo-1",
  workspace_id: "ws-1",
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
  created_at: "",
  updated_at: "",
};

function mockSupabase(): SupabaseClient {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: validRow, error: null }),
      update: vi.fn().mockReturnThis(),
    })),
  } as unknown as SupabaseClient;
}

describe("createScanWorkHandler", () => {
  it("retries on system_fail errors", async () => {
    const failingProvider: ScanProvider = {
      scan: vi.fn().mockRejectedValue(
        new CheckmarxScanError("Connection refused", "system_fail"),
      ),
      fetchResults: vi.fn(),
    };

    const supabase = mockSupabase();
    const handler = createScanWorkHandler(supabase, failingProvider);

    await expect(handler([{ data: { scanId: "scan-001" } }])).rejects.toThrow("Connection refused");
  });

  it("does NOT retry on scan_failed errors", async () => {
    const failingProvider: ScanProvider = {
      scan: vi.fn().mockRejectedValue(
        new CheckmarxScanError("Scan aborted by Checkmarx", "scan_failed", 1),
      ),
      fetchResults: vi.fn(),
    };

    const supabase = mockSupabase();
    const handler = createScanWorkHandler(supabase, failingProvider);

    await expect(handler([{ data: { scanId: "scan-001" } }])).resolves.toBeUndefined();
  });

  it("retries on scan load failures", async () => {
    const scanProvider: ScanProvider = {
      scan: vi.fn(),
      fetchResults: vi.fn(),
    };

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "connection error" } }),
      })),
    } as unknown as SupabaseClient;

    const handler = createScanWorkHandler(supabase, scanProvider);

    await expect(handler([{ data: { scanId: "scan-001" } }])).rejects.toThrow("Failed to load cm_scan");
  });
});

describe("setupScanQueue", () => {
  it("creates a queue with retry and dead letter config", async () => {
    const mockCreateQueue = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue: mockCreateQueue };

    await setupScanQueue(boss as never, { retryLimit: 3, retryDelaySeconds: 1800 });

    expect(mockCreateQueue).toHaveBeenCalledWith(QUEUE_SCAN, {
      retryLimit: 3,
      retryDelay: 1800,
      retryBackoff: true,
      deadLetter: QUEUE_SCAN_DEAD_LETTER,
    });
  });

  it("uses default values", () => {
    expect(DEFAULT_RETRY_LIMIT).toBe(3);
    expect(DEFAULT_RETRY_DELAY_SECONDS).toBe(1800);
  });
});
