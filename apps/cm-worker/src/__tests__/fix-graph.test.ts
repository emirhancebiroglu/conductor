import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemorySaver, Command } from "@langchain/langgraph";
import type { AgentRunner, AgentRunnerTask, ScanProvider } from "@conductor/cm-adapters";

const { mockExeca } = vi.hoisted(() => ({ mockExeca: vi.fn() }));
vi.mock("execa", () => ({ execa: mockExeca }));

const { buildFixGraph } = await import("../pipeline/fix-graph.js");

/** autoDetectRunConfig only checks for file presence — content doesn't matter. */
async function makeNodeProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fix-graph-test-"));
  await writeFile(join(dir, "package.json"), "{}");
  return dir;
}

function execaOk() {
  return { stdout: "ok", stderr: "", exitCode: 0 };
}

function execaFail(errorText: string) {
  return { stdout: errorText, stderr: "", exitCode: 1 };
}

/**
 * dispatchAgent (dispatch.ts) also shells out to `git rev-parse`/`git status`
 * around every agent call, using the SAME mocked execa — those must be
 * answered generically and NOT consume the build-command queue below, or
 * they desync it (confirmed the hard way: a plain mockResolvedValueOnce
 * chain gets consumed by git-hash checks meant for planner/sca/sast
 * dispatches, starving the actual build-command calls).
 */
let buildQueue: Array<{ stdout: string; stderr: string; exitCode: number }> = [];

mockExeca.mockImplementation((cmd: unknown) => {
  if (cmd === "git") return Promise.resolve({ stdout: "abc123", stderr: "", exitCode: 0 });
  return Promise.resolve(buildQueue.shift() ?? execaOk());
});

/**
 * Queues build-command responses for one full graph run: baselineCheck
 * always runs build+test once each; verify runs build+test once each too
 * (unless the build itself fails, in which case runBuildDeterministic skips
 * the test command).
 */
function queueBuildRuns(baseline: { buildOk: boolean; output?: string }, verify: { buildOk: boolean; output?: string }) {
  buildQueue = [];
  buildQueue.push(baseline.buildOk ? execaOk() : execaFail(baseline.output ?? "BUILD FAILURE"));
  if (baseline.buildOk) buildQueue.push(execaOk()); // baseline test command
  buildQueue.push(verify.buildOk ? execaOk() : execaFail(verify.output ?? "BUILD FAILURE"));
  if (verify.buildOk) buildQueue.push(execaOk()); // verify test command
}

