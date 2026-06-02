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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function thenable(data: unknown, error: unknown = null) {
  return { then: (resolve: (v: unknown) => void) => resolve({ data, error }) };
}

function queryBuilder(returns: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => thenable(returns.data, returns.error)),
    single: vi.fn(() => thenable(returns.data, returns.error)),
    insert: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(returns),
  };
  return builder;
}

function makeRequest(url: string, method = "GET", body?: Record<string, unknown>) {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { GET, POST } from "@/app/api/projects/route";

describe("GET /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns personal projects when no cookie set", async () => {
    mockCookieValue = undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ data: { id: PERSONAL_ID }, error: null });
      return queryBuilder({ data: [{ id: "a1", owner: "user", repo: "personal-repo", workspace_id: PERSONAL_ID, default_branch: "main", created_at: "2026-01-01T00:00:00Z" }], error: null });
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].repo).toBe("personal-repo");
  });

  it("returns work projects when cookie is work", async () => {
    mockCookieValue = "work";
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ data: { id: WORK_ID }, error: null });
      return queryBuilder({ data: [{ id: "b1", owner: "user", repo: "work-repo", workspace_id: WORK_ID, default_branch: "main", created_at: "2026-01-01T00:00:00Z" }], error: null });
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].repo).toBe("work-repo");
  });

  it("does not leak work projects in personal filter", async () => {
    mockCookieValue = undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ data: { id: PERSONAL_ID }, error: null });
      return queryBuilder({ data: [{ id: "a1", owner: "user", repo: "personal-repo", workspace_id: PERSONAL_ID, default_branch: "main", created_at: "2026-01-01T00:00:00Z" }], error: null });
    });

    const response = await GET();
    const body = await response.json();

    expect(body.every((p: { repo: string }) => p.repo === "personal-repo")).toBe(true);
    expect(body.find((p: { repo: string }) => p.repo === "work-repo")).toBeUndefined();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await GET();
    expect(response.status).toBe(401);
  });
});

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = { owner: "test", repo: "new-repo" };

  it("creates project with personal workspace by default", async () => {
    mockCookieValue = undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ data: { id: PERSONAL_ID }, error: null });
      return queryBuilder({ data: null, error: null });
    });

    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    expect(response.status).toBe(201);
  });

  it("creates project with work workspace when cookie is work", async () => {
    mockCookieValue = "work";
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ data: { id: WORK_ID }, error: null });
      return queryBuilder({ data: null, error: null });
    });

    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    expect(response.status).toBe(201);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    expect(response.status).toBe(401);
  });
});
