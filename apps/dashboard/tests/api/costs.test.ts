import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/headers cookies
// ---------------------------------------------------------------------------

let mockCookieValue: string | undefined;

const mockCookieGet = vi.fn(() =>
  mockCookieValue ? { name: "active_workspace", value: mockCookieValue } : undefined,
);

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: mockCookieGet,
      set: vi.fn(),
      getAll: vi.fn(() => mockCookieValue ? [{ name: "active_workspace", value: mockCookieValue }] : []),
      delete: vi.fn(),
    })
  ),
}));

// ---------------------------------------------------------------------------
// Mock Supabase server client
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockSupabase = {
  auth: {
    getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "test-user" } }, error: null })),
  },
  from: mockFrom,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PERSONAL_ID = "10000000-0000-0000-0000-000000000001";
const WORK_ID = "20000000-0000-0000-0000-000000000002";

function thenable(data: unknown, error: unknown = null) {
  return { then: (resolve: (v: unknown) => void) => resolve({ data, error }) };
}

function queryBuilder(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => thenable(data, error)),
    then: (resolve: (v: unknown) => void) => resolve({ data, error }),
  };
  return builder;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { GET } from "@/app/api/costs/route";

describe("GET /api/costs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns personal costs when no cookie set", async () => {
    mockCookieValue = undefined;

    // call sequence:
    // 1. resolveWorkspaceId → from("workspaces")
    // 2. get ws job ids → from("jobs").select("id").eq("workspace_id", PERSONAL_ID)
    // 3. get ws run ids → from("runs").select("id").in("job_id", [...])
    // 4. usageAgg(t5h) → from("usage_log").select("est_cost_usd").in("run_id", []).gte(...)
    // 5. usageAgg(tMonth) → from("usage_log").select("est_cost_usd").in("run_id", []).gte(...)
    // 6. usage_log 7d → from("usage_log").select("est_cost_usd, run_id").in("run_id", []).gte(...)
    // 7. runs 7d → skipped (no runIds)
    // 8. jobs 7d → from("jobs").select(...).eq("workspace_id", PERSONAL_ID).gte(...).order(...)
    // 9. recent 20 → from("jobs").select(...).eq("workspace_id", PERSONAL_ID).order(...).limit(20)

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      // 1: workspace lookup
      if (callCount === 1) return queryBuilder({ id: PERSONAL_ID });
      // 2: jobs for workspace
      if (callCount === 2) return queryBuilder([{ id: "j1" }, { id: "j2" }]);
      // 3: runs for those jobs
      if (callCount === 3) return queryBuilder([{ id: "r1" }, { id: "r2" }]);
      // 4-6: usage_log queries with run_ids
      if (callCount === 4 || callCount === 5) return queryBuilder([{ est_cost_usd: 0.5 }]);
      // 6: usage_log 7d
      if (callCount === 6) return queryBuilder([
        { est_cost_usd: 0.5, run_id: "r1" },
        { est_cost_usd: 0.3, run_id: "r2" },
      ]);
      // 7: runs 7d
      if (callCount === 7) return queryBuilder([
        { id: "r1", job_id: "j1", agent: "agent-a" },
        { id: "r2", job_id: "j2", agent: "agent-b" },
      ]);
      // 8: jobs 7d
      if (callCount === 8) return queryBuilder([
        { id: "j1", title: "Job 1", status: "pr_opened", created_at: "2026-06-01T00:00:00Z" },
      ]);
      // 9: recent jobs
      return queryBuilder([
        { id: "j1", title: "Job 1", status: "pr_opened", created_at: "2026-06-01T00:00:00Z" },
      ]);
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weekSummary.totalJobs).toBe(1);
    expect(body.weekSummary.totalCostUsd).toBe(0.8);
  });

  it("returns work costs when cookie is work", async () => {
    mockCookieValue = "work";

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return queryBuilder({ id: WORK_ID });
      if (callCount === 2) return queryBuilder([{ id: "j3" }]);
      if (callCount === 3) return queryBuilder([{ id: "r3" }]);
      if (callCount === 4 || callCount === 5) return queryBuilder([{ est_cost_usd: 1.0 }]);
      if (callCount === 6) return queryBuilder([{ est_cost_usd: 1.0, run_id: "r3" }]);
      if (callCount === 7) return queryBuilder([{ id: "r3", job_id: "j3", agent: "agent-c" }]);
      if (callCount === 8) return queryBuilder([
        { id: "j3", title: "Work Job", status: "merged", created_at: "2026-06-01T00:00:00Z" },
      ]);
      return queryBuilder([
        { id: "j3", title: "Work Job", status: "merged", created_at: "2026-06-01T00:00:00Z" },
      ]);
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weekSummary.totalJobs).toBe(1);
    expect(body.weekSummary.totalCostUsd).toBe(1.0);
  });

  it("does not mix personal and work costs", async () => {
    mockCookieValue = undefined;

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return queryBuilder({ id: PERSONAL_ID });
      if (callCount === 2) return queryBuilder([{ id: "j1" }]);
      if (callCount === 3) return queryBuilder([{ id: "r1" }]);
      if (callCount === 4 || callCount === 5) return queryBuilder([{ est_cost_usd: 0.5 }]);
      if (callCount === 6) return queryBuilder([{ est_cost_usd: 0.5, run_id: "r1" }]);
      if (callCount === 7) return queryBuilder([{ id: "r1", job_id: "j1", agent: "agent-a" }]);
      if (callCount === 8) return queryBuilder([
        { id: "j1", title: "Personal Job", status: "queued", created_at: "2026-06-01T00:00:00Z" },
      ]);
      return queryBuilder([
        { id: "j1", title: "Personal Job", status: "queued", created_at: "2026-06-01T00:00:00Z" },
      ]);
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    // Should not contain work data
    expect(body.recentJobs.every((j: { title: string }) => j.title === "Personal Job")).toBe(true);
    expect(body.recentJobs.find((j: { title: string }) => j.title === "Work Job")).toBeUndefined();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