function makeMockDb() {
  const db: Record<string, Array<Record<string, unknown>>> = {
    cm_scan: [{ id: "scan-001", current_step: null, status: "fixing" }],
    cm_finding: [],
    agent_config: [
      { id: "a1", agent_name: "cm-fix-planner", provider: "claude", model: "claude-sonnet-4-6", system_prompt: "p", allowed_tools: [] },
      { id: "a2", agent_name: "cm-sast-agent", provider: "claude", model: "claude-sonnet-4-6", system_prompt: "p", allowed_tools: [] },
      { id: "a3", agent_name: "cm-fix-verifier", provider: "claude", model: "claude-sonnet-4-6", system_prompt: "p", allowed_tools: [] },
    ],
    runs: [],
    usage_log: [],
  };
  const scanStatusHistory: string[] = [];

  type Filter = { col: string; val: unknown; op: "eq" | "in" | "neq" };

  function applyFilters(items: Array<Record<string, unknown>>, filters: Filter[]): Array<Record<string, unknown>> {
    return items.filter((row) => filters.every((f) => {
      if (f.op === "eq") return row[f.col] === f.val;
      if (f.op === "neq") return row[f.col] !== f.val;
      return Array.isArray(f.val) && (f.val as unknown[]).includes(row[f.col]);
    }));
  }

  /** update() returns a chain that can take any number of .eq()/.neq()/.in() filters before resolving. */
  function makeUpdateBuilder(table: string, payload: Record<string, unknown>, filters: Filter[]) {
    const apply = () => {
      for (const row of applyFilters(db[table] ?? [], filters)) Object.assign(row, payload);
      if (table === "cm_scan" && typeof payload.status === "string") scanStatusHistory.push(payload.status);
      return { error: null };
    };
    const builder: Record<string, unknown> = {
      eq: vi.fn((col: string, val: unknown) => makeUpdateBuilder(table, payload, [...filters, { col, val, op: "eq" as const }])),
      in: vi.fn((col: string, val: unknown) => makeUpdateBuilder(table, payload, [...filters, { col, val, op: "in" as const }])),
      neq: vi.fn((col: string, val: unknown) => makeUpdateBuilder(table, payload, [...filters, { col, val, op: "neq" as const }])),
      then: (resolve: (v: unknown) => void) => resolve(apply()),
    };
    return builder;
  }

  function makeQueryBuilder(table: string, filters: Filter[] = []) {
    const self: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col: string, val: unknown) => makeQueryBuilder(table, [...filters, { col, val, op: "eq" }])),
      in: vi.fn((col: string, val: unknown) => {
        const withFilter = [...filters, { col, val, op: "in" as const }];
        const next = makeQueryBuilder(table, withFilter);
        // why: `.in()` is used both as a query-builder chain link (select().eq().in()
        // returning a Promise-like directly, per the real supabase-js API) and
        // sometimes as the terminal call after update() — support both by making
        // the returned object itself thenable.
        (next as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => {
          resolve({ data: applyFilters(db[table] ?? [], withFilter), error: null });
        };
        return next;
      }),
      single: vi.fn().mockImplementation(() => {
        const items = applyFilters(db[table] ?? [], filters);
        const item = items.at(-1) ?? null;
        return Promise.resolve({ data: item, error: item ? null : { message: "not found" } });
      }),
      update: vi.fn((payload: Record<string, unknown>) => makeUpdateBuilder(table, payload, filters)),
      insert: vi.fn((payload: Record<string, unknown>) => {
        const row = { id: `${table}-${Date.now()}-${Math.random()}`, ...payload };
        (db[table] ?? []).push(row);
        return makeQueryBuilder(table);
      }),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        const items = db[table] ?? [];
        const existing = items.find((r) => r.scan_id === payload.scan_id && r.fingerprint === payload.fingerprint);
        if (existing) {
          Object.assign(existing, payload);
        } else {
          items.push({ id: `${table}-${Date.now()}-${Math.random()}`, ...payload });
        }
        return Promise.resolve({ error: null });
      }),
    };
    return self;
  }

  const supabase = {
    from: vi.fn((table: string) => makeQueryBuilder(table)),
  };

  return { supabase: supabase as never, db, scanStatusHistory };
}

/** cm-fix-verifier is only dispatched for the ambiguous (signatures differ) case now — this controls what it returns when it IS called. */
function makeAgentRunner(classificationOutcome: "fail_regression" | "fail_preexisting" = "fail_regression") {
  const planRun = vi.fn();
  const sastRun = vi.fn();
  const verifyRun = vi.fn();

  const run = vi.fn((config: { agentName: string }, task: AgentRunnerTask) => {
    if (config.agentName === "cm-fix-planner") {
      planRun(task);
      const fps = [...task.description.matchAll(/fingerprint: (\S+)/g)].map((m) => m[1]);
      return {
        summary: JSON.stringify({
          findings: fps.map((fp) => ({
            fingerprint: fp, strategy: "code-fix", category: "backend",
            reachable: true, exploitable: true, falsePositive: false,
            priority: 8, confidence: 0.8, notes: "test",
          })),
        }),
        changed: false, usage: { inputTokens: 10, outputTokens: 5 },
      };
    }
    if (config.agentName === "cm-sast-agent") {
      sastRun(task);
      const fps = [...task.description.matchAll(/fingerprint: (\S+)/g)].map((m) => m[1]);
      return {
        summary: JSON.stringify({ results: fps.map((fp) => ({ fingerprint: fp, fixStatus: "fixed", notes: "fixed" })) }),
        changed: true, usage: { inputTokens: 10, outputTokens: 5 },
      };
    }
    if (config.agentName === "cm-fix-verifier") {
      verifyRun(task);
      return {
        summary: JSON.stringify({ outcome: classificationOutcome, summary: `classified as ${classificationOutcome}` }),
        changed: false, usage: { inputTokens: 10, outputTokens: 5 },
      };
    }
    throw new Error(`unexpected agent ${config.agentName}`);
  });

  return { runner: { run } as unknown as AgentRunner, planRun, sastRun, verifyRun };
}

