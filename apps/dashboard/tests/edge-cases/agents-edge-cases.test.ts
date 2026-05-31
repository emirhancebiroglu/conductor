import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AgentName } from "@conductor/core";

// ---------------------------------------------------------------------------
// Mocks (must be before imports)
// ---------------------------------------------------------------------------

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAuth(user: { id: string } | null) {
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
}

function createRequestWithParams(method: string, name: string, body?: Record<string, unknown>) {
  const url = new URL(`http://localhost:3000/api/agents/${name}`);
  const req = new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { request: req, params: Promise.resolve({ name }) };
}

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    agent_name: "product-owner",
    display_name: "Product Owner",
    role: "Role for product-owner",
    provider: "claude",
    model: "claude-sonnet-4-6",
    system_prompt: "You are a product owner...",
    skill_path: null,
    enabled: true,
    lane_override: null,
    order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProviderModelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    provider: "claude",
    model_id: "claude-sonnet-4-6",
    display_name: "Claude Sonnet 4.6",
    capabilities: { context_window: 200000 },
    available: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// Mock chain builders matching exact Supabase query patterns
// -----------------------------------------------------------------------

// Pattern: .select("id").eq("agent_name", name).maybeSingle()
function makeMaybeSingleChain(data: unknown) {
  const eqResult = { maybeSingle: vi.fn(() => ({ data, error: null })) };
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => eqResult),
    })),
  };
}

// Pattern: .select("id").eq("provider", p).eq("model", m).maybeSingle()
function makeDoubleEqMaybeSingleChain(data: unknown) {
  const eq2Result = { maybeSingle: vi.fn(() => ({ data, error: null })) };
  const eq1Result = { eq: vi.fn(() => eq2Result) };
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => eq1Result),
    })),
  };
}

// Pattern: .update(payload).eq("agent_name", name).select().single()
function makeUpdateChain(data: unknown) {
  const singleResult = { data, error: null };
  const selectResult = { single: vi.fn(() => singleResult) };
  const eqResult = { select: vi.fn(() => selectResult) };
  return {
    update: vi.fn(() => ({
      eq: vi.fn(() => eqResult),
    })),
  };
}

// Pattern: .select("agent_name, enabled") -- no eq, returns array
function makeSelectAllChain(data: unknown[]) {
  return {
    select: vi.fn(() => ({
      order: vi.fn(() => ({ data, error: null })),
    })),
  };
}

// Pattern: .select("*").eq("available", true) -- returns array
function makeProviderSelectChain(data: unknown[]) {
  const eqResult = { data, error: null };
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => eqResult),
    })),
  };
}

// Pattern: .insert(payload).select().single()
function makeInsertChain(data: unknown) {
  const singleResult = { data, error: null };
  const selectResult = { single: vi.fn(() => singleResult) };
  return {
    insert: vi.fn(() => ({
      select: vi.fn(() => selectResult),
    })),
  };
}

// Combined builder for agent_config table (supports both select and update)
function makeAgentConfigBuilder(opts: {
  maybeSingleData?: unknown;
  updateData?: unknown;
  selectAllData?: unknown[];
} = {}) {
  const builder: Record<string, unknown> = {};

  // .select("id").eq().maybeSingle()
  builder.select = vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(() => ({ data: opts.maybeSingleData ?? null, error: null })),
    })),
  }));

  // .update().eq().select().single()
  builder.update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => ({ data: opts.updateData ?? null, error: null })),
      })),
    })),
  }));

  return builder;
}

