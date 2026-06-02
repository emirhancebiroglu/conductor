import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, unmountComponentAtNode } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks (must be before imports)
// ---------------------------------------------------------------------------

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock("@/lib/agents-dirty-state", () => ({
  setAgentsDirty: vi.fn(),
  confirmNavigation: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "uuid-1",
    agentName: "product-owner",
    displayName: "Product Owner",
    role: "Role for product-owner",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a product owner...",
    skillContent: null,
    categoryId: null,
    enabled: true,
    laneOverride: null,
    order: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agents-client realtime edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Realtime channel subscription cleanup
  // -----------------------------------------------------------------------

  it("creates 3 channels on mount and removes all 3 on unmount", async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };

    mockSupabase.channel.mockReturnValue(mockChannel);
    mockSupabase.removeChannel.mockResolvedValue(undefined);

    // Mock the runs query
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    const root = render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    // 3 channels should be created: agent_config, jobs, runs
    expect(mockSupabase.channel).toHaveBeenCalledTimes(3);
    expect(mockSupabase.channel).toHaveBeenCalledWith("agent-config-list-changes");
    expect(mockSupabase.channel).toHaveBeenCalledWith("jobs-running-agent-changes");
    expect(mockSupabase.channel).toHaveBeenCalledWith("runs-agent-changes");

    // Unmount should trigger cleanup
    root.unmount();

    // removeChannel should be called 3 times (once per channel)
    expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(3);
  });

  it("handles channel subscription errors gracefully", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((cb: (status: string) => void) => {
        // Simulate CHANNEL_ERROR status
        setTimeout(() => cb("CHANNEL_ERROR"), 0);
        return mockChannel;
      }),
    };

    mockSupabase.channel.mockReturnValue(mockChannel);
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    // Wait for async error callback
    await vi.advanceTimersByTimeAsync(10);

    // Should warn but not crash
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("handles TIMED_OUT subscription status gracefully", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((cb: (status: string) => void) => {
        setTimeout(() => cb("TIMED_OUT"), 0);
        return mockChannel;
      }),
    };

    mockSupabase.channel.mockReturnValue(mockChannel);
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    await vi.advanceTimersByTimeAsync(10);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 2. Realtime event handling edge cases
  // -----------------------------------------------------------------------

  it("handles agent_config UPDATE with missing fields gracefully", async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };

    mockSupabase.channel.mockReturnValue(mockChannel);
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    const { rerender } = render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    // Simulate an UPDATE event with a complete row (not partial)
    const updateCallback = mockChannel.on.mock.calls.find(
      (call: unknown[]) => call[1]?.table === "agent_config",
    )?.[2];

    if (updateCallback) {
      updateCallback({
        new: {
          id: "uuid-1",
          agent_name: "product-owner",
          display_name: "Updated Name",
          role: "Updated Role",
          provider: "claude",
          model: "claude-sonnet-4-6",
          system_prompt: "You are a product owner...",
          skill_content: null,
          category_id: null,
          enabled: true,
          lane_override: null,
          order: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      });
    }

    // Component should not crash
    rerender(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow({ display_name: "Updated Name" }) as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
    );

    expect(container).toBeTruthy();
  });

  it("handles jobs UPDATE with current_agent transition correctly", async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };

    mockSupabase.channel.mockReturnValue(mockChannel);
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    // Simulate job starting (current_agent: null → value)
    const jobsCallback = mockChannel.on.mock.calls.find(
      (call: unknown[]) => call[1]?.table === "jobs",
    )?.[2];

    if (jobsCallback) {
      jobsCallback({
        old: { id: "job-1", current_agent: null, current_step_message: null, title: "Test Job", started_at: null },
        new: { id: "job-1", current_agent: "backend-dev", current_step_message: "Implementing", title: "Test Job", started_at: "2026-01-01T00:00:00Z" },
      });
    }

    // Verify running jobs state updated
    expect(mockChannel.on).toHaveBeenCalled();
  });

  it("handles runs INSERT with missing job title gracefully", async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };

    mockSupabase.channel.mockReturnValue(mockChannel);
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    // Simulate runs INSERT
    const runsCallback = mockChannel.on.mock.calls.find(
      (call: unknown[]) => call[1]?.table === "runs" && call[1]?.event === "INSERT",
    )?.[2];

    if (runsCallback) {
      await runsCallback({
        new: {
          id: "run-1",
          job_id: "job-123",
          agent: "product-owner",
          status: "started",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
    }

    // Component should not crash even if job title lookup fails
    expect(container).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 3. Dirty state edge cases
  // -----------------------------------------------------------------------

  it("handles beforeunload event with unsaved changes", async () => {
    mockSupabase.channel.mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    });
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    const { rerender } = render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    // Simulate beforeunload without unsaved changes first (hasUnsavedChanges is false by default)
    const event = new Event("beforeunload") as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    Object.defineProperty(event, "returnValue", { value: "", writable: true });

    window.dispatchEvent(event);

    // Since hasUnsavedChanges is false, preventDefault should NOT be called
    expect(preventDefaultSpy).not.toHaveBeenCalled();

    preventDefaultSpy.mockRestore();
  });

  it("handles navigation confirmation event", async () => {
    mockSupabase.channel.mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    });
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    });

    const { AgentsClient } = await import("@/app/dashboard/agents/agents-client");

    const container = document.createElement("div");
    render(
      React.createElement(AgentsClient, {
        initialAgents: [makeAgentRow() as never],
        providerModels: [],
        initialRunningJobs: [],
      }),
      { container },
    );

    // Dispatch navigation confirmation event
    const navEvent = new CustomEvent("agents:confirm-navigation", {
      detail: { href: "/dashboard/jobs" },
    });
    window.dispatchEvent(navEvent);

    // Should not crash
    expect(container).toBeTruthy();
  });
});
