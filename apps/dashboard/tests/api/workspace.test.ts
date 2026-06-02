import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_WORKSPACE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ---------------------------------------------------------------------------
// Mock next/headers cookies
// ---------------------------------------------------------------------------

function createMockCookieStore(initialValue?: string) {
  let value = initialValue;
  return {
    get: vi.fn(() => (value ? { name: "active_workspace", value } : undefined)),
    set: vi.fn(),
    getAll: vi.fn(() => (value ? [{ name: "active_workspace", value }] : [])),
    delete: vi.fn(),
  };
}

let mockCookieStore = createMockCookieStore();

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

const mockSupabase = {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { getActiveWorkspaceKind, resolveWorkspaceId, getWorkspaceCookie, setWorkspaceCookie } from "@/lib/workspace";

describe("getActiveWorkspaceKind", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'personal' when cookie is missing", async () => {
    mockCookieStore = createMockCookieStore();
    const kind = await getActiveWorkspaceKind();
    expect(kind).toBe("personal");
  });

  it("returns 'work' when cookie is work", async () => {
    mockCookieStore = createMockCookieStore("work");
    const kind = await getActiveWorkspaceKind();
    expect(kind).toBe("work");
  });

  it("returns 'personal' for garbage cookie value", async () => {
    mockCookieStore = createMockCookieStore("garbage");
    const kind = await getActiveWorkspaceKind();
    expect(kind).toBe("personal");
  });
});

describe("resolveWorkspaceId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct id for given kind", async () => {
    setupMock("workspaces", { id: MOCK_WORKSPACE_ID });
    const id = await resolveWorkspaceId(mockSupabase as never, "personal");
    expect(id).toBe(MOCK_WORKSPACE_ID);
  });

  it("falls back to personal when kind lookup fails", async () => {
    const builder = makeQueryBuilder(null, { message: "Not found" });
    const fallbackBuilder = makeQueryBuilder({ id: MOCK_WORKSPACE_ID });

    mockSupabase.from
      .mockReturnValueOnce(builder)
      .mockReturnValueOnce(fallbackBuilder);

    const id = await resolveWorkspaceId(mockSupabase as never, "work");
    expect(id).toBe(MOCK_WORKSPACE_ID);
  });
});

describe("getWorkspaceCookie (client)", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "document", {
      value: { cookie: "" },
      writable: true,
      configurable: true,
    });
  });

  it("returns 'personal' when no cookie set", () => {
    document.cookie = "";
    expect(getWorkspaceCookie()).toBe("personal");
  });

  it("reads cookie value", () => {
    document.cookie = "active_workspace=work";
    expect(getWorkspaceCookie()).toBe("work");
  });

  it("returns 'personal' for garbage cookie", () => {
    document.cookie = "active_workspace=garbage";
    expect(getWorkspaceCookie()).toBe("personal");
  });
});

describe("setWorkspaceCookie (client)", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "document", {
      value: { cookie: "" },
      writable: true,
      configurable: true,
    });
  });

  it("sets cookie with correct value", () => {
    setWorkspaceCookie("work");
    expect(document.cookie).toContain("active_workspace=work");
    expect(document.cookie).toContain("path=/");
  });

  it("overwrites existing cookie", () => {
    document.cookie = "active_workspace=personal";
    setWorkspaceCookie("work");
    expect(document.cookie).toContain("active_workspace=work");
  });
});
