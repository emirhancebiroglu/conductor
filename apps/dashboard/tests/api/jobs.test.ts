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

function queryBuilder(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => thenable(data, error)),
    single: vi.fn(() => thenable(data, error)),
    insert: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve({ data, error }),
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

import { GET, POST } from "@/app/api/jobs/route";

describe("GET /api/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns personal jobs when no cookie set", async () => {
    mockCookieValue = undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ id: PERSONAL_ID });
      return queryBuilder([{ id: "j1", project_id: "p1", title: "personal job", workspace_id: PERSONAL_ID }]);
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("personal job");
  });

  it("returns work jobs when cookie is work", async () => {
    mockCookieValue = "work";
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ id: WORK_ID });
      return queryBuilder([{ id: "j2", project_id: "p2", title: "work job", workspace_id: WORK_ID }]);
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("work job");
  });

  it("does not leak work jobs in personal filter", async () => {
    mockCookieValue = undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "workspaces") return queryBuilder({ id: PERSONAL_ID });
      return queryBuilder([{ id: "j1", project_id: "p1", title: "personal job", workspace_id: PERSONAL_ID }]);
    });

    const response = await GET();
    const body = await response.json();

    expect(body.every((j: { title: string }) => j.title === "personal job")).toBe(true);
    expect(body.find((j: { title: string }) => j.title === "work job")).toBeUndefined();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await GET();
    expect(response.status).toBe(401);
  });
});

describe("POST /api/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    type: "feature",
    title: "Test job",
    description: "A test job",
  };

  it("creates job with personal workspace by default", async () => {
    mockCookieValue = undefined;
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "workspaces") return queryBuilder({ id: PERSONAL_ID });
      if (callCount === 2) return queryBuilder({ id: validBody.projectId, workspace_id: PERSONAL_ID });
      return queryBuilder({ id: "new-job-id", workspace_id: PERSONAL_ID });
    });

    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    expect(response.status).toBe(201);
  });

  it("creates job with work workspace when cookie is work", async () => {
    mockCookieValue = "work";
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "workspaces") return queryBuilder({ id: WORK_ID });
      if (callCount === 2) return queryBuilder({ id: validBody.projectId, workspace_id: WORK_ID });
      return queryBuilder({ id: "new-job-id", workspace_id: WORK_ID });
    });

    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    expect(response.status).toBe(201);
  });

  it("returns 400 when project belongs to different workspace", async () => {
    mockCookieValue = "work";
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "workspaces") return queryBuilder({ id: WORK_ID });
      if (callCount === 2) return queryBuilder({ id: validBody.projectId, workspace_id: PERSONAL_ID });
      return queryBuilder({ id: "new-job-id" });
    });

    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("different workspace");
  });

  it("returns 404 when project not found", async () => {
    mockCookieValue = undefined;
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "workspaces") return queryBuilder({ id: PERSONAL_ID });
      if (callCount === 2) return queryBuilder(null);
      return queryBuilder(null);
    });

    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await POST(makeRequest("http://localhost", "POST", validBody));
    expect(response.status).toBe(401);
  });
});
