import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { handleScan } from "../handlers/scan.js";
import { handleFix } from "../handlers/fix.js";
import { MockScanProvider } from "@conductor/cm-adapters";
import type { ScanProvider } from "@conductor/cm-adapters";
import { MemorySaver } from "@langchain/langgraph";

const REPO_NAME = "ms-test-repo";

function createMockDb() {
  const db: Record<string, Array<Record<string, unknown>>> = {
    cm_scan: [],
    cm_repo: [],
    cm_pipeline: [],
    cm_finding: [],
    cm_report: [],
    agent_config: [],
    runs: [],
    usage_log: [],
  };

  const capture: Array<{ table: string; payload: Record<string, unknown> }> = [];

  function matchFilters(items: Array<Record<string, unknown>>, filters: Array<{ col: string; val: unknown; isIn?: boolean }>): Array<Record<string, unknown>> {
    return items.filter((row) => filters.every((filter) => (
      filter.isIn ? Array.isArray(filter.val) && (filter.val as unknown[]).includes(row[filter.col]) : row[filter.col] === filter.val
    )));
  }

  function makeQueryBuilder(table: string, filters?: Array<{ col: string; val: unknown; isIn?: boolean }>) {
    const f: Array<{ col: string; val: unknown; isIn?: boolean }> = filters ?? [];
    const self: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col: string, val: unknown) => {
        f.push({ col, val });
        return self;
      }),
      // why: `.in()` chains just like `.eq()` (a select query can filter on
      // several `.in()` clauses, e.g. severity + fix_status) but is ALSO the
      // terminal call in supabase-js when no `.single()`/`.maybeSingle()`
      // follows — making it thenable lets both usages work with the same mock.
      in: vi.fn((col: string, val: unknown) => {
        f.push({ col, val, isIn: true });
        const next = { ...self };
        (next as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => {
          resolve({ data: matchFilters(db[table] ?? [], f), error: null });
        };
        return next;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        let items = db[table] ?? [];
        for (const filter of f) {
          items = items.filter((row) => (row as Record<string, unknown>)[filter.col] === filter.val);
        }
        const item = items[items.length - 1] ?? null;
        return Promise.resolve({ data: item, error: item ? null : { message: "not found" } });
      }),
      maybeSingle: vi.fn().mockImplementation(() => {
        let items = db[table] ?? [];
        for (const filter of f) {
          items = items.filter((row) => (row as Record<string, unknown>)[filter.col] === filter.val);
        }
        const item = items[items.length - 1] ?? null;
        return Promise.resolve({ data: item, error: item ? null : { message: "not found" } });
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        const items = db[table] ?? [];
        if (items.length > 0) {
          Object.assign(items[items.length - 1]!, payload);
        }
        capture.push({ table, payload });
        return {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
      insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        const row = { id: `${table}-row-${Date.now()}`, ...payload };
        (db[table] ?? []).push(row);
        capture.push({ table, payload });
        return makeQueryBuilder(table);
      }),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        (db.cm_finding ?? []).push(payload);
        capture.push({ table, payload });
        return { error: null };
      }),
    };
    return self;
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (["cm_scan", "cm_repo", "cm_pipeline", "cm_finding", "agent_config", "runs", "usage_log"].includes(table)) {
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
  it("drives scheduler → scan → fix → rescan → report → verified with mocked externals", async () => {
    const scanProvider = new MockScanProvider();
    const { supabase, seed, getLatest, getAll } = createMockDb();
    const pipelineId = "pipe-001";
    const repoId = "repo-001";
    const scanId = "scan-001";
    const wsId = "ws-001";
    const reportDir = await mkdtemp(join(tmpdir(), "cm-e2e-report-"));

    try {
      seed("cm_pipeline", [
        { id: pipelineId, workspace_id: wsId, enabled: true, cron: "0 0 * * *", max_fix_attempts: 2, fix_branch: "checkmarx-auto", report_dir: reportDir, sca_test_policy: "skip-minor", severity_threshold: ["CRITICAL", "HIGH"] },
      ]);

      seed("agent_config", [
        { id: "agent-planner", agent_name: "cm-fix-planner", display_name: "CM Fix Planner", provider: "anthropic", model: "claude-sonnet-4-6", system_prompt: "Triage findings.", allowed_tools: [] },
        { id: "agent-verifier", agent_name: "cm-fix-verifier", display_name: "CM Fix Verifier", provider: "anthropic", model: "claude-sonnet-4-6", system_prompt: "Verify fixes.", allowed_tools: [] },
        { id: "agent-sca", agent_name: "cm-sca-agent", display_name: "CM SCA Agent", provider: "anthropic", model: "claude-sonnet-4-6", system_prompt: "Fix deps.", allowed_tools: [] },
        { id: "agent-sast", agent_name: "cm-sast-agent", display_name: "CM SAST Agent", provider: "anthropic", model: "claude-sonnet-4-6", system_prompt: "Fix code.", allowed_tools: [] },
      ]);

      seed("cm_repo", [
        { id: repoId, pipeline_id: pipelineId, workspace_id: wsId, owner: "test", name: REPO_NAME, default_branch: "main", source: "auto", priority: 10, enabled: true },
      ]);

      seed("cm_scan", [
        { id: scanId, repo_id: repoId, workspace_id: wsId, status: "queued", provider: "checkmarx", trigger: "manual", findings_total: 0, findings_actionable: 0, error: null, current_step: null, report_path: null, started_at: null, finished_at: null, created_at: "2026-06-03T12:00:00Z", updated_at: "2026-06-03T12:00:00Z" },
      ]);

      // === STAGE 1: Run the scan handler ===
      await handleScan(supabase as never, scanProvider, { scanId });

      let scan = getLatest("cm_scan");
      expect(scan?.status).toBe("scan_done");
      expect(scan?.findings_total).toBeGreaterThan(0);

      const findings = getAll("cm_finding");
      expect(findings.length).toBeGreaterThan(0);

      // === STAGE 2: Fix handler (now includes rescan + report inline; the
      // pipeline stops at "verified" — it commits+pushes to the fix branch
      // and never opens a PR, a human takes it from there) ===
      // Configure agent runner to return PASS: for the verifier
      const passingAgentRunner: import("@conductor/cm-adapters").AgentRunner = {
        run: vi.fn().mockImplementation(async (agentConfig, task) => {
          if (agentConfig.agentName === "cm-fix-verifier") {
            return {
              summary: "PASS: build ok, all tests passed",
              changed: false,
              usage: { inputTokens: 50, outputTokens: 10 },
            };
          }
          // Planner: return a valid plan
          if (agentConfig.agentName === "cm-fix-planner") {
            const findingsJson = task.description.match(/"fingerprint": "([^"]+)"/g) ?? [];
            const fingerprints = findingsJson.map((s: string) => s.replace(/"fingerprint": "/, "").replace(/"$/, ""));
            return {
              summary: JSON.stringify({
                findings: fingerprints.map((fp: string) => ({
                  fingerprint: fp,
                  strategy: "code-fix",
                  category: "backend",
                  reachable: true,
                  exploitable: true,
                  falsePositive: false,
                  priority: 8,
                  confidence: 0.8,
                  notes: "test fix",
                })),
              }),
              changed: true,
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          // SCA/SAST agents: report success
          return {
            summary: `Fixed: ${task.description.slice(0, 80)}`,
            changed: true,
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        }),
      };

      // Mock scanProvider to return clean rescan
      const rescanProvider: ScanProvider = {
        scan: vi.fn().mockImplementation(async (_repo, branch) => {
          if (branch === "checkmarx-fix") {
            return { externalScanId: "rescan-clean", findings: [] };
          }
          // First scan returns findings
          return scanProvider.scan(_repo, branch);
        }),
        fetchResults: vi.fn(),
      };

      const fixTmpDir = await mkdtemp(join(tmpdir(), "cm-e2e-fix-"));
      const pushFn = vi.fn().mockResolvedValue(undefined);
      const mockGitOps = {
        cloneToTemp: vi.fn().mockResolvedValue(fixTmpDir),
        createBranch: vi.fn().mockResolvedValue(undefined),
        commitAll: vi.fn().mockResolvedValue(undefined),
        push: pushFn,
        pushBranch: pushFn,
        cleanup: vi.fn().mockResolvedValue(undefined),
        diffPatch: vi.fn().mockResolvedValue(""),
        applyPatch: vi.fn().mockResolvedValue(true),
      };

      const checkpointer = new MemorySaver();
      await handleFix(supabase as never, rescanProvider, passingAgentRunner, checkpointer, scanId, mockGitOps as never);
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});

      scan = getLatest("cm_scan");
      expect(scan?.status).toBe("verified");
      expect(scan?.report_path).toBeTruthy();

      const reports = getAll("cm_report");
      expect(reports.length).toBe(1);

      // === Replay check (idempotency) ===
      await handleScan(supabase as never, scanProvider, { scanId });
      scan = getLatest("cm_scan");
      expect(scan?.status).toBe("verified");

    } finally {
      await rm(reportDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);
});
