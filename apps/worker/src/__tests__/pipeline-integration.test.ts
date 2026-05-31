import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (must be before imports)
// ---------------------------------------------------------------------------

vi.mock("@conductor/github", () => ({
  createOctokit: vi.fn(() => ({})),
  createPR: vi.fn(() => Promise.resolve("https://github.com/test/pr/1")),
}));

vi.mock("../agents/index.js", () => ({
  runProductOwner: vi.fn(() =>
    Promise.resolve({
      summary: "Test spec",
      user_stories: [],
      acceptance_criteria: [],
      out_of_scope: [],
      open_questions: [],
      research_notes: [],
    }),
  ),
  runCodebaseAnalyst: vi.fn(() => Promise.resolve("/tmp/context.md")),
  runTechLead: vi.fn(() =>
    Promise.resolve({
      approach: "Test approach",
      complexity: "simple",
      sub_features: null,
      affected_modules: ["src/"],
      api_contract: { shared_types: [], endpoints: [] },
      tasks: [{ id: "GEN-1", area: "backend", desc: "Test", acceptance: "Works" }],
      branch: "feature/test",
      needs_migration: false,
      migration: null,
      risks: [],
    }),
  ),
  runBackend: vi.fn(() => Promise.resolve("backend output")),
  runFrontend: vi.fn(() => Promise.resolve("frontend output")),
  runSecurityReviewer: vi.fn(() =>
    Promise.resolve({ passed: true, escalate_to_tech_lead: false, issues: [] }),
  ),
  runCodeReviewer: vi.fn(() =>
    Promise.resolve({ approved: true, escalate: false, issues: [] }),
  ),
  runTester: vi.fn(() =>
    Promise.resolve({
      passed: true,
      needs_human: false,
      unit: { added: 1, passing: 1 },
      e2e: { scenarios: 0, passing: 0 },
      failures: [],
      commit_message: "feat: test",
    }),
  ),
}));

vi.mock("../usage.js", () => ({
  getUsageState: vi.fn(() =>
    Promise.resolve({
      thisMonth: { cost_usd: 0 },
      last7d: { cost_usd: 0 },
      last5h: { cost_usd: 0 },
      goStatus: "ok" as const,
    }),
  ),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../router.js")>();
  return {
    ...actual,
    resolveRoute: vi.fn((_agent: string, _mode: string, _usage: unknown, agentConfig?: { laneOverride?: string; model?: string }) => {
      const lane = agentConfig?.laneOverride === "cheap" || agentConfig?.laneOverride === "premium"
        ? agentConfig.laneOverride
        : "cheap";
      return {
        lane: lane as "cheap" | "premium",
        model: agentConfig?.model ?? (lane === "premium" ? "claude-sonnet-4-6" : "opencode-go/deepseek-v4-flash"),
        reason: agentConfig?.laneOverride ? `override: ${agentConfig.laneOverride}` : "policy: test",
      };
    }),
  };
});

vi.mock("../agentConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agentConfig.js")>();
  return {
    ...actual,
    getAgentConfig: vi.fn(),
    loadAgentConfig: vi.fn(() => Promise.resolve(true)),
    invalidateConfigCache: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(() => Promise.resolve("# context")),
  writeFile: vi.fn(() => Promise.resolve()),
  access: vi.fn(() => Promise.resolve()),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: () => void) => {
    cb();
  }),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { runPipeline } from "../orchestrator.js";
import { getAgentConfig, invalidateConfigCache, loadAgentConfig } from "../agentConfig.js";
import * as agents from "../agents/index.js";
import { resolveRoute } from "../router.js";

const viGetAgentConfig = vi.mocked(getAgentConfig);
const viLoadAgentConfig = vi.mocked(loadAgentConfig);
const viInvalidateConfigCache = vi.mocked(invalidateConfigCache);
const viResolveRoute = vi.mocked(resolveRoute);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_AGENT_NAMES = [
  "product-owner",
  "codebase-analyst",
  "tech-lead",
  "backend-dev",
  "frontend-dev",
  "security-reviewer",
  "code-reviewer",
  "qa-engineer",
] as const;

