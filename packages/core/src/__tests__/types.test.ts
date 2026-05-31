import { describe, it, expect } from "vitest";
import {
  AgentConfigSchema,
  AgentNameSchema,
  ProviderModelSchema,
  JobSchema,
  JobRowSchema,
  LaneSchema,
} from "../types";

// ---------------------------------------------------------------------------
// AgentNameSchema
// ---------------------------------------------------------------------------

describe("AgentNameSchema", () => {
  const validNames = [
    "product-owner",
    "codebase-analyst",
    "tech-lead",
    "backend-dev",
    "frontend-dev",
    "security-reviewer",
    "code-reviewer",
    "qa-engineer",
  ];

  for (const name of validNames) {
    it(`accepts "${name}"`, () => {
      expect(AgentNameSchema.parse(name)).toBe(name);
    });
  }

  it("rejects invalid agent name", () => {
    const result = AgentNameSchema.safeParse("invalid-agent");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = AgentNameSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentConfigSchema
// ---------------------------------------------------------------------------

describe("AgentConfigSchema", () => {
  const validConfig = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    agentName: "product-owner",
    displayName: "Product Owner",
    role: "Gathers requirements",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are the product owner...",
    skillPath: "skills/product-owner/SKILL.md",
    enabled: true,
    laneOverride: null as "cheap" | "premium" | null,
    order: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("parses valid full object", () => {
    const result = AgentConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("accepts all valid agentName enum values", () => {
    const names = [
      "product-owner",
      "codebase-analyst",
      "tech-lead",
      "backend-dev",
      "frontend-dev",
      "security-reviewer",
      "code-reviewer",
      "qa-engineer",
    ];
    for (const name of names) {
      const result = AgentConfigSchema.safeParse({ ...validConfig, agentName: name });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid agentName", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, agentName: "invalid-agent" });
    expect(result.success).toBe(false);
  });

  it("accepts laneOverride 'cheap'", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, laneOverride: "cheap" });
    expect(result.success).toBe(true);
  });

  it("accepts laneOverride 'premium'", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, laneOverride: "premium" });
    expect(result.success).toBe(true);
  });

  it("accepts laneOverride null", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, laneOverride: null });
    expect(result.success).toBe(true);
  });

  it("rejects laneOverride 'ultra-cheap'", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, laneOverride: "ultra-cheap" });
    expect(result.success).toBe(false);
  });

  it("rejects enabled when not boolean", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, enabled: "true" });
    expect(result.success).toBe(false);
  });

  it("accepts enabled true", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, enabled: true });
    expect(result.success).toBe(true);
  });

  it("accepts enabled false", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, enabled: false });
    expect(result.success).toBe(true);
  });

  it("accepts order as integer >= 0", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, order: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts order as positive integer", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, order: 8 });
    expect(result.success).toBe(true);
  });

  it("rejects order as float", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, order: 1.5 });
    expect(result.success).toBe(false);
  });

  it("accepts order as negative integer (schema allows, DB constraint enforces)", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, order: -1 });
    expect(result.success).toBe(true);
  });

  it("accepts systemPrompt as empty string", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, systemPrompt: "" });
    expect(result.success).toBe(true);
  });

  it("accepts systemPrompt as non-empty string", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, systemPrompt: "You are..." });
    expect(result.success).toBe(true);
  });

  it("rejects systemPrompt when not string", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, systemPrompt: null });
    expect(result.success).toBe(false);
  });

  it("accepts skillPath as null", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, skillPath: null });
    expect(result.success).toBe(true);
  });

  it("accepts skillPath as string", () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, skillPath: "skills/foo/SKILL.md" });
    expect(result.success).toBe(true);
  });

  it("rejects missing required field agentName", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { agentName, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field displayName", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { displayName, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field role", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { role, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field provider", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { provider, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field model", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { model, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field systemPrompt", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { systemPrompt, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field enabled", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { enabled, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field order", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { order, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field id", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { id, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field createdAt", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { createdAt, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field updatedAt", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { updatedAt, ...rest } = validConfig;
    const result = AgentConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProviderModelSchema
// ---------------------------------------------------------------------------

describe("ProviderModelSchema", () => {
  const validModel = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    provider: "claude",
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    capabilities: { tier: "premium", context: 200000 },
    available: true,
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("parses valid full object", () => {
    const result = ProviderModelSchema.safeParse(validModel);
    expect(result.success).toBe(true);
  });

  it("capabilities is required in schema (DB provides default)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { capabilities, ...rest } = validModel;
    const result = ProviderModelSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("available is required in schema (DB provides default)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { available, ...rest } = validModel;
    const result = ProviderModelSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts capabilities as empty object", () => {
    const result = ProviderModelSchema.safeParse({ ...validModel, capabilities: {} });
    expect(result.success).toBe(true);
  });

  it("accepts capabilities as complex object", () => {
    const result = ProviderModelSchema.safeParse({
      ...validModel,
      capabilities: { tier: "cheap", context: 131072, features: ["text", "vision"] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required field provider", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { provider, ...rest } = validModel;
    const result = ProviderModelSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field modelId", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { modelId, ...rest } = validModel;
    const result = ProviderModelSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field displayName", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { displayName, ...rest } = validModel;
    const result = ProviderModelSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LaneSchema
// ---------------------------------------------------------------------------

describe("LaneSchema", () => {
  it("accepts 'cheap'", () => {
    expect(LaneSchema.parse("cheap")).toBe("cheap");
  });

  it("accepts 'premium'", () => {
    expect(LaneSchema.parse("premium")).toBe("premium");
  });

  it("rejects 'ultra-cheap'", () => {
    const result = LaneSchema.safeParse("ultra-cheap");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = LaneSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JobSchema update — currentAgent / currentStepMessage
// ---------------------------------------------------------------------------

describe("JobSchema — currentAgent / currentStepMessage", () => {
  const baseJob = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    projectId: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    parentJobId: null as string | null,
    type: "feature" as const,
    title: "Test Job",
    description: "A test job",
    lanePreference: "auto" as const,
    status: "queued" as const,
    branch: null as string | null,
    prUrl: null as string | null,
    spec: null,
    plan: null,
    error: null,
    currentAgent: null as string | null,
    currentStepMessage: null as string | null,
    startedAt: null as string | null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("currentAgent null accepted", () => {
    const result = JobSchema.safeParse({ ...baseJob, currentAgent: null });
    expect(result.success).toBe(true);
  });

  it("currentAgent string accepted", () => {
    const result = JobSchema.safeParse({ ...baseJob, currentAgent: "backend-dev" });
    expect(result.success).toBe(true);
  });

  it("currentStepMessage null accepted", () => {
    const result = JobSchema.safeParse({ ...baseJob, currentStepMessage: null });
    expect(result.success).toBe(true);
  });

  it("currentStepMessage string accepted", () => {
    const result = JobSchema.safeParse({ ...baseJob, currentStepMessage: "Building API" });
    expect(result.success).toBe(true);
  });

  it("existing fields still work unchanged", () => {
    const result = JobSchema.safeParse(baseJob);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Test Job");
      expect(result.data.status).toBe("queued");
      expect(result.data.lanePreference).toBe("auto");
    }
  });
});

// ---------------------------------------------------------------------------
// JobRowSchema update — current_agent / current_step_message
// ---------------------------------------------------------------------------

describe("JobRowSchema — current_agent / current_step_message", () => {
  const baseRow = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    project_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    parent_job_id: null as string | null,
    type: "feature" as const,
    title: "Test Job",
    description: "A test job",
    lane_preference: "auto" as const,
    status: "queued" as const,
    branch: null as string | null,
    pr_url: null as string | null,
    spec: null,
    plan: null,
    answers: null,
    error: null,
    current_agent: null as string | null,
    current_step_message: null as string | null,
    started_at: null as string | null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("current_agent null accepted", () => {
    const result = JobRowSchema.safeParse({ ...baseRow, current_agent: null });
    expect(result.success).toBe(true);
  });

  it("current_agent string accepted", () => {
    const result = JobRowSchema.safeParse({ ...baseRow, current_agent: "backend-dev" });
    expect(result.success).toBe(true);
  });

  it("current_step_message null accepted", () => {
    const result = JobRowSchema.safeParse({ ...baseRow, current_step_message: null });
    expect(result.success).toBe(true);
  });

  it("current_step_message string accepted", () => {
    const result = JobRowSchema.safeParse({ ...baseRow, current_step_message: "Building API" });
    expect(result.success).toBe(true);
  });

  it("existing fields still work unchanged", () => {
    const result = JobRowSchema.safeParse(baseRow);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Test Job");
      expect(result.data.status).toBe("queued");
    }
  });
});
