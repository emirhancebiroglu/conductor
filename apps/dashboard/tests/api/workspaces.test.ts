import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceRowSchema } from "@conductor/core";

// ---------------------------------------------------------------------------
// Mock Supabase server client
// ---------------------------------------------------------------------------

const mockSupabase = {
  auth: {
    getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "test-user" } }, error: null })),
  },
  from: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryBuilder(data: unknown, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error })),
    single: vi.fn(() => Promise.resolve({ data, error })),
  };
  Object.defineProperty(builder, "then", {
    value: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data, error }),
    writable: true,
  });
  return builder;
}

function setupMock(table: string, data: unknown, error: { message: string } | null = null) {
  const builder = makeQueryBuilder(data, error);
  mockSupabase.from.mockReturnValue(builder);
  return builder;
}

function makeRequest(url: string, method = "GET") {
  return new Request(url, { method });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { GET } from "@/app/api/workspaces/route";

describe("GET /api/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const MOCK_ROWS = [
    { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01", name: "Personal", kind: "personal" },
    { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee02", name: "Work", kind: "work" },
  ];

  it("returns 200 with workspace list", async () => {
    setupMock("workspaces", MOCK_ROWS);
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe("Personal");
    expect(body[1].name).toBe("Work");
  });

  it("each row contains id, name, kind", async () => {
    setupMock("workspaces", MOCK_ROWS);
    const response = await GET();
    const body = await response.json();

    for (const row of body) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("kind");
    }
  });

  it("shape validates with WorkspaceRowSchema", async () => {
    setupMock("workspaces", MOCK_ROWS);
    const response = await GET();
    const body = await response.json();

    for (const row of body) {
      const result = WorkspaceRowSchema.pick({ id: true, name: true, kind: true }).safeParse(row);
      expect(result.success).toBe(true);
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns 500 on supabase error", async () => {
    setupMock("workspaces", null, { message: "DB error" });
    const response = await GET();
    expect(response.status).toBe(500);
  });
});
