import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../supabase.js", () => ({
  createClient: vi.fn(() => ({})),
}));

import {
  loadAgentConfig,
  getAgentConfig,
  invalidateConfigCache,
} from "../agentConfig.js";

function makeRow(
  name: string,
  order: number,
  enabled = true,
): Record<string, unknown> {
  return {
    id: `uuid-${name}`,
    agent_name: name,
    display_name: name,
    role: `Role for ${name}`,
    provider: "claude",
    model: "claude-sonnet-4-6",
    system_prompt: `Prompt for ${name}`,
    skill_content: null,
    enabled,
    lane_override: null,
    order,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function mockSupabase(
  data: Record<string, unknown>[] | null,
  error: { message: string } | null = null,
) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ data, error })),
      })),
    })),
  };
}

describe("agentConfig module", () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  describe("loadAgentConfig", () => {
    it("returns true and populates cache with 8 entries when supabase returns 8 rows", async () => {
      const rows = [
        "product-owner",
        "codebase-analyst",
        "tech-lead",
        "backend-dev",
        "frontend-dev",
        "security-reviewer",
        "code-reviewer",
        "qa-engineer",
      ].map((name, i) => makeRow(name, i + 1));

      const supabase = mockSupabase(rows);
      const result = await loadAgentConfig(supabase);

      expect(result).toBe(true);
      for (const name of [
        "product-owner",
        "codebase-analyst",
        "tech-lead",
        "backend-dev",
        "frontend-dev",
        "security-reviewer",
        "code-reviewer",
        "qa-engineer",
      ]) {
        const config = getAgentConfig(name);
        expect(config).not.toBeNull();
        expect(config!.agentName).toBe(name);
      }
    });

    it("returns true and empty cache when supabase returns 0 rows", async () => {
      const supabase = mockSupabase([]);
      const result = await loadAgentConfig(supabase);

      expect(result).toBe(true);
      expect(getAgentConfig("product-owner")).toBeNull();
    });

    it("returns false when supabase returns error", async () => {
      const supabase = mockSupabase(null, { message: "connection failed" });
      const result = await loadAgentConfig(supabase);

      expect(result).toBe(false);
    });

    it("returns false when supabase throws", async () => {
      const supabase = {
        from: vi.fn(() => {
          throw new Error("unexpected error");
        }),
      };
      const result = await loadAgentConfig(supabase);

      expect(result).toBe(false);
    });

    it("returns false when supabase is undefined", async () => {
      const result = await loadAgentConfig(undefined as never);
      expect(result).toBe(false);
    });

    it("returns false when supabase returns non-array data", async () => {
      const supabase = mockSupabase(null as never);
      const result = await loadAgentConfig(supabase);
      expect(result).toBe(false);
    });
  });

  describe("getAgentConfig", () => {
    it("returns correct AgentConfig for known agent name", async () => {
      const rows = [makeRow("product-owner", 1)];
      const supabase = mockSupabase(rows);
      await loadAgentConfig(supabase);

      const config = getAgentConfig("product-owner");
      expect(config).not.toBeNull();
      expect(config!.displayName).toBe("product-owner");
      expect(config!.provider).toBe("claude");
      expect(config!.model).toBe("claude-sonnet-4-6");
      expect(config!.enabled).toBe(true);
      expect(config!.order).toBe(1);
    });

    it("returns null for unknown agent name", async () => {
      const rows = [makeRow("product-owner", 1)];
      const supabase = mockSupabase(rows);
      await loadAgentConfig(supabase);

      expect(getAgentConfig("nonexistent")).toBeNull();
    });

    it("returns null when cache is empty (before load)", () => {
      expect(getAgentConfig("product-owner")).toBeNull();
    });
  });

  describe("invalidateConfigCache", () => {
    it("clears the cache", async () => {
      const rows = [makeRow("product-owner", 1)];
      const supabase = mockSupabase(rows);
      await loadAgentConfig(supabase);

      expect(getAgentConfig("product-owner")).not.toBeNull();

      invalidateConfigCache();

      expect(getAgentConfig("product-owner")).toBeNull();
    });

    it("after invalidate + reload, getAgentConfig returns fresh data", async () => {
      const rows1 = [makeRow("product-owner", 1)];
      const supabase1 = mockSupabase(rows1);
      await loadAgentConfig(supabase1);

      invalidateConfigCache();

      const rows2 = [makeRow("product-owner", 1, false)];
      const supabase2 = mockSupabase(rows2);
      await loadAgentConfig(supabase2);

      const config = getAgentConfig("product-owner");
      expect(config).not.toBeNull();
      expect(config!.enabled).toBe(false);
    });
  });

  describe("concurrent access", () => {
    it("calling getAgentConfig during loadAgentConfig does not crash", async () => {
      const rows = [makeRow("product-owner", 1)];
      const supabase = mockSupabase(rows);

      const loadPromise = loadAgentConfig(supabase);
      const getConfigResult = getAgentConfig("product-owner");

      await loadPromise;

      expect(getConfigResult).toBeNull();
      expect(getAgentConfig("product-owner")).not.toBeNull();
    });
  });
});