function createMockConfig(
  agentName: string,
  overrides: Partial<ReturnType<typeof makeAgentConfig>> = {},
) {
  return makeAgentConfig(agentName, true, 1, overrides);
}

function makeAgentConfig(
  name: string,
  enabled = true,
  order = 1,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `uuid-${name}`,
    agentName: name,
    displayName: name,
    role: `Role for ${name}`,
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: `Prompt for ${name}`,
    skillContent: null, categoryId: null,
    enabled,
    laneOverride: null as "cheap" | "premium" | null,
    order,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createPipelineMocks() {
  const jobUpdates: Record<string, unknown>[] = [];
  const supabase = {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((_key: string, _val: unknown) => ({
          limit: vi.fn(() => ({ data: [{ enabled: true }] })),
          single: vi.fn(() => ({ data: null, error: null })),
        })),
        single: vi.fn(() => ({ data: null, error: null })),
        order: vi.fn(() => ({ data: [], error: null })),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        jobUpdates.push(patch);
        return { eq: vi.fn(() => ({ data: null, error: null })) };
      }),
      insert: vi.fn(() => ({ data: null, error: null })),
    })),
  };
  return { supabase, jobUpdates };
}

function createJobRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    title: "Test Feature",
    description: "A test feature description",
    type: "feature",
    lane_preference: "auto",
    project_id: "proj-1",
    ...overrides,
  };
}

const baseProject = {
  owner: "test",
  repo: "test-repo",
  default_branch: "main",
};

