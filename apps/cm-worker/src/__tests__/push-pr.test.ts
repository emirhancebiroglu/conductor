import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPullsCreate } = vi.hoisted(() => ({
  mockPullsCreate: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => ({
    rest: {
      pulls: {
        create: mockPullsCreate,
      },
    },
  })),
}));

import { handlePushAndPR } from "../handlers/push-pr.js";

function createMockGitOps() {
  const push = vi.fn().mockResolvedValue(undefined);
  return {
    cloneToTemp: vi.fn().mockResolvedValue("/tmp/workdir"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    commitAll: vi.fn().mockResolvedValue(undefined),
    push,
    pushBranch: push,
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scan-001",
    repo_id: "repo-001",
    workspace_id: "ws-001",
    status: "verified",
    ...overrides,
  };
}

function createMockRepoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-001",
    owner: "test-owner",
    name: "ms-test-repo",
    default_branch: "main",
    ...overrides,
  };
}

beforeEach(() => {
  mockPullsCreate.mockReset();
});

describe("handlePushAndPR", () => {
  it("opens a PR with correct head and base branches", async () => {
    mockPullsCreate.mockResolvedValue({
      data: { html_url: "https://github.com/test-owner/ms-test-repo/pull/1" },
    });

    const updates: Record<string, unknown>[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "cm_scan") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: createMockScanRow(), error: null }),
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
            single: vi.fn().mockResolvedValue({ data: createMockRepoRow({ pipeline_id: "pipe-001" }), error: null }),
          };
        }
        if (table === "cm_pipeline") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { fix_branch: "checkmarx-auto" }, error: null }),
          };
        }
        return {};
      }),
    };

    const gitOps = createMockGitOps();
    await handlePushAndPR(supabase as never, "scan-001", "https://github.com/test-owner/ms-test-repo.git", gitOps as never);

    const callArg = mockPullsCreate.mock.calls[0]?.[0] as Record<string, string>;
    expect(callArg.owner).toBe("test-owner");
    expect(callArg.repo).toBe("ms-test-repo");
    expect(callArg.title).toContain("[CM]");
    expect(callArg.body).toContain("Checkmarx");
    expect(callArg.head).toBe("checkmarx-auto");
    expect(callArg.base).toBe("main");

    const prOpenedUpdate = updates.find((u) => u.status === "pr_opened");
    expect(prOpenedUpdate).toBeDefined();
    if (prOpenedUpdate) {
      expect(prOpenedUpdate.pr_url).toBe("https://github.com/test-owner/ms-test-repo/pull/1");
    }
  });

  it("stores pr_url in cm_scan", async () => {
    mockPullsCreate.mockResolvedValue({
      data: { html_url: "https://github.com/test-owner/ms-test-repo/pull/42" },
    });

    let finalUpdate: Record<string, unknown> = {};
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "cm_scan") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: createMockScanRow(), error: null }),
            update: vi.fn((payload: Record<string, unknown>) => {
              finalUpdate = payload;
              return { eq: vi.fn().mockReturnThis() };
            }),
          };
        }
        if (table === "cm_repo") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: createMockRepoRow({ pipeline_id: "pipe-001" }), error: null }),
          };
        }
        if (table === "cm_pipeline") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { fix_branch: "checkmarx-auto" }, error: null }),
          };
        }
        return {};
      }),
    };

    const gitOps = createMockGitOps();
    await handlePushAndPR(supabase as never, "scan-001", "https://github.com/test-owner/ms-test-repo.git", gitOps as never);

    expect(finalUpdate.status).toBe("pr_opened");
    expect(finalUpdate.pr_url as string).toBe("https://github.com/test-owner/ms-test-repo/pull/42");
  });

  it("skips when scan cannot transition to pr_opening", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "cm_scan") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: createMockScanRow({ status: "pr_opened" }), error: null }),
            update: vi.fn(),
          };
        }
        return {};
      }),
    };

    const gitOps = createMockGitOps();
    await handlePushAndPR(supabase as never, "scan-001", "git@github.com:test/repo.git", gitOps as never);

    expect(mockPullsCreate).not.toHaveBeenCalled();
  });
});