function makeGitOps(fixTmpDir: string) {
  return {
    cloneToTemp: vi.fn().mockResolvedValue(fixTmpDir),
    createBranch: vi.fn().mockResolvedValue(undefined),
    commitAll: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
    diffPatch: vi.fn().mockResolvedValue(""),
    applyPatch: vi.fn().mockResolvedValue(true),
  };
}

const FINDING = {
  id: "f-1", scanId: "scan-001", workspaceId: "ws-001", source: "sast" as const,
  severity: "HIGH" as const, rule: "XSS", package: null, currentVersion: null, fixedVersion: null,
  upgradeImpact: null, file: "src/a.ts", line: 1, fingerprint: "fp-1",
  fixStatus: "open" as const, fixAttempts: 0, fixNotes: null, description: "d", taintFlow: null,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
};

const BASE_INITIAL_STATE = {
  scanId: "scan-001", workspaceId: "ws-001", repo: { owner: "test", name: "repo" },
  repoUrl: "https://github.com/test/repo.git", cloneBranch: "main", fixBranch: "checkmarx-fix",
  scaPolicy: "skip-minor" as const, severityThreshold: ["CRITICAL", "HIGH"] as const,
  maxFixAttempts: 2, reportDir: "/tmp/reports", runConfig: {}, attempt: 1,
  findings: [FINDING], planItems: [], baselineBuildOutput: undefined,
  baselineErrorSignature: undefined, verifyOutcome: undefined, verifySummary: undefined,
};

