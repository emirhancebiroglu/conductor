import { describe, it, expect, vi } from "vitest";
import { runScheduler, enqueueManualScan } from "../handlers/scheduler.js";

function createMockBoss() {
  const send = vi.fn().mockResolvedValue("job-123");
  const schedule = vi.fn().mockResolvedValue(undefined);
  return { send, schedule };
}

describe("runScheduler", () => {
  it("enqueues enabled repos in priority order", async () => {
    const boss = createMockBoss();

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_pipeline") {
        return {
          select: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "pipe-1", workspace_id: "ws-1", enabled: true, cron: "0 0 * * *" },
            error: null,
          }),
        };
      }
      if (table === "cm_repo") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: "repo-1", pipeline_id: "pipe-1", workspace_id: "ws-1", owner: "test", name: "ms-frontend", default_branch: "main", source: "auto", priority: 10, enabled: true },
              { id: "repo-2", pipeline_id: "pipe-1", workspace_id: "ws-1", owner: "test", name: "ms-backend", default_branch: "main", source: "auto", priority: 50, enabled: true },
              { id: "repo-3", pipeline_id: "pipe-1", workspace_id: "ws-1", owner: "test", name: "ms-infra", default_branch: "main", source: "auto", priority: 100, enabled: true },
            ],
            error: null,
          }),
        };
      }
      return {};
    });

    const supabase = { from: mockFrom };

    await runScheduler(supabase as never, boss as never);

    expect(boss.send).toHaveBeenCalledTimes(3);
    const calls = boss.send.mock.calls as [string, Record<string, unknown>][];
    expect(calls[0]?.[0]).toBe("cm.scan");
    expect(calls[0]?.[1]?.scanId).toBe("repo-1");
    expect(calls[1]?.[1]?.scanId).toBe("repo-2");
    expect(calls[2]?.[1]?.scanId).toBe("repo-3");
  });

  it("skips disabled repos", async () => {
    const boss = createMockBoss();

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_pipeline") {
        return {
          select: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "pipe-1", workspace_id: "ws-1", enabled: true, cron: "0 0 * * *" },
            error: null,
          }),
        };
      }
      if (table === "cm_repo") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: "repo-1", pipeline_id: "pipe-1", workspace_id: "ws-1", owner: "test", name: "ms-frontend", default_branch: "main", source: "auto", priority: 10, enabled: true },
            ],
            error: null,
          }),
        };
      }
      return {};
    });

    const supabase = { from: mockFrom };

    await runScheduler(supabase as never, boss as never);

    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledWith("cm.scan", expect.objectContaining({
      trigger: "schedule",
    }));
  });

  it("skips when pipeline is disabled", async () => {
    const boss = createMockBoss();

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_pipeline") {
        return {
          select: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "pipe-1", workspace_id: "ws-1", enabled: false, cron: "0 0 * * *" },
            error: null,
          }),
        };
      }
      return {};
    });

    const supabase = { from: mockFrom };

    await runScheduler(supabase as never, boss as never);

    expect(boss.send).not.toHaveBeenCalled();
  });

  it("skips when no pipeline exists", async () => {
    const boss = createMockBoss();

    const mockFrom = vi.fn((table: string) => {
      if (table === "cm_pipeline") {
        return {
          select: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
        };
      }
      return {};
    });

    const supabase = { from: mockFrom };

    await runScheduler(supabase as never, boss as never);

    expect(boss.send).not.toHaveBeenCalled();
  });
});

describe("enqueueManualScan", () => {
  it("sends a single scan job with trigger=manual", async () => {
    const boss = createMockBoss();

    const jobId = await enqueueManualScan(boss as never, {
      id: "repo-1",
      owner: "test",
      name: "ms-frontend",
      defaultBranch: "main",
    });

    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledWith("cm.scan", {
      scanId: "repo-1",
      repoOwner: "test",
      repoName: "ms-frontend",
      branch: "main",
      trigger: "manual",
    });
    expect(jobId).toBe("job-123");
  });
});
