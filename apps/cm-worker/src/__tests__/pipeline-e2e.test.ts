import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { mockPullsCreate } = vi.hoisted(() => ({
  mockPullsCreate: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => ({
    rest: {
      pulls: { create: mockPullsCreate },
    },
  })),
}));

import { handleScan } from "../handlers/scan.js";
import { handleFix } from "../handlers/fix.js";
import { handleRescan } from "../handlers/rescan.js";
import { handlePushAndPR } from "../handlers/push-pr.js";
import { handleReport } from "../handlers/report.js";
import { MockScanProvider, StubRunner } from "@conductor/cm-adapters";
import type { ScanProvider } from "@conductor/cm-adapters";

const REPO_NAME = "ms-test-repo";

function createMockDb() {
  const db: Record<string, Array<Record<string, unknown>>> = {
    cm_scan: [],
    cm_repo: [],
    cm_pipeline: [],
    cm_finding: [],
    cm_report: [],
  };

  const capture: Array<{ table: string; payload: Record<string, unknown> }> = [];

  function makeQueryBuilder(table: string) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        const items = db[table] ?? [];
        const item = items[items.length - 1] ?? null;
        return Promise.resolve({ data: item, error: item ? null : { message: "not found" } });
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        const items = db[table] ?? [];
        if (items.length > 0) {
          Object.assign(items[items.length - 1]!, payload);
        }
        capture.push({ table, payload });
        return { eq: vi.fn().mockReturnThis() };
      }),
      insert: vi.fn(),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        (db.cm_finding ?? []).push(payload);
        capture.push({ table, payload });
        return { error: null };
      }),
    };
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (["cm_scan", "cm_repo", "cm_pipeline", "cm_finding"].includes(table)) {
        return makeQueryBuilder(table);
      }
      if (table === "cm_report") {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            (db.cm_report ?? []).push(payload);
            capture.push({ table, payload });
            return { error: null };
          }),
        };
      }
      return {};
    }),
  };

  function seed(table: string, rows: Record<string, unknown>[]) {
    db[table] = rows;
  }

  function getLatest(table: string) {
    const items = db[table] ?? [];
    return items[items.length - 1] ?? null;
  }

  function getAll(table: string) {
    return db[table] ?? [];
  }

  return { supabase, seed, getLatest, getAll, capture };
}

describe("full pipeline (P0–P4 acceptance gate)", () => {
  it("drives scheduler → scan → fix → rescan → PR → report → done with mocked externals", async () => {
    const scanProvider = new MockScanProvider();
    const agentRunner = new StubRunner();
    const { supabase, seed, getLatest, getAll } = createMockDb();
    const pipelineId = "pipe-001";
    const repoId = "repo-001";
    const scanId = "scan-001";
    const wsId = "ws-001";
    const reportDir = await mkdtemp(join(tmpdir(), "cm-e2e-report-"));

    try {
      seed("cm_pipeline", [
        { id: pipelineId, workspace_id: wsId, enabled: true, cron: "0 0 * * *", max_fix_attempts: 2 },
      ]);

      seed("cm_repo", [
        { id: repoId, pipeline_id: pipelineId, workspace_id: wsId, owner: "test", name: REPO_NAME, default_branch: "main", source: "auto", priority: 10, enabled: true, run_config: { buildCommand: "echo ok" } },
      ]);

      seed("cm_scan", [
        { id: scanId, repo_id: repoId, workspace_id: wsId, status: "queued", provider: "checkmarx", trigger: "manual", findings_total: 0, findings_actionable: 0, error: null, current_step: null, pr_url: null, report_path: null, started_at: null, finished_at: null, created_at: "2026-06-03T12:00:00Z", updated_at: "2026-06-03T12:00:00Z" },
      ]);

      mockPullsCreate.mockResolvedValue({
        data: { html_url: "https://github.com/test/ms-test-repo/pull/1" },
      });

      // === STAGE 1: Run the scan handler ===
      await handleScan(supabase as never, scanProvider, { scanId });

      let scan = getLatest("cm_scan");
      expect(scan?.status).toBe("scan_done");
      expect(scan?.findings_total).toBeGreaterThan(0);

      const findings = getAll("cm_finding");
      expect(findings.length).toBeGreaterThan(0);

      // === STAGE 2: Fix handler ===
      const fixTmpDir = await mkdtemp(join(tmpdir(), "cm-e2e-fix-"));
      const mockGitOps = {
        cloneToTemp: vi.fn().mockResolvedValue(fixTmpDir),
        createBranch: vi.fn().mockResolvedValue(undefined),
        commitAll: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        cleanup: vi.fn().mockResolvedValue(undefined),
      };

      await handleFix(supabase as never, scanProvider, agentRunner, scanId, mockGitOps as never);
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});

      scan = getLatest("cm_scan");
      expect(scan?.status).toBe("fixed");

      // === STAGE 3: Rescan (clean) ===
      const cleanProvider: ScanProvider = {
        scan: vi.fn().mockResolvedValue({ externalScanId: "rescan-clean" }),
        fetchResults: vi.fn().mockResolvedValue([]),
      };

      await handleRescan(supabase as never, cleanProvider, scanId);

      scan = getLatest("cm_scan");
      expect(scan?.status).toBe("verified");

      // === STAGE 4: Push + PR ===
      await handlePushAndPR(supabase as never, scanId, "https://github.com/test/ms-test-repo.git", mockGitOps as never);

      scan = getLatest("cm_scan");
      expect(scan?.status).toBe("pr_opened");
      expect(scan?.pr_url).toBe("https://github.com/test/ms-test-repo/pull/1");

      // === STAGE 5: Report ===
      await handleReport(supabase as never, scanId, reportDir);

      scan = getLatest("cm_scan");
      expect(scan?.status).toBe("done");
      expect(scan?.report_path).toBeTruthy();

      const reports = getAll("cm_report");
      expect(reports.length).toBe(1);

      // === Replay check (idempotency) ===
      await handleScan(supabase as never, scanProvider, { scanId });
      scan = getLatest("cm_scan");
      expect(scan?.status).toBe("done");

    } finally {
      await rm(reportDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);
});