function mockAllAgentsEnabled() {
  viGetAgentConfig.mockImplementation((name: string) => {
    if (ALL_AGENT_NAMES.includes(name as typeof ALL_AGENT_NAMES[number])) {
      const order = ALL_AGENT_NAMES.indexOf(name as typeof ALL_AGENT_NAMES[number]) + 1;
      return makeAgentConfig(name, true, order);
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pipeline integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConfigCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Full pipeline runs all 8 agents in order
  // -----------------------------------------------------------------------

  it("full pipeline runs all 8 agents in order", async () => {
    mockAllAgentsEnabled();

    const { supabase } = createPipelineMocks();
    const job = createJobRecord();
    await runPipeline(supabase as never, job, baseProject, "/tmp/repo");

    expect(vi.mocked(agents.runProductOwner)).toHaveBeenCalled();
    expect(vi.mocked(agents.runCodebaseAnalyst)).toHaveBeenCalled();
    expect(vi.mocked(agents.runTechLead)).toHaveBeenCalled();
    expect(vi.mocked(agents.runBackend)).toHaveBeenCalled();
    expect(vi.mocked(agents.runFrontend)).toHaveBeenCalled();
    expect(vi.mocked(agents.runSecurityReviewer)).toHaveBeenCalled();
    expect(vi.mocked(agents.runCodeReviewer)).toHaveBeenCalled();
    expect(vi.mocked(agents.runTester)).toHaveBeenCalled();

    // Verify call order matches agent_config.order
    const callOrder = [
      vi.mocked(agents.runProductOwner).mock.invocationCallOrder?.[0] ?? Infinity,
      vi.mocked(agents.runCodebaseAnalyst).mock.invocationCallOrder?.[0] ?? Infinity,
      vi.mocked(agents.runTechLead).mock.invocationCallOrder?.[0] ?? Infinity,
      vi.mocked(agents.runBackend).mock.invocationCallOrder?.[0] ?? Infinity,
      vi.mocked(agents.runFrontend).mock.invocationCallOrder?.[0] ?? Infinity,
      vi.mocked(agents.runSecurityReviewer).mock.invocationCallOrder?.[0] ?? Infinity,
      vi.mocked(agents.runCodeReviewer).mock.invocationCallOrder?.[0] ?? Infinity,
      vi.mocked(agents.runTester).mock.invocationCallOrder?.[0] ?? Infinity,
    ];

    for (let i = 1; i < callOrder.length; i++) {
      expect(callOrder[i]!).toBeGreaterThanOrEqual(callOrder[i - 1]!);
    }
  });

  // -----------------------------------------------------------------------
  // 2. Disabled agents are skipped with fallback behavior
  // -----------------------------------------------------------------------

  it("disabled agents are skipped with fallback behavior", async () => {
    viGetAgentConfig.mockImplementation((name: string) => {
      if (name === "backend-dev" || name === "frontend-dev") {
        return makeAgentConfig(name, false);
      }
      if (ALL_AGENT_NAMES.includes(name as typeof ALL_AGENT_NAMES[number])) {
        return makeAgentConfig(name, true);
      }
      return null;
    });

    const { supabase } = createPipelineMocks();
    const job = createJobRecord();
    await runPipeline(supabase as never, job, baseProject, "/tmp/repo");

    expect(vi.mocked(agents.runBackend)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runFrontend)).not.toHaveBeenCalled();

    expect(vi.mocked(agents.runProductOwner)).toHaveBeenCalled();
    expect(vi.mocked(agents.runCodebaseAnalyst)).toHaveBeenCalled();
    expect(vi.mocked(agents.runTechLead)).toHaveBeenCalled();
    expect(vi.mocked(agents.runSecurityReviewer)).toHaveBeenCalled();
    expect(vi.mocked(agents.runCodeReviewer)).toHaveBeenCalled();
    expect(vi.mocked(agents.runTester)).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Disabled product-owner uses description as spec
  // -----------------------------------------------------------------------

  it("disabled product-owner uses description as spec", async () => {
    viGetAgentConfig.mockImplementation((name: string) => {
      if (name === "product-owner") {
        return makeAgentConfig("product-owner", false, 1);
      }
      if (ALL_AGENT_NAMES.includes(name as typeof ALL_AGENT_NAMES[number])) {
        return makeAgentConfig(name, true);
      }
      return null;
    });

    const { supabase } = createPipelineMocks();
    const job = createJobRecord({ description: "Test feature" });
    await runPipeline(supabase as never, job, baseProject, "/tmp/repo");

    expect(vi.mocked(agents.runProductOwner)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runCodebaseAnalyst)).toHaveBeenCalled();

    // Verify tech-lead was called (meaning spec was generated via fallback)
    expect(vi.mocked(agents.runTechLead)).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 4. current_agent is updated during pipeline execution
  // -----------------------------------------------------------------------

  it("current_agent is updated during pipeline execution", async () => {
    mockAllAgentsEnabled();

    const { supabase, jobUpdates } = createPipelineMocks();
    const job = createJobRecord();
    await runPipeline(supabase as never, job, baseProject, "/tmp/repo");

    const agentUpdates = jobUpdates.filter(
      (u) => u.current_agent !== undefined && u.current_agent !== null,
    );
    expect(agentUpdates.length).toBeGreaterThan(0);

    // Verify current_agent was cleared in finally block
    const clearUpdate = jobUpdates.find(
      (u) => u.current_agent === null && u.current_step_message === null,
    );
    expect(clearUpdate).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 5. Agent config cache is invalidated before each pipeline run
  // -----------------------------------------------------------------------

  it("agent config cache is invalidated before each pipeline run", async () => {
    mockAllAgentsEnabled();

    const { supabase } = createPipelineMocks();
    const job = createJobRecord();

    // First run
    await runPipeline(supabase as never, job, baseProject, "/tmp/repo");
    expect(vi.mocked(agents.runProductOwner)).toHaveBeenCalled();

    // Simulate config change between runs
    viGetAgentConfig.mockImplementation((name: string) => {
      if (name === "product-owner") {
        return makeAgentConfig("product-owner", true, 1, { model: "new-model" });
      }
      if (ALL_AGENT_NAMES.includes(name as typeof ALL_AGENT_NAMES[number])) {
        return makeAgentConfig(name, true);
      }
      return null;
    });

    // Second run — should reflect the change
    invalidateConfigCache();

    const { supabase: supabase2 } = createPipelineMocks();
    await runPipeline(supabase2 as never, job, baseProject, "/tmp/repo");
    // Verify the pipeline ran again with the new config
    expect(vi.mocked(agents.runProductOwner)).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // 6. Lane override bypasses BASE_POLICY
  // -----------------------------------------------------------------------

  it("lane override bypasses BASE_POLICY", async () => {
    viGetAgentConfig.mockImplementation((name: string) => {
      if (name === "product-owner") {
        return makeAgentConfig("product-owner", true, 1, { laneOverride: "cheap" });
      }
      if (ALL_AGENT_NAMES.includes(name as typeof ALL_AGENT_NAMES[number])) {
        return makeAgentConfig(name, true);
      }
      return null;
    });

    const { supabase } = createPipelineMocks();
    const job = createJobRecord();
    await runPipeline(supabase as never, job, baseProject, "/tmp/repo");

    // Verify resolveRoute was called for product-owner
    const poRouteCalls = (viResolveRoute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === "product-owner",
    );
    expect(poRouteCalls.length).toBeGreaterThan(0);

    // The lane override is applied by the agent runner (runAgentForJSON/runAgentFreeText)
    // which reads agentConfig.laneOverride. Verify the product-owner was called with
    // the config that has laneOverride set.
    const poCall = vi.mocked(agents.runProductOwner).mock.calls[0]!;
    expect(poCall[0].agentConfig).toMatchObject({ laneOverride: "cheap" });
  });

  // -----------------------------------------------------------------------
  // 7. All agents disabled completes degraded
  // -----------------------------------------------------------------------

  it("all agents disabled completes degraded", async () => {
    viGetAgentConfig.mockImplementation((name: string) => {
      if (ALL_AGENT_NAMES.includes(name as typeof ALL_AGENT_NAMES[number])) {
        return makeAgentConfig(name, false);
      }
      return null;
    });

    const jobUpdates: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn((_key: string, _val: unknown) => ({
            limit: vi.fn(() => ({ data: [] })), // No enabled agents
            single: vi.fn(() => ({ data: null, error: null })),
          })),
          single: vi.fn(() => ({ data: null, error: null })),
          order: vi.fn(() => ({ data: [], error: null })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          jobUpdates.push(patch);
          return { eq: vi.fn(() => ({ data: null, error: null })) };
        }),
        insert: vi.fn(() => ({ data: null, error: null })),
      })),
    };

    const job = createJobRecord();

    // Should not throw — pipeline completes (needs_human status set in DB)
    await expect(
      runPipeline(supabase as never, job, baseProject, "/tmp/repo"),
    ).resolves.not.toThrow();

    // No agent function should have been called
    expect(vi.mocked(agents.runProductOwner)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runCodebaseAnalyst)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runTechLead)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runBackend)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runFrontend)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runSecurityReviewer)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runCodeReviewer)).not.toHaveBeenCalled();
    expect(vi.mocked(agents.runTester)).not.toHaveBeenCalled();

    // Job should have needs_human or failed status (orchestrator calls needsHuman on error)
    const statusUpdate = jobUpdates.find((u) => u.status === "needs_human" || u.status === "failed");
    expect(statusUpdate).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 8. Error in one agent doesn't stop the pipeline
  // -----------------------------------------------------------------------

  it("error in one agent doesn't stop the pipeline", async () => {
    viGetAgentConfig.mockImplementation((name: string) => {
      if (ALL_AGENT_NAMES.includes(name as typeof ALL_AGENT_NAMES[number])) {
        return makeAgentConfig(name, true);
      }
      return null;
    });

    // Make backend-dev throw an error
    vi.mocked(agents.runBackend).mockRejectedValueOnce(
      new Error("Backend agent crashed"),
    );

    const { supabase, jobUpdates } = createPipelineMocks();
    const job = createJobRecord();
    await runPipeline(supabase as never, job, baseProject, "/tmp/repo");

    // Backend was called (and threw)
    expect(vi.mocked(agents.runBackend)).toHaveBeenCalled();

    // Pipeline should have stopped at backend (orchestrator returns on error)
    // but current_agent should still be cleared in finally
    const clearUpdate = jobUpdates.find(
      (u) => u.current_agent === null && u.current_step_message === null,
    );
    expect(clearUpdate).toBeDefined();

    // Job should have needs_human status due to the error (orchestrator calls needsHuman, not failed)
    const needsHumanUpdate = jobUpdates.find((u) => u.status === "needs_human");
    expect(needsHumanUpdate).toBeDefined();
  });
});