describe("fix-graph", () => {
  it("baseline and fix-branch build fail identically → fail_preexisting, no agent classification dispatched", async () => {
    const fixTmpDir = await makeNodeProjectDir();
    try {
      const { supabase, db } = makeMockDb();
      const { runner, verifyRun } = makeAgentRunner();
      const ops = makeGitOps(fixTmpDir);
      const scanProvider = { scan: vi.fn().mockResolvedValue({ externalScanId: "x", findings: [] }), fetchResults: vi.fn() } as unknown as ScanProvider;

      const sameError = "npm ERR! code ENOVERSIONS\nnpm ERR! No versions available for react-flexy-table\nBUILD FAILURE";
      queueBuildRuns({ buildOk: false, output: sameError }, { buildOk: false, output: sameError });

      const graph = buildFixGraph({ supabase, scanProvider, agentRunner: runner, ops: ops as never, checkpointer: new MemorySaver() });
      const config = { configurable: { thread_id: "scan-001" } };

      const result = await graph.invoke(BASE_INITIAL_STATE, config);

      expect(verifyRun).not.toHaveBeenCalled();
      expect(result.verifyOutcome).toBe("fail_preexisting");
      expect((db.cm_scan![0] as { status: string }).status).toBe("verified");
    } finally {
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("fix-branch build fails with a NEW error not present at baseline → dispatches agent, pauses at interrupt; resuming continues without re-running plan", async () => {
    const fixTmpDir = await makeNodeProjectDir();
    try {
      const { supabase, db } = makeMockDb();
      const { runner, planRun, verifyRun } = makeAgentRunner("fail_regression");
      const ops = makeGitOps(fixTmpDir);
      const scanProvider = { scan: vi.fn().mockResolvedValue({ externalScanId: "x", findings: [] }), fetchResults: vi.fn() } as unknown as ScanProvider;
      const checkpointer = new MemorySaver();

      queueBuildRuns({ buildOk: true }, { buildOk: false, output: "[ERROR] cannot find symbol: fooBar()\nBUILD FAILURE" });

      const graph = buildFixGraph({ supabase, scanProvider, agentRunner: runner, ops: ops as never, checkpointer });
      const config = { configurable: { thread_id: "scan-001" } };

      const result1 = await graph.invoke(BASE_INITIAL_STATE, config);
      expect(result1.__interrupt__).toBeDefined();
      expect(planRun).toHaveBeenCalledTimes(1);
      expect(verifyRun).toHaveBeenCalledTimes(1);
      expect((db.cm_scan![0] as { status: string }).status).toBe("needs_human");

      // resume — baselineCheck does NOT re-run (already checkpointed), only
      // verify's own build re-runs, so only queue that (same failure again).
      buildQueue = [execaFail("[ERROR] cannot find symbol: fooBar()\nBUILD FAILURE")];
      const result2 = await graph.invoke(new Command({ resume: "retry" }), config);
      expect(planRun).toHaveBeenCalledTimes(1);
      expect(verifyRun).toHaveBeenCalledTimes(2);
      expect(result2.verifyOutcome).toBe("fail_regression");
    } finally {
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("clean build (exit 0) reaches report without any verifier agent dispatch, passing through 'reporting' before 'verified'", async () => {
    const fixTmpDir = await makeNodeProjectDir();
    try {
      const { supabase, db, scanStatusHistory } = makeMockDb();
      const { runner, verifyRun } = makeAgentRunner();
      const ops = makeGitOps(fixTmpDir);
      const scanProvider = { scan: vi.fn().mockResolvedValue({ externalScanId: "x", findings: [] }), fetchResults: vi.fn() } as unknown as ScanProvider;

      queueBuildRuns({ buildOk: true }, { buildOk: true });

      const graph = buildFixGraph({ supabase, scanProvider, agentRunner: runner, ops: ops as never, checkpointer: new MemorySaver() });
      const config = { configurable: { thread_id: "scan-001" } };

      const result = await graph.invoke(BASE_INITIAL_STATE, config);

      expect(verifyRun).not.toHaveBeenCalled();
      expect(result.verifyOutcome).toBe("pass");
      expect((db.cm_scan![0] as { status: string }).status).toBe("verified");
      // why: the dashboard must never show "Verified" before the PDF actually
      // exists — confirms the report node sets "reporting" first, generates
      // the report, and only then "verified" (not straight to "verified").
      expect(scanStatusHistory).toContain("reporting");
      expect(scanStatusHistory.indexOf("reporting")).toBeLessThan(scanStatusHistory.lastIndexOf("verified"));
    } finally {
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rescan does NOT overwrite findings_actionable with the remaining count (real production bug: a clean rescan zeroed out the scan's original actionable count, making the report say 'Actionable: 0' on a fully-remediated scan)", async () => {
    const fixTmpDir = await makeNodeProjectDir();
    try {
      const { supabase, db } = makeMockDb();
      (db.cm_scan![0] as Record<string, unknown>).findings_actionable = 26;
      const { runner } = makeAgentRunner();
      const ops = makeGitOps(fixTmpDir);
      const scanProvider = {
        scan: vi.fn().mockResolvedValue({ externalScanId: "x", findings: [] }),
        fetchResults: vi.fn(),
        rescanRest: vi.fn().mockResolvedValue({ externalScanId: "rescan-clean-1", findings: [] }),
      } as unknown as ScanProvider;

      queueBuildRuns({ buildOk: true }, { buildOk: true });

      const graph = buildFixGraph({ supabase, scanProvider, agentRunner: runner, ops: ops as never, checkpointer: new MemorySaver() });
      const config = { configurable: { thread_id: "scan-001" } };

      await graph.invoke(BASE_INITIAL_STATE, config);

      expect((db.cm_scan![0] as { findings_actionable: number }).findings_actionable).toBe(26);
      expect((db.cm_scan![0] as { external_scan_id: string }).external_scan_id).toBe("rescan-clean-1");
    } finally {
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rescan finding no longer reported by Checkmarx is closed as fixed, even though cm_finding previously had it mismarked (real production bug: findings mismarked skipped/fixed left the DB out of sync with the actual rescan result)", async () => {
    const fixTmpDir = await makeNodeProjectDir();
    try {
      const { supabase, db } = makeMockDb();
      // Precondition mirroring the real bug: cm_finding still has this
      // CRITICAL/HIGH fingerprint marked "skipped" from an earlier (buggy)
      // pass, even though the fix branch's rescan no longer reports it.
      (db.cm_finding as Array<Record<string, unknown>>).push({
        id: "row-1", scan_id: "scan-001", fingerprint: "fp-1", severity: "HIGH", fix_status: "skipped",
      });

      const { runner, verifyRun } = makeAgentRunner();
      const ops = makeGitOps(fixTmpDir);
      // rescanRest reports the branch IS clean now — Checkmarx no longer sees fp-1.
      const scanProvider = {
        scan: vi.fn().mockResolvedValue({ externalScanId: "x", findings: [] }),
        fetchResults: vi.fn(),
        rescanRest: vi.fn().mockResolvedValue({ externalScanId: "rescan-1", findings: [] }),
      } as unknown as ScanProvider;

      queueBuildRuns({ buildOk: true }, { buildOk: true });

      const graph = buildFixGraph({ supabase, scanProvider, agentRunner: runner, ops: ops as never, checkpointer: new MemorySaver() });
      const config = { configurable: { thread_id: "scan-001" } };

      await graph.invoke(BASE_INITIAL_STATE, config);

      expect(verifyRun).not.toHaveBeenCalled();
      expect((db.cm_scan![0] as { status: string; external_scan_id: string }).status).toBe("verified");
      expect((db.cm_scan![0] as { external_scan_id: string }).external_scan_id).toBe("rescan-1");
      const staleRow = (db.cm_finding as Array<Record<string, unknown>>).find((r) => r.fingerprint === "fp-1");
      expect(staleRow?.fix_status).toBe("fixed");
    } finally {
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rescan still reports a CRITICAL/HIGH finding — upserts it as open in cm_finding and retries instead of trusting stale DB status", async () => {
    const fixTmpDir = await makeNodeProjectDir();
    try {
      const { supabase, db } = makeMockDb();
      // The finding was previously (wrongly) marked "skipped" in cm_finding —
      // this is the exact real production bug precondition — but Checkmarx's
      // rescan still reports it as a live CRITICAL/HIGH finding.
      (db.cm_finding as Array<Record<string, unknown>>).push({
        id: "row-1", scan_id: "scan-001", fingerprint: "fp-1", severity: "HIGH", fix_status: "skipped",
      });

      const { runner } = makeAgentRunner();
      const ops = makeGitOps(fixTmpDir);
      const scanProvider = {
        scan: vi.fn().mockResolvedValue({ externalScanId: "x", findings: [] }),
        fetchResults: vi.fn(),
        rescanRest: vi.fn().mockResolvedValue({
          externalScanId: "rescan-1",
          findings: [{ ...FINDING, severity: "HIGH" }],
        }),
      } as unknown as ScanProvider;

      queueBuildRuns({ buildOk: true }, { buildOk: true });

      const graph = buildFixGraph({ supabase, scanProvider, agentRunner: runner, ops: ops as never, checkpointer: new MemorySaver() });
      const config = { configurable: { thread_id: "scan-001" } };

      const result = await graph.invoke(BASE_INITIAL_STATE, config);

      // Must NOT reach "verified" — the sync in rescanFixBranch re-opens the
      // finding cm_finding had wrong, so the graph correctly retries.
      expect(result.attempt).toBeGreaterThan(1);
      const row = (db.cm_finding as Array<Record<string, unknown>>).find((r) => r.fingerprint === "fp-1");
      expect(row?.fix_status).toBe("open");
    } finally {
      await rm(fixTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
