import { describe, it, expect, vi } from "vitest";
import { handleRescan } from "../handlers/rescan.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function createMockScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scan-001",
    repo_id: "repo-001",
    workspace_id: "ws-001",
    status: "fixed",
    ...overrides,
  };
}

function mockSupabase(
  scanRow: Record<string, unknown>,
  fixAttempts: number[],
  updates?: Record<string, unknown>[],
) {
  const capturedUpdates: Record<string, unknown>[] = updates ?? [];

  return {
    from: vi.fn((table: string) => {
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
      if (table === "cm_repo") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { owner: "test-owner", name: "ms-test-repo", default_branch: "uat" },
            error: null,
          }),
        };
      }
      if (table === "cm_pipeline") {
        return {
          select: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { max_fix_attempts: 2 }, error: null }),
        };
      }
      if (table === "cm_finding") {
        const result = Promise.resolve({
          data: fixAttempts.map((n) => ({ fix_attempts: n })),
          error: null,
        });
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => result),
          })),
          eq: vi.fn(() => result),
        };
      }
      return {};
    }),
  } as unknown as SupabaseClient;
}

describe("handleRescan", () => {
  it("marks verified when rescan returns clean", async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = mockSupabase(createMockScanRow(), [1], updates);

    const scanProvider = {
      scan: vi.fn().mockResolvedValue({ externalScanId: "rescan-001" }),
      fetchResults: vi.fn().mockResolvedValue([]),
    };

    await handleRescan(supabase, scanProvider, "scan-001");

    const verifiedUpdate = updates.find((u) => u.status === "verified");
    expect(verifiedUpdate).toBeDefined();
    expect(verifiedUpdate?.current_step).toContain("All findings resolved");
  });

  it("sends back to fix when findings remain and attempts not exhausted", async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = mockSupabase(createMockScanRow(), [1], updates);

    const scanProvider = {
      scan: vi.fn().mockResolvedValue({ externalScanId: "rescan-001" }),
      fetchResults: vi.fn().mockResolvedValue([
        { severity: "CRITICAL", source: "sca", rule: "CVE-1", fingerprint: "fp1" },
      ]),
    };

    await handleRescan(supabase, scanProvider, "scan-001");

    const fixedUpdate = updates.find((u) => u.status === "fixed");
    expect(fixedUpdate).toBeDefined();
    expect(fixedUpdate?.current_step).toContain("re-fixing");
  });

  it("marks needs_human when fix attempts exhausted", async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = mockSupabase(
      createMockScanRow(),
      [2],
      updates,
    );

    const scanProvider = {
      scan: vi.fn().mockResolvedValue({ externalScanId: "rescan-001" }),
      fetchResults: vi.fn().mockResolvedValue([
        { severity: "CRITICAL", source: "sca", rule: "CVE-1", fingerprint: "fp1" },
      ]),
    };

    await handleRescan(supabase, scanProvider, "scan-001");

    const needsHumanUpdate = updates.find((u) => u.status === "needs_human");
    expect(needsHumanUpdate).toBeDefined();
    expect(needsHumanUpdate?.current_step).toContain("needs human review");
  });

  it("skips when scan cannot transition to rescanning", async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = mockSupabase(
      createMockScanRow({ status: "verified" }),
      [1],
      updates,
    );

    const scanProvider = {
      scan: vi.fn(),
      fetchResults: vi.fn(),
    };

    await handleRescan(supabase, scanProvider, "scan-001");

    expect(scanProvider.scan).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("marks scan_failed when provider throws", async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = mockSupabase(createMockScanRow(), [1], updates);

    const scanProvider = {
      scan: vi.fn().mockRejectedValue(new Error("Rescan connection failed")),
      fetchResults: vi.fn(),
    };

    await expect(
      handleRescan(supabase, scanProvider as never, "scan-001"),
    ).rejects.toThrow("Rescan connection failed");

    const failedUpdate = updates.find((u) => u.status === "scan_failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.error).toBe("Rescan connection failed");
  });
});
