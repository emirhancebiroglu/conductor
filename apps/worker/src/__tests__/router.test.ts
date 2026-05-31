import { describe, it, expect } from "vitest";
import { resolveRoute, type UsageState, type AgentMode } from "../router.js";
import type { AgentConfig } from "../agentConfig.js";

function makeConfig(
  laneOverride: "cheap" | "premium" | null = null,
): AgentConfig {
  return {
    id: "uuid-1",
    agentName: "backend-dev",
    displayName: "Backend Dev",
    role: "Backend developer",
    provider: "opencode",
    model: "opencode-go/deepseek-v4-flash",
    systemPrompt: "You are backend dev",
    skillContent: null, categoryId: null,
    enabled: true,
    laneOverride,
    order: 4,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeUsageState(
  partial: Partial<UsageState> = {},
): UsageState {
  return {
    goMonthlyUsedUSD: 0,
    goWeeklyUsedUSD: 0,
    go5hUsedUSD: 0,
    softLimitHit: false,
    hardLimitHit: false,
    ...partial,
  };
}

const defaultUsage = makeUsageState();

describe("resolveRoute", () => {
  describe("no laneOverride (BASE_POLICY path)", () => {
    it("follows BASE_POLICY for product-owner", () => {
      const decision = resolveRoute("product-owner", "implement", defaultUsage);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).toContain("policy");
    });

    it("follows BASE_POLICY for backend-dev/implement", () => {
      const decision = resolveRoute("backend-dev", "implement", defaultUsage);
      expect(decision.lane).toBe("cheap");
    });

    it("follows BASE_POLICY for security-reviewer", () => {
      const decision = resolveRoute("security-reviewer", "implement", defaultUsage);
      expect(decision.lane).toBe("cheap");
    });

    it("defaults unknown agents to cheap", () => {
      const decision = resolveRoute("unknown-agent", "implement", defaultUsage);
      expect(decision.lane).toBe("cheap");
    });
  });

  describe("laneOverride = 'cheap'", () => {
    it("always returns cheap lane", () => {
      const config = makeConfig("cheap");
      const decision = resolveRoute("tech-lead", "implement", defaultUsage, config);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).toContain("override");
    });
  });

  describe("laneOverride = 'premium'", () => {
    it("always returns premium lane", () => {
      const config = makeConfig("premium");
      const decision = resolveRoute("backend-dev", "implement", defaultUsage, config);
      expect(decision.lane).toBe("premium");
      expect(decision.reason).toContain("override");
    });

    it("uses premium model", () => {
      const config = makeConfig("premium");
      const decision = resolveRoute("backend-dev", "implement", defaultUsage, config);
      expect(decision.model).toBe("claude-sonnet-4-6");
    });
  });

  describe("undefined agentConfig (backward compat)", () => {
    it("pure BASE_POLICY path", () => {
      const decision = resolveRoute("product-owner", "implement", defaultUsage, undefined);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).toContain("policy");
    });

    it("works without config for any agent", () => {
      const agents: [string, AgentMode][] = [
        ["product-owner", "implement"],
        ["tech-lead", "implement"],
        ["backend-dev", "implement"],
        ["frontend-dev", "implement"],
        ["security-reviewer", "implement"],
        ["code-reviewer", "review"],
        ["qa-engineer", "analyze"],
      ];
      for (const [agent, mode] of agents) {
        const decision = resolveRoute(agent, mode, defaultUsage, undefined);
        expect(decision.lane).toBeDefined();
        expect(decision.model).toBeDefined();
      }
    });
  });

  describe("hard limit", () => {
    it("forces cheap regardless of override", () => {
      const config = makeConfig("premium");
      const usage = makeUsageState({ hardLimitHit: true });
      const decision = resolveRoute("backend-dev", "implement", usage, config);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).toContain("hard limit");
    });
  });

  describe("soft limit", () => {
    it("downgrades premium to cheap", () => {
      const config = makeConfig("premium");
      const usage = makeUsageState({ softLimitHit: true });
      const decision = resolveRoute("backend-dev", "implement", usage, config);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).toContain("soft limit");
    });

    it("does not affect cheap lane", () => {
      const config = makeConfig("cheap");
      const usage = makeUsageState({ softLimitHit: true });
      const decision = resolveRoute("backend-dev", "implement", usage, config);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).not.toContain("soft limit");
    });

    it("does not affect BASE_POLICY cheap agents", () => {
      const usage = makeUsageState({ softLimitHit: true });
      const decision = resolveRoute("product-owner", "implement", usage);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).not.toContain("soft limit");
    });
  });

  describe("cost limit enforcement with laneOverride", () => {
    it("hard limit overrides premium laneOverride", () => {
      const config = makeConfig("premium");
      const usage = makeUsageState({ hardLimitHit: true });
      const decision = resolveRoute("tech-lead", "redesign", usage, config);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).toContain("hard limit");
    });

    it("soft limit downgrades premium laneOverride", () => {
      const config = makeConfig("premium");
      const usage = makeUsageState({ softLimitHit: true });
      const decision = resolveRoute("tech-lead", "redesign", usage, config);
      expect(decision.lane).toBe("cheap");
      expect(decision.reason).toContain("soft limit");
    });
  });
});
