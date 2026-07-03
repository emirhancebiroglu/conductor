import { describe, it, expect, vi } from "vitest";
import { handleFix } from "../handlers/fix.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider, AgentRunner } from "@conductor/cm-adapters";

function createMockScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scan-001",
    repo_id: "repo-001",
    workspace_id: "ws-001",
    status: "scan_done",
    findings_actionable: 2,
    current_step: null,
    ...overrides,
  };
}

function createMockRepoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-001",
    owner: "test-owner",
    name: "ms-test-repo",
    default_branch: "main",
    pipeline_id: "pipeline-001",
    ...overrides,
  };
}

function mockScanSupabase(
  scanRow: Record<string, unknown>,
  repoRow: Record<string, unknown> | null,
  updatePayloads?: Record<string, unknown>[],
) {
  const updates: Record<string, unknown>[] = updatePayloads ?? [];
  return {
    from: vi.fn((table: string) => {
      if (table === "cm_scan") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: scanRow, error: null }),
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
          single: vi.fn().mockResolvedValue({ data: repoRow, error: null }),
        };
      }
      return {};
    }),
  } as unknown as SupabaseClient;
}

function makeProviders() {
  const scan = vi.fn();
  const scanProvider = { scan, fetchResults: vi.fn() } as unknown as ScanProvider;
  const agentRunner = { run: vi.fn() } as unknown as AgentRunner;
  return { scanProvider, agentRunner, scan };
}

describe("handleFix", () => {
  it("skips when scan cannot transition to fixing", async () => {
    const scanRow = createMockScanRow({ status: "scanning" });
    const supabase = mockScanSupabase(scanRow, createMockRepoRow());
    const { scanProvider, agentRunner, scan } = makeProviders();

    await handleFix(supabase, scanProvider, agentRunner, "scan-001");

    expect(scan).not.toHaveBeenCalled();
  });

  it("skips when no actionable findings", async () => {
    const scanRow = createMockScanRow({ findings_actionable: 0 });
    const supabase = mockScanSupabase(scanRow, createMockRepoRow());
    const { scanProvider, agentRunner, scan } = makeProviders();

    await handleFix(supabase, scanProvider, agentRunner, "scan-001");

    expect(scan).not.toHaveBeenCalled();
  });
});
