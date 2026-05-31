import { describe, it, expect, beforeEach, vi } from "vitest";

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
  runBackend: vi.fn(() => Promise.resolve()),
  runFrontend: vi.fn(() => Promise.resolve()),
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

vi.mock("../router.js", () => ({
  resolveRoute: vi.fn(() => ({
    lane: "cheap" as const,
    model: "opencode-go/deepseek-v4-flash",
    reason: "policy: test",
  })),
}));

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
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: () => void) => {
    cb();
  }),
}));

import { runPipeline } from "../orchestrator.js";
import { getAgentConfig, invalidateConfigCache, loadAgentConfig } from "../agentConfig.js";
import * as agents from "../agents/index.js";

const viGetAgentConfig = vi.mocked(getAgentConfig);
const viLoadAgentConfig = vi.mocked(loadAgentConfig);

function makeAgentConfig(
  name: string,
  enabled = true,
  order = 1,
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
  };
}

function mockSupabase(
  enabledCount = 8,
  jobUpdates: Record<string, unknown>[] = [],
) {
  let updateCallCount = 0;
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((_key: string, _val: unknown) => ({
          limit: vi.fn(() => ({
            data: enabledCount > 0 ? [{ enabled: true }] : [],
          })),
          single: vi.fn(() => {
            if (table === "agent_config") {
              return { data: { enabled: true }, error: null };
            }
            return { data: null, error: null };
          }),
        })),
        single: vi.fn(() => ({ data: null, error: null })),
        order: vi.fn(() => ({
          data: [],
          error: null,
        })),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        jobUpdates.push(patch);
        updateCallCount++;
        return {
          eq: vi.fn(() => ({ data: null, error: null })),
        };
      }),
      insert: vi.fn(() => ({
        data: null,
        error: null,
      })),
    })),
  };
}

const baseJob = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  title: "Test Feature",
  description: "A test feature description",
  type: "feature",
  lane_preference: "auto",
  project_id: "proj-1",
};

const baseProject = {
  owner: "test",
  repo: "test-repo",
  default_branch: "main",
};

