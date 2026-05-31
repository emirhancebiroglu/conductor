import { describe, it, expect, vi, beforeEach } from "vitest";
import { ALL_AGENTS, RUNNING_JOBS, PROVIDERS } from "@/tests/fixtures/agent-configs";
import type { AgentConfigRow, JobRow, ProviderModelRow } from "@conductor/core";

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
// Helper: create a chainable supabase query builder mock
// ---------------------------------------------------------------------------

function makeQueryBuilder(data: unknown, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error })),
    single: vi.fn(() => Promise.resolve({ data, error })),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
  };
  // Make the builder thenable so `await query` resolves
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
// Helper: convert AgentConfig to row shape
// ---------------------------------------------------------------------------

function toAgentRow(agent: typeof ALL_AGENTS[0]): AgentConfigRow {
  return {
    id: agent.id,
    agent_name: agent.agentName,
    display_name: agent.displayName,
    role: agent.role,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skill_path: agent.skillPath,
    enabled: agent.enabled,
    lane_override: agent.laneOverride,
    order: agent.order,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
  };
}

function toProviderModelRow(pm: typeof PROVIDERS[0]["models"][0]): ProviderModelRow {
  return {
    id: pm.id,
    provider: pm.provider,
    model_id: pm.modelId,
    display_name: pm.displayName,
    capabilities: pm.capabilities,
    available: pm.available,
    created_at: pm.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocking
// ---------------------------------------------------------------------------

import { GET as getAgents } from "@/app/api/agents/route";
import { PUT as putAgent, PATCH as patchToggle } from "@/app/api/agents/[name]/route";
import { GET as getProviders } from "@/app/api/agents/providers/route";

// ---------------------------------------------------------------------------
// Helpers to create Request objects
// ---------------------------------------------------------------------------

function makeRequest(url: string, method = "GET", body?: Record<string, unknown>) {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function makeParams(name: string) {
  return Promise.resolve({ name });
}

// ---------------------------------------------------------------------------
// GET /api/agents
// ---------------------------------------------------------------------------

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });
  });

  it("returns all agents and running jobs", async () => {
    const agentRows = ALL_AGENTS.map(toAgentRow);
    const jobRows = RUNNING_JOBS.map((rj) => ({
      id: rj.jobId,
      title: rj.jobTitle,
      current_agent: rj.agentName,
      started_at: rj.startedAt,
      current_step_message: rj.stepMessage,
    }));

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryBuilder(agentRows);
      return makeQueryBuilder(jobRows);
    });

    const response = await getAgents();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agents).toHaveLength(8);
    expect(body.runningJobs).toHaveLength(2);
    expect(body).toHaveProperty("agents");
    expect(body).toHaveProperty("runningJobs");
  });

  it("returns empty arrays when no data", async () => {
    mockSupabase.from.mockReturnValue(makeQueryBuilder([]));

    const response = await getAgents();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agents).toEqual([]);
    expect(body.runningJobs).toEqual([]);
  });

  it("agents are ordered by order field", async () => {
    const scrambled = [
      ALL_AGENTS[4],
      ALL_AGENTS[1],
      ALL_AGENTS[7],
      ALL_AGENTS[0],
    ].map(toAgentRow);

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const builder = makeQueryBuilder(scrambled);
        return builder;
      }
      return makeQueryBuilder([]);
    });

    const response = await getAgents();
    const body = await response.json();

    expect(body.agents).toHaveLength(4);
    const orders = body.agents.map((a: { order: number }) => a.order);
    expect(orders).toContain(1);
    expect(orders).toContain(2);
    expect(orders).toContain(5);
    expect(orders).toContain(8);
  });

  it("handles supabase error gracefully", async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryBuilder(null, { message: "connection failed" }),
    );

    const response = await getAgents();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("connection failed");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/agents/[name]
// ---------------------------------------------------------------------------

describe("PUT /api/agents/[name]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });
  });

  it("updates display name", async () => {
    const updatedRow = toAgentRow({ ...ALL_AGENTS[0], displayName: "New Name" });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryBuilder({ id: "uuid-1" });
      return makeQueryBuilder(updatedRow);
    });

    const response = await putAgent(
      makeRequest("http://localhost/api/agents/product-owner", "PUT", {
        displayName: "New Name",
      }),
      { params: makeParams("product-owner") },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent.displayName).toBe("New Name");
  });

  it("rejects invalid agent name", async () => {
    const response = await putAgent(
      makeRequest("http://localhost/api/agents/nonexistent", "PUT", {
        displayName: "New Name",
      }),
      { params: makeParams("nonexistent") },
    );

    expect(response.status).toBe(400);
  });

  it("rejects empty system prompt", async () => {
    const response = await putAgent(
      makeRequest("http://localhost/api/agents/product-owner", "PUT", {
        systemPrompt: "",
      }),
      { params: makeParams("product-owner") },
    );

    expect(response.status).toBe(400);
  });

  it("rejects invalid laneOverride", async () => {
    const response = await putAgent(
      makeRequest("http://localhost/api/agents/product-owner", "PUT", {
        laneOverride: "invalid",
      }),
      { params: makeParams("product-owner") },
    );

    expect(response.status).toBe(400);
  });

  it("rejects non-existent model", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "agent_config") {
        return makeQueryBuilder({ id: "uuid-1", provider: "claude", model: "claude-sonnet-4-6" });
      }
      if (table === "provider_models") {
        return makeQueryBuilder(null);
      }
      return makeQueryBuilder(null);
    });

    const response = await putAgent(
      makeRequest("http://localhost/api/agents/product-owner", "PUT", {
        model: "non-existent-model",
      }),
      { params: makeParams("product-owner") },
    );

    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("not available");
  });

  it("partial update only changes specified fields", async () => {
    const updatedRow = toAgentRow({ ...ALL_AGENTS[0], order: 99 });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryBuilder({ id: "uuid-1" });
      return makeQueryBuilder(updatedRow);
    });

    const response = await putAgent(
      makeRequest("http://localhost/api/agents/product-owner", "PUT", {
        order: 99,
      }),
      { params: makeParams("product-owner") },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent.order).toBe(99);
    expect(body.agent.displayName).toBe("Product Owner");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/agents/[name]/toggle
