import type { Lane } from "./runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageState {
  goMonthlyUsedUSD: number;
  goWeeklyUsedUSD: number;
  go5hUsedUSD: number;
  softLimitHit: boolean;
  hardLimitHit: boolean;
}

export interface RouteDecision {
  lane: Lane;
  model: string;
  reason: string;
}

export type AgentMode =
  | "implement"
  | "fix"
  | "review"
  | "analyze"
  | "redesign"
  | "security-fix"
  | "review-fix"
  | "test-fix"
  | "debug";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREMIUM_MODEL = "claude-sonnet-4-6";
const CHEAP_MODEL = process.env["OPENCODE_CHEAP_MODEL"] ?? "opencode-go/deepseek-v4-flash";

// ---------------------------------------------------------------------------
// Base policy table
// agent → mode → lane  (mode "*" = any)
// ---------------------------------------------------------------------------

type PolicyKey = `${string}/${string}`;

const BASE_POLICY: Record<PolicyKey, Lane> = {
  "product-owner/*":        "premium",
  "codebase-analyst/*":     "cheap",
  "tech-lead/implement":    "premium",
  "tech-lead/redesign":     "premium",
  "backend-dev/implement":  "cheap",
  "backend-dev/fix":        "cheap",
  "backend-dev/security-fix": "premium",
  "backend-dev/review-fix": "cheap",
  "backend-dev/test-fix":   "cheap",
  "frontend-dev/implement": "cheap",
  "frontend-dev/fix":       "cheap",
  "frontend-dev/security-fix": "premium",
  "frontend-dev/review-fix": "cheap",
  "frontend-dev/test-fix":  "cheap",
  "security-reviewer/*":    "premium",
  "code-reviewer/*":        "premium",
  "qa-engineer/analyze":    "cheap",
  "qa-engineer/debug":      "premium",
};

function baseLane(agentName: string, mode: AgentMode): Lane {
  const specific = BASE_POLICY[`${agentName}/${mode}`];
  if (specific) return specific;
  const wildcard = BASE_POLICY[`${agentName}/*`];
  if (wildcard) return wildcard;
  // fallback: unknown agents default cheap
  return "cheap";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveRoute(
  agentName: string,
  mode: AgentMode,
  usageState: UsageState,
): RouteDecision {
  // Hard limit: force everything cheap
  if (usageState.hardLimitHit) {
    return {
      lane: "cheap",
      model: CHEAP_MODEL,
      reason: "hard limit — forced cheap",
    };
  }

  const lane = baseLane(agentName, mode);

  // Soft limit: downgrade premium → cheap
  if (usageState.softLimitHit && lane === "premium") {
    return {
      lane: "cheap",
      model: CHEAP_MODEL,
      reason: "soft limit — downgraded",
    };
  }

  return {
    lane,
    model: lane === "premium" ? PREMIUM_MODEL : CHEAP_MODEL,
    reason: `policy: ${agentName}/${mode}`,
  };
}