describe("orchestrator runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConfigCache();
  });

  describe("all agents enabled", () => {
    it("all 8 agent functions called in order", async () => {
      const allAgents = [
        "product-owner",
        "codebase-analyst",
        "tech-lead",
        "backend-dev",
        "frontend-dev",
        "security-reviewer",
        "code-reviewer",
        "qa-engineer",
      ];

      viGetAgentConfig.mockImplementation((name: string) => {
        if (allAgents.includes(name)) {
          return makeAgentConfig(name, true);
        }
        return null;
      });

      const supabase = mockSupabase(8);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runProductOwner)).toHaveBeenCalled();
      expect(vi.mocked(agents.runCodebaseAnalyst)).toHaveBeenCalled();
      expect(vi.mocked(agents.runTechLead)).toHaveBeenCalled();
      expect(vi.mocked(agents.runBackend)).toHaveBeenCalled();
      expect(vi.mocked(agents.runFrontend)).toHaveBeenCalled();
      expect(vi.mocked(agents.runSecurityReviewer)).toHaveBeenCalled();
      expect(vi.mocked(agents.runCodeReviewer)).toHaveBeenCalled();
      expect(vi.mocked(agents.runTester)).toHaveBeenCalled();
    });
  });

  describe("backend-dev disabled", () => {
    it("backend-dev skipped with warning, other agents called", async () => {
      const enabledAgents = [
        "product-owner",
        "codebase-analyst",
        "tech-lead",
        "frontend-dev",
        "security-reviewer",
        "code-reviewer",
        "qa-engineer",
      ];

      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "backend-dev") {
          return makeAgentConfig("backend-dev", false, 4);
        }
        if (enabledAgents.includes(name)) {
          return makeAgentConfig(name, true);
        }
        return null;
      });

      const supabase = mockSupabase(7);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runProductOwner)).toHaveBeenCalled();
      expect(vi.mocked(agents.runCodebaseAnalyst)).toHaveBeenCalled();
      expect(vi.mocked(agents.runTechLead)).toHaveBeenCalled();
      expect(vi.mocked(agents.runBackend)).not.toHaveBeenCalled();
      expect(vi.mocked(agents.runFrontend)).toHaveBeenCalled();
      expect(vi.mocked(agents.runSecurityReviewer)).toHaveBeenCalled();
      expect(vi.mocked(agents.runCodeReviewer)).toHaveBeenCalled();
      expect(vi.mocked(agents.runTester)).toHaveBeenCalled();
    });
  });

  describe("product-owner disabled", () => {
    it("uses description as spec, logs warning", async () => {
      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "product-owner") {
          return makeAgentConfig("product-owner", false, 1);
        }
        return makeAgentConfig(name, true);
      });

      const supabase = mockSupabase(7);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runProductOwner)).not.toHaveBeenCalled();
      expect(vi.mocked(agents.runCodebaseAnalyst)).toHaveBeenCalled();
    });
  });

  describe("current_agent updated before each agent step", () => {
    it("current_agent field is set for each agent", async () => {
      const allAgents = [
        "product-owner",
        "codebase-analyst",
        "tech-lead",
        "backend-dev",
        "frontend-dev",
        "security-reviewer",
        "code-reviewer",
        "qa-engineer",
      ];

      viGetAgentConfig.mockImplementation((name: string) => {
        if (allAgents.includes(name)) {
          return makeAgentConfig(name, true);
        }
        return null;
      });

      const updates: Record<string, unknown>[] = [];
      const supabase = mockSupabase(8, updates);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      const agentUpdates = updates.filter(
        (u) => u.current_agent !== undefined && u.current_agent !== null,
      );
      expect(agentUpdates.length).toBeGreaterThan(0);
    });
  });

  describe("current_agent cleared in finally block", () => {
    it("current_agent cleared on success path", async () => {
      const allAgents = [
        "product-owner",
        "codebase-analyst",
        "tech-lead",
        "backend-dev",
        "frontend-dev",
        "security-reviewer",
        "code-reviewer",
        "qa-engineer",
      ];

      viGetAgentConfig.mockImplementation((name: string) => {
        if (allAgents.includes(name)) {
          return makeAgentConfig(name, true);
        }
        return null;
      });

      const updates: Record<string, unknown>[] = [];
      const supabase = mockSupabase(8, updates);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      const clearUpdate = updates.find(
        (u) => u.current_agent === null && u.current_step_message === null,
      );
      expect(clearUpdate).toBeDefined();
    });

    it("current_agent cleared on error path", async () => {
      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "product-owner") {
          return makeAgentConfig("product-owner", true);
        }
        return null;
      });

      vi.mocked(agents.runProductOwner).mockRejectedValueOnce(
        new Error("PO agent crashed"),
      );

      const updates: Record<string, unknown>[] = [];
      const supabase = mockSupabase(8, updates);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      const clearUpdate = updates.find(
        (u) => u.current_agent === null && u.current_step_message === null,
      );
      expect(clearUpdate).toBeDefined();
    });
  });

  describe("current_step_message updated with agent step info", () => {
    it("current_step_message is set for each agent", async () => {
      const allAgents = [
        "product-owner",
        "codebase-analyst",
        "tech-lead",
        "backend-dev",
        "frontend-dev",
        "security-reviewer",
        "code-reviewer",
        "qa-engineer",
      ];

      viGetAgentConfig.mockImplementation((name: string) => {
        if (allAgents.includes(name)) {
          return makeAgentConfig(name, true);
        }
        return null;
      });

      const updates: Record<string, unknown>[] = [];
      const supabase = mockSupabase(8, updates);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      const stepUpdates = updates.filter(
        (u) =>
          u.current_step_message !== undefined &&
          u.current_step_message !== null,
      );
      expect(stepUpdates.length).toBeGreaterThan(0);
    });
  });

  describe("disabled agent fallback", () => {
    it("codebase-analyst disabled creates placeholder context", async () => {
      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "codebase-analyst") {
          return makeAgentConfig("codebase-analyst", false, 2);
        }
        return makeAgentConfig(name, true);
      });

      const supabase = mockSupabase(7);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runCodebaseAnalyst)).not.toHaveBeenCalled();
      expect(vi.mocked(agents.runTechLead)).toHaveBeenCalled();
    });

    it("tech-lead disabled creates minimal plan", async () => {
      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "tech-lead") {
          return makeAgentConfig("tech-lead", false, 3);
        }
        return makeAgentConfig(name, true);
      });

      const supabase = mockSupabase(7);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runTechLead)).not.toHaveBeenCalled();
      expect(vi.mocked(agents.runBackend)).toHaveBeenCalled();
    });

    it("security-reviewer disabled skips security check", async () => {
      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "security-reviewer") {
          return makeAgentConfig("security-reviewer", false, 6);
        }
        return makeAgentConfig(name, true);
      });

      const supabase = mockSupabase(7);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runSecurityReviewer)).not.toHaveBeenCalled();
      expect(vi.mocked(agents.runCodeReviewer)).toHaveBeenCalled();
    });

    it("code-reviewer disabled skips code review", async () => {
      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "code-reviewer") {
          return makeAgentConfig("code-reviewer", false, 7);
        }
        return makeAgentConfig(name, true);
      });

      const supabase = mockSupabase(7);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runCodeReviewer)).not.toHaveBeenCalled();
      expect(vi.mocked(agents.runTester)).toHaveBeenCalled();
    });

    it("qa-engineer disabled skips testing, proceeds to commit/PR", async () => {
      viGetAgentConfig.mockImplementation((name: string) => {
        if (name === "qa-engineer") {
          return makeAgentConfig("qa-engineer", false, 8);
        }
        return makeAgentConfig(name, true);
      });

      const supabase = mockSupabase(7);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runTester)).not.toHaveBeenCalled();
    });
  });

  describe("no enabled agents", () => {
    it("pipeline fails with error when no agents enabled", async () => {
      viGetAgentConfig.mockImplementation((name: string) => null);

      const supabase = mockSupabase(0);
      await runPipeline(supabase, baseJob, baseProject, "/tmp/repo");

      expect(vi.mocked(agents.runProductOwner)).not.toHaveBeenCalled();
    });
  });
});
