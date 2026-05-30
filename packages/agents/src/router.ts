import type { AgentName, LanePreference } from "@conductor/core";

export type Lane = "cheap" | "premium";

// Stub — Faz 4'te implement edilecek
export function routeLane(
  _agent: AgentName,
  _preference: LanePreference
): Lane {
  throw new Error("Router not implemented yet");
}