// ---------------------------------------------------------------------------

describe("PATCH /api/agents/[name]/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });
  });

  it("enables a disabled agent", async () => {
    const agentsList = ALL_AGENTS.map((a) => ({
      agent_name: a.agentName,
      enabled: a.agentName === "product-owner" ? false : true,
    }));
    const updatedRow = toAgentRow({ ...ALL_AGENTS[0], enabled: true });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryBuilder(agentsList);
      return makeQueryBuilder(updatedRow);
    });

    const response = await patchToggle(
      makeRequest("http://localhost/api/agents/product-owner", "PATCH"),
      { params: makeParams("product-owner") },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent.enabled).toBe(true);
  });

  it("disables an enabled agent (not the last one)", async () => {
    const agentsList = ALL_AGENTS.map((a) => ({
      agent_name: a.agentName,
      enabled: true,
    }));
    const updatedRow = toAgentRow({ ...ALL_AGENTS[0], enabled: false });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryBuilder(agentsList);
      return makeQueryBuilder(updatedRow);
    });

    const response = await patchToggle(
      makeRequest("http://localhost/api/agents/product-owner", "PATCH"),
      { params: makeParams("product-owner") },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent.enabled).toBe(false);
  });

  it("rejects disabling the last enabled agent", async () => {
    const agentsList = ALL_AGENTS.map((a) => ({
      agent_name: a.agentName,
      enabled: a.agentName === "product-owner",
    }));

    mockSupabase.from.mockReturnValue(makeQueryBuilder(agentsList));

    const response = await patchToggle(
      makeRequest("http://localhost/api/agents/product-owner", "PATCH"),
      { params: makeParams("product-owner") },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("at least one agent must be enabled");
  });

  it("returns 404 for nonexistent agent", async () => {
    mockSupabase.from.mockImplementation(() => {
      return makeQueryBuilder([]);
    });

    const response = await patchToggle(
      makeRequest("http://localhost/api/agents/product-owner/toggle", "PATCH"),
      { params: makeParams("product-owner") },
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/agents/providers
// ---------------------------------------------------------------------------

describe("GET /api/agents/providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });
  });

  it("returns providers grouped correctly", async () => {
    const modelRows = PROVIDERS.flatMap((p) =>
      p.models.map(toProviderModelRow),
    );

    mockSupabase.from.mockReturnValue(makeQueryBuilder(modelRows));

    const response = await getProviders(
      makeRequest("http://localhost/api/agents/providers"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providers).toHaveLength(2);

    const claude = body.providers.find((p: { name: string }) => p.name === "claude");
    const opencode = body.providers.find((p: { name: string }) => p.name === "opencode");

    expect(claude.models).toHaveLength(4);
    expect(opencode.models).toHaveLength(2);
    expect(claude.models[0]).toHaveProperty("displayName");
    expect(claude.models[0]).toHaveProperty("capabilities");
  });

  it("filters unavailable models", async () => {
    const allModelRows = PROVIDERS.flatMap((p) =>
      p.models.map((m) => {
        const row = toProviderModelRow(m);
        if (m.modelId === "claude-sonnet-4-6") {
          return { ...row, available: false };
        }
        return row;
      }),
    );
    const availableModelRows = allModelRows.filter((m) => m.available);

    mockSupabase.from.mockImplementation(() => makeQueryBuilder(availableModelRows));

    const response = await getProviders(
      makeRequest("http://localhost/api/agents/providers"),
    );
    const body = await response.json();

    const allModels = body.providers.flatMap(
      (p: { models: { modelId: string }[] }) => p.models,
    );
    expect(allModels).toHaveLength(5);
    const unavailableModel = allModels.find(
      (m: { modelId: string }) => m.modelId === "claude-sonnet-4-6",
    );
    expect(unavailableModel).toBeUndefined();
  });

  it("returns empty when no providers", async () => {
    mockSupabase.from.mockReturnValue(makeQueryBuilder([]));

    const response = await getProviders(
      makeRequest("http://localhost/api/agents/providers"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providers).toEqual([]);
  });
});
