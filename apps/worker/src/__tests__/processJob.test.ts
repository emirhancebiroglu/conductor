import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../git.js", () => ({
  cloneAndBranch: vi.fn(() =>
    Promise.resolve({ dir: "/tmp/test-repo" }),
  ),
  cleanup: vi.fn(),
}));

vi.mock("../orchestrator.js", () => ({
  runPipeline: vi.fn(() => Promise.resolve()),
}));

vi.mock("../agentConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agentConfig.js")>();
  return {
    ...actual,
    invalidateConfigCache: vi.fn(),
  };
});

import { processJob } from "../processJob.js";
import { invalidateConfigCache } from "../agentConfig.js";
import * as git from "../git.js";
import * as orchestrator from "../orchestrator.js";

const viInvalidateConfigCache = vi.mocked(invalidateConfigCache);
const viCloneAndBranch = vi.mocked(git.cloneAndBranch);
const viCleanup = vi.mocked(git.cleanup);
const viRunPipeline = vi.mocked(orchestrator.runPipeline);

const baseSupabase = {
  from: vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => ({
          data: {
            owner: "test",
            repo: "test-repo",
            default_branch: "main",
          },
          error: null,
        })),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({ data: null, error: null })),
    })),
  })),
};

const baseJob = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  project_id: "proj-1",
  title: "Test Feature",
  description: "A test feature",
  type: "feature",
  lane_preference: "auto",
};

describe("processJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONDUCTOR_GITHUB_TOKEN = "test-token";
  });

  it("invalidateConfigCache called at start of processJob", async () => {
    await processJob(baseSupabase as never, baseJob);

    expect(viInvalidateConfigCache).toHaveBeenCalledOnce();
    expect(viInvalidateConfigCache.mock.invocationCallOrder?.[0]).toBeLessThan(
      viRunPipeline.mock.invocationCallOrder?.[0] ?? Infinity,
    );
  });

  it("current_agent and current_step_message cleared in finally block on success", async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: { owner: "test", repo: "test-repo", default_branch: "main" },
              error: null,
            })),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: vi.fn(() => ({ data: null, error: null })) };
        }),
      })),
    };

    await processJob(supabase as never, baseJob);

    const clearUpdate = updates.find(
      (u) => u.current_agent === null && u.current_step_message === null,
    );
    expect(clearUpdate).toBeDefined();
  });

  it("current_agent and current_step_message cleared in finally block on error", async () => {
    viCloneAndBranch.mockRejectedValueOnce(new Error("clone failed"));

    const updates: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: { owner: "test", repo: "test-repo", default_branch: "main" },
              error: null,
            })),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: vi.fn(() => ({ data: null, error: null })) };
        }),
      })),
    };

    await processJob(supabase as never, baseJob);

    const clearUpdate = updates.find(
      (u) => u.current_agent === null && u.current_step_message === null,
    );
    expect(clearUpdate).toBeDefined();
  });

  it("pipeline still runs when cache invalidation succeeds", async () => {
    viInvalidateConfigCache.mockImplementation(() => {});

    await processJob(baseSupabase as never, baseJob);

    expect(viRunPipeline).toHaveBeenCalledOnce();
  });

  it("cleanup called with repoDir after pipeline completes", async () => {
    await processJob(baseSupabase as never, baseJob);

    expect(viCleanup).toHaveBeenCalledWith("/tmp/test-repo");
  });

  it("throws when project not found", async () => {
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: null,
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
    };

    await expect(processJob(supabase as never, baseJob)).rejects.toThrow(
      "Project not found",
    );
  });

  it("throws when CONDUCTOR_GITHUB_TOKEN is missing", async () => {
    delete process.env.CONDUCTOR_GITHUB_TOKEN;

    await expect(processJob(baseSupabase as never, baseJob)).rejects.toThrow(
      "Missing required env var: CONDUCTOR_GITHUB_TOKEN",
    );
  });
});