// Combined builder for provider_models table
function makeProviderModelBuilder(opts: {
  maybeSingleData?: unknown;
  doubleEqMaybeSingleData?: unknown;
  insertData?: unknown;
  selectAllData?: unknown[];
} = {}) {
  const builder: Record<string, unknown> = {};

  // .select("id").eq().maybeSingle() OR .select("id").eq().eq().maybeSingle()
  const eq1Result = {
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(() => ({ data: opts.doubleEqMaybeSingleData ?? opts.maybeSingleData ?? null, error: null })),
    })),
    maybeSingle: vi.fn(() => ({ data: opts.maybeSingleData ?? null, error: null })),
  };
  builder.select = vi.fn(() => ({
    eq: vi.fn(() => eq1Result),
  }));

  // .insert().select().single()
  builder.insert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(() => ({ data: opts.insertData ?? null, error: null })),
    })),
  }));

  return builder;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent management edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Toggle API prevents disabling last enabled agent
  // -----------------------------------------------------------------------

  describe("toggle last-agent guard", () => {
    it("rejects disabling the last enabled agent with 400", async () => {
      mockAuth({ id: "user-1" });

      const agentsList = [
        { agent_name: "product-owner" as AgentName, enabled: true },
        { agent_name: "codebase-analyst" as AgentName, enabled: false },
        { agent_name: "tech-lead" as AgentName, enabled: false },
        { agent_name: "backend-dev" as AgentName, enabled: false },
        { agent_name: "frontend-dev" as AgentName, enabled: false },
        { agent_name: "security-reviewer" as AgentName, enabled: false },
        { agent_name: "code-reviewer" as AgentName, enabled: false },
        { agent_name: "qa-engineer" as AgentName, enabled: false },
      ];

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return {
            select: vi.fn(() => ({ data: agentsList, error: null })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() => ({ data: null, error: null })),
                })),
              })),
            })),
          };
        }
        return makeAgentConfigBuilder();
      });

      const { request, params } = createRequestWithParams("PATCH", "product-owner");
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PATCH(request, { params } as never);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("at least one agent must be enabled");
    });

    it("allows disabling when multiple agents are enabled", async () => {
      mockAuth({ id: "user-1" });

      const agentsList = [
        { agent_name: "product-owner" as AgentName, enabled: true },
        { agent_name: "codebase-analyst" as AgentName, enabled: true },
        { agent_name: "tech-lead" as AgentName, enabled: true },
        { agent_name: "backend-dev" as AgentName, enabled: false },
        { agent_name: "frontend-dev" as AgentName, enabled: false },
        { agent_name: "security-reviewer" as AgentName, enabled: false },
        { agent_name: "code-reviewer" as AgentName, enabled: false },
        { agent_name: "qa-engineer" as AgentName, enabled: false },
      ];

      const updatedRow = makeAgentRow({ agent_name: "product-owner", enabled: false });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return {
            select: vi.fn(() => ({ data: agentsList, error: null })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() => ({ data: updatedRow, error: null })),
                })),
              })),
            })),
          };
        }
        return makeAgentConfigBuilder();
      });

      const { request, params } = createRequestWithParams("PATCH", "product-owner");
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PATCH(request, { params } as never);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.agent.enabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 2. System prompt validation
  // -----------------------------------------------------------------------

  describe("system prompt validation", () => {
    it("rejects empty system prompt with 400", async () => {
      mockAuth({ id: "user-1" });
      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder());

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        systemPrompt: "",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
    });

    it("rejects system prompt shorter than 10 characters with 400", async () => {
      mockAuth({ id: "user-1" });
      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder());

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        systemPrompt: "Short",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.issues?.systemPrompt).toBeDefined();
    });

    it("accepts valid system prompt (10+ chars) with 200", async () => {
      mockAuth({ id: "user-1" });
      const validPrompt = "This is a valid system prompt text";
      const updatedRow = makeAgentRow({ agent_name: "product-owner", system_prompt: validPrompt });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return makeAgentConfigBuilder({
            maybeSingleData: { id: "550e8400-e29b-41d4-a716-446655440000" },
            updateData: updatedRow,
          });
        }
        return makeProviderModelBuilder();
      });

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        systemPrompt: validPrompt,
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.agent.systemPrompt).toBe(validPrompt);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Model validation against provider_models
  // -----------------------------------------------------------------------

  describe("model validation", () => {
    it("rejects model that does not exist in provider_models with 400", async () => {
      mockAuth({ id: "user-1" });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return makeAgentConfigBuilder({
            maybeSingleData: { id: "uuid-1", provider: "claude", model: "claude-sonnet-4-6" },
          });
        }
        if (table === "provider_models") {
          // .select("id").eq("provider", p).eq("model", m).maybeSingle()
          return makeDoubleEqMaybeSingleChain(null);
        }
        return makeAgentConfigBuilder();
      });

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        model: "nonexistent-model",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("not available");
    });

    it("accepts model that exists in provider_models with 200", async () => {
      mockAuth({ id: "user-1" });
      const updatedRow = makeAgentRow({ agent_name: "product-owner", model: "claude-sonnet-4-6" });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return makeAgentConfigBuilder({
            maybeSingleData: { id: "uuid-1", provider: "claude", model: "old-model" },
            updateData: updatedRow,
          });
        }
        if (table === "provider_models") {
          return makeDoubleEqMaybeSingleChain({ id: "pm-1" });
        }
        return makeAgentConfigBuilder();
      });

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        model: "claude-sonnet-4-6",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.agent.model).toBe("claude-sonnet-4-6");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Invalid agent name in URL
  // -----------------------------------------------------------------------

  describe("invalid agent name", () => {
    it("returns 400 for invalid agent name format", async () => {
      mockAuth({ id: "user-1" });

      const { request, params } = createRequestWithParams("PUT", "this-is-not-a-valid-agent-name", {
        displayName: "Test",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid agent name");
    });

    it("returns 400 for PATCH with invalid agent name", async () => {
      mockAuth({ id: "user-1" });

      const { request, params } = createRequestWithParams("PATCH", "invalid_name_with_underscore");
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PATCH(request, { params } as never);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid agent name");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Order field validation
  // -----------------------------------------------------------------------

  describe("order field validation", () => {
    it("rejects non-integer order (3.5) with 400", async () => {
      mockAuth({ id: "user-1" });
      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder());

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        order: 3.5,
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.issues?.order).toBeDefined();
    });

    it("accepts valid integer order with 200", async () => {
      mockAuth({ id: "user-1" });
      const updatedRow = makeAgentRow({ agent_name: "product-owner", order: 1 });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return makeAgentConfigBuilder({
            maybeSingleData: { id: "550e8400-e29b-41d4-a716-446655440000" },
            updateData: updatedRow,
          });
        }
        return makeProviderModelBuilder();
      });

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        order: 1,
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.agent.order).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Concurrent save behavior (last-write-wins)
  // -----------------------------------------------------------------------

  describe("concurrent save behavior", () => {
    it("last write wins without crash or corruption", async () => {
      mockAuth({ id: "user-1" });

      const updates: Record<string, unknown>[] = [];
      const baseRow = makeAgentRow({ agent_name: "product-owner" });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => ({ data: { id: "uuid-1" }, error: null })),
              })),
            })),
            update: vi.fn((patch: Record<string, unknown>) => {
              updates.push(patch);
              return {
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn(() => ({
                      data: { ...baseRow, ...patch },
                      error: null,
                    })),
                  })),
                })),
              };
            }),
          };
        }
        return makeProviderModelBuilder();
      });

      const handler = await import("@/app/api/agents/[name]/route");

      const req1 = createRequestWithParams("PUT", "product-owner", {
        displayName: "First Writer",
      });
      const req2 = createRequestWithParams("PUT", "product-owner", {
        displayName: "Second Writer",
      });

      const p1 = handler.PUT(req1.request, { params: req1.params } as never);
      const p2 = handler.PUT(req2.request, { params: req2.params } as never);

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      expect(updates.length).toBe(2);
    });

    it("handles rapid sequential saves without data corruption", async () => {
      mockAuth({ id: "user-1" });

      const updates: Record<string, unknown>[] = [];
      const baseRow = makeAgentRow({ agent_name: "product-owner" });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => ({ data: { id: "uuid-1" }, error: null })),
              })),
            })),
            update: vi.fn((patch: Record<string, unknown>) => {
              updates.push({ ...patch });
              return {
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn(() => ({
                      data: { ...baseRow, ...patch },
                      error: null,
                    })),
                  })),
                })),
              };
            }),
          };
        }
        return makeProviderModelBuilder();
      });

      const handler = await import("@/app/api/agents/[name]/route");

      for (let i = 0; i < 5; i++) {
        const { request, params } = createRequestWithParams("PUT", "product-owner", {
          displayName: `Update ${i}`,
        });
        const response = await handler.PUT(request, { params } as never);
        expect(response.status).toBe(200);
      }

      expect(updates.length).toBe(5);
      expect(updates[4]?.display_name).toBe("Update 4");
    });
  });

  // -----------------------------------------------------------------------
  // 7. Provider management API validates input
  // -----------------------------------------------------------------------

  describe("provider management API validation", () => {
    it("rejects POST with missing required fields with 400", async () => {
      mockAuth({ id: "user-1" });

      const request = new NextRequest("http://localhost:3000/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "claude" }),
      });

      const handler = await import("@/app/api/agents/providers/route");
      const response = await handler.POST(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.issues).toBeDefined();
      expect(json.issues.modelId).toBeDefined();
      expect(json.issues.displayName).toBeDefined();
    });

    it("rejects POST with empty string fields with 400", async () => {
      mockAuth({ id: "user-1" });

      const request = new NextRequest("http://localhost:3000/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "", modelId: "", displayName: "" }),
      });

      const handler = await import("@/app/api/agents/providers/route");
      const response = await handler.POST(request);

      expect(response.status).toBe(400);
    });

    it("rejects POST with duplicate (provider, model_id) with 409", async () => {
      mockAuth({ id: "user-1" });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "provider_models") {
          return makeDoubleEqMaybeSingleChain({ id: "existing-pm-id" });
        }
        return makeProviderModelBuilder();
      });

      const request = new NextRequest("http://localhost:3000/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude",
          modelId: "claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6",
        }),
      });

      const handler = await import("@/app/api/agents/providers/route");
      const response = await handler.POST(request);

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error).toContain("already exists");
    });

    it("accepts valid POST with 201", async () => {
      mockAuth({ id: "user-1" });
      const newRow = makeProviderModelRow({
        provider: "claude",
        model_id: "new-model",
        display_name: "New Model",
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "provider_models") {
          const eq1Result = {
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: null, error: null })),
            })),
          };
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => eq1Result),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => ({ data: newRow, error: null })),
              })),
            })),
          };
        }
        return makeProviderModelBuilder();
      });

      const request = new NextRequest("http://localhost:3000/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude",
          modelId: "new-model",
          displayName: "New Model",
        }),
      });

      const handler = await import("@/app/api/agents/providers/route");
      const response = await handler.POST(request);

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.model.modelId).toBe("new-model");
      expect(json.model.provider).toBe("claude");
    });

    it("defaults capabilities to empty object when not provided", async () => {
      mockAuth({ id: "user-1" });
      const newRow = makeProviderModelRow({
        provider: "opencode",
        model_id: "deepseek-v4-flash",
        display_name: "DeepSeek V4 Flash",
        capabilities: {},
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "provider_models") {
          const eq1Result = {
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: null, error: null })),
            })),
          };
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => eq1Result),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => ({ data: newRow, error: null })),
              })),
            })),
          };
        }
        return makeProviderModelBuilder();
      });

      const request = new NextRequest("http://localhost:3000/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "opencode",
          modelId: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
        }),
      });

      const handler = await import("@/app/api/agents/providers/route");
      const response = await handler.POST(request);

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.model.capabilities).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // 8. Unauthorized access
  // -----------------------------------------------------------------------

  describe("unauthorized access", () => {
    it("returns 401 for PUT without auth", async () => {
      mockAuth(null);

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        displayName: "Test",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 401 for PATCH without auth", async () => {
      mockAuth(null);

      const { request, params } = createRequestWithParams("PATCH", "product-owner");
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PATCH(request, { params } as never);

      expect(response.status).toBe(401);
    });

    it("returns 401 for providers POST without auth", async () => {
      mockAuth(null);

      const request = new NextRequest("http://localhost:3000/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude",
          modelId: "test",
          displayName: "Test",
        }),
      });

      const handler = await import("@/app/api/agents/providers/route");
      const response = await handler.POST(request);

      expect(response.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Agent not found
  // -----------------------------------------------------------------------

  describe("agent not found", () => {
    it("returns 404 for PUT on non-existent agent", async () => {
      mockAuth({ id: "user-1" });

      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder({ maybeSingleData: null }));

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        displayName: "Test",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe("Agent not found");
    });

    it("returns 404 for PATCH on non-existent agent", async () => {
      mockAuth({ id: "user-1" });

      mockSupabase.from.mockReturnValue({
        select: vi.fn(() => ({ data: [], error: null })),
      });

      const { request, params } = createRequestWithParams("PATCH", "product-owner");
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PATCH(request, { params } as never);

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe("Agent not found");
    });
  });

  // -----------------------------------------------------------------------
  // 10. Invalid JSON body
  // -----------------------------------------------------------------------

  describe("invalid JSON body", () => {
    it("returns 400 for PUT with invalid JSON", async () => {
      mockAuth({ id: "user-1" });

      const request = new NextRequest("http://localhost:3000/api/agents/product-owner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not valid json{{{",
      });

      const params = Promise.resolve({ name: "product-owner" });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid JSON");
    });

    it("returns 400 for providers POST with invalid JSON", async () => {
      mockAuth({ id: "user-1" });

      const request = new NextRequest("http://localhost:3000/api/agents/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "broken json",
      });

      const handler = await import("@/app/api/agents/providers/route");
      const response = await handler.POST(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid JSON");
    });
  });

  // -----------------------------------------------------------------------
  // 11. Lane override validation
  // -----------------------------------------------------------------------

  describe("lane override validation", () => {
    it("rejects invalid laneOverride value with 400", async () => {
      mockAuth({ id: "user-1" });
      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder());

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        laneOverride: "invalid-lane",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
    });

    it("accepts valid laneOverride values", async () => {
      mockAuth({ id: "user-1" });
      const updatedRow = makeAgentRow({ agent_name: "product-owner", lane_override: "cheap" });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return makeAgentConfigBuilder({
            maybeSingleData: { id: "550e8400-e29b-41d4-a716-446655440000" },
            updateData: updatedRow,
          });
        }
        return makeProviderModelBuilder();
      });

      const validLanes = ["cheap", "premium", null];

      for (const lane of validLanes) {
        const { request, params } = createRequestWithParams("PUT", "product-owner", {
          laneOverride: lane,
        });
        const handler = await import("@/app/api/agents/[name]/route");
        const response = await handler.PUT(request, { params } as never);

        expect(response.status, `laneOverride "${lane}" should be valid`).toBe(200);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 12. Display name and role validation
  // -----------------------------------------------------------------------

  describe("display name and role validation", () => {
    it("rejects empty displayName with 400", async () => {
      mockAuth({ id: "user-1" });
      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder());

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        displayName: "",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
    });

    it("rejects empty role with 400", async () => {
      mockAuth({ id: "user-1" });
      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder());

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        role: "",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // 13. Provider validation
  // -----------------------------------------------------------------------

  describe("provider validation", () => {
    it("rejects empty provider with 400", async () => {
      mockAuth({ id: "user-1" });
      mockSupabase.from.mockReturnValue(makeAgentConfigBuilder());

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        provider: "",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // 14. skillPath nullable handling
  // -----------------------------------------------------------------------

  describe("skillPath nullable handling", () => {
    it("accepts null skillPath", async () => {
      mockAuth({ id: "user-1" });
      const updatedRow = makeAgentRow({ agent_name: "product-owner", skill_path: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return makeAgentConfigBuilder({
            maybeSingleData: { id: "550e8400-e29b-41d4-a716-446655440000" },
            updateData: updatedRow,
          });
        }
        return makeProviderModelBuilder();
      });

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        skillPath: null,
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(200);
    });

    it("accepts valid string skillPath", async () => {
      mockAuth({ id: "user-1" });
      const updatedRow = makeAgentRow({ agent_name: "product-owner", skill_path: "skills/product-owner/SKILL.md" });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "agent_config") {
          return makeAgentConfigBuilder({
            maybeSingleData: { id: "550e8400-e29b-41d4-a716-446655440000" },
            updateData: updatedRow,
          });
        }
        return makeProviderModelBuilder();
      });

      const { request, params } = createRequestWithParams("PUT", "product-owner", {
        skillPath: "skills/product-owner/SKILL.md",
      });
      const handler = await import("@/app/api/agents/[name]/route");
      const response = await handler.PUT(request, { params } as never);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.agent.skillPath).toBe("skills/product-owner/SKILL.md");
    });
  });
});
