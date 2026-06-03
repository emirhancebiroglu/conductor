import { describe, it, expect, vi } from "vitest";
import { dispatchAgent } from "../pipeline/dispatch.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner, AgentRunnerResult } from "@conductor/cm-adapters";

const MOCK_SCA_CONFIG = {
  id: "cfg-1",
  agent_name: "cm-sca-agent",
  display_name: "CM SCA Agent",
  provider: "opencode",
  model: "opencode-go/deepseek-v4-flash",
  system_prompt: "You are an SCA fixer",
};

const MOCK_SAST_CONFIG = {
  id: "cfg-2",
  agent_name: "cm-sast-agent",
  display_name: "CM SAST Agent",
  provider: "claude",
  model: "claude-sonnet-4-6",
  system_prompt: "You are a SAST fixer",
};

function mockAgentRunner(result?: Partial<AgentRunnerResult>) {
  const run = vi.fn().mockResolvedValue({
    edits: [{ file: "package.json", diff: "+  \"lodash\": \"4.17.21\"" }],
    summary: "Fixed vulnerability",
    usage: { inputTokens: 200, outputTokens: 80 },
    ...result,
  });
  return { run };
}

function setupSupabase(configRow: Record<string, unknown>) {
  let insertedRun: Record<string, unknown> | null = null;
  let insertedUsage: Record<string, unknown> | null = null;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "agent_config") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: configRow, error: null }),
        };
      }
      if (table === "runs") {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            insertedRun = data;
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: "run-001" }, error: null }),
            };
          }),
        };
      }
      if (table === "usage_log") {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            insertedUsage = data;
            return { error: null };
          }),
        };
      }
      return {};
    }),
  } as unknown as SupabaseClient;

  return { supabase, getRun: () => insertedRun, getUsage: () => insertedUsage };
}

describe("dispatchAgent", () => {
  it("loads agent_config and runs the agent with its model", async () => {
    const { supabase } = setupSupabase(MOCK_SCA_CONFIG);
    const { run: agentRun } = mockAgentRunner();
    const agentRunner = { run: agentRun } as AgentRunner;

    const result = await dispatchAgent(
      supabase,
      agentRunner,
      "cm-sca-agent",
      "scan-001",
      "ws-001",
      { description: "Bump lodash", workingDir: "/tmp/repo" },
    );

    expect(result.agentName).toBe("cm-sca-agent");
    expect(result.model).toBe("opencode-go/deepseek-v4-flash");
    expect(result.inputTokens).toBe(200);
    expect(agentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "cm-sca-agent",
        provider: "opencode",
        model: "opencode-go/deepseek-v4-flash",
      }),
      expect.objectContaining({ description: "Bump lodash" }),
    );
  });

  it("creates a runs row with scan_id and agent info", async () => {
    const { supabase, getRun } = setupSupabase(MOCK_SAST_CONFIG);
    const agentRunner = mockAgentRunner();

    await dispatchAgent(
      supabase,
      agentRunner,
      "cm-sast-agent",
      "scan-002",
      "ws-001",
      { description: "Fix SQL injection", workingDir: "/tmp/repo" },
    );

    const run = getRun();
    expect(run).toBeDefined();
    expect(run?.agent).toBe("cm-sast-agent");
    expect(run?.model).toBe("claude-sonnet-4-6");
    expect(run?.lane).toBe("premium");
  });

  it("creates a usage_log row with token counts and cost", async () => {
    const { supabase, getUsage } = setupSupabase(MOCK_SCA_CONFIG);
    const agentRunner = mockAgentRunner();

    await dispatchAgent(
      supabase,
      agentRunner,
      "cm-sca-agent",
      "scan-001",
      "ws-001",
      { description: "Bump lodash", workingDir: "/tmp/repo" },
    );

    const usage = getUsage();
    expect(usage).toBeDefined();
    expect(usage?.model).toBe("opencode-go/deepseek-v4-flash");
    expect(usage?.input_tokens).toBe(200);
    expect(usage?.output_tokens).toBe(80);
    expect(usage?.est_cost_usd).toBeGreaterThan(0);
  });

  it("reflects agent_config model changes in recorded data", async () => {
    const customConfig = {
      ...MOCK_SCA_CONFIG,
      model: "claude-opus-4-5",
      provider: "claude",
    };

    const { supabase, getRun, getUsage } = setupSupabase(customConfig);
    const { run: agentRun } = mockAgentRunner();

    const agentRunner = { run: agentRun } as AgentRunner;

    await dispatchAgent(
      supabase,
      agentRunner,
      "cm-sca-agent",
      "scan-001",
      "ws-001",
      { description: "Upgrade", workingDir: "/tmp/repo" },
    );

    const run = getRun();
    expect(run?.model).toBe("claude-opus-4-5");
    expect(run?.lane).toBe("premium");

    const usage = getUsage();
    expect(usage?.model).toBe("claude-opus-4-5");

    expect(agentRun).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-5" }),
      expect.anything(),
    );
  });

  it("throws when agent_config is not found", async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
      })),
    } as unknown as SupabaseClient;

    const agentRunner = mockAgentRunner();

    await expect(
      dispatchAgent(supabase, agentRunner, "cm-unknown-agent", "scan-001", "ws-001", {
        description: "test",
        workingDir: "/tmp",
      }),
    ).rejects.toThrow("Agent config not found for cm-unknown-agent");
  });
});
