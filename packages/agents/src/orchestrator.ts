import type { Job } from "@conductor/core";

export interface OrchestratorOptions {
  maxReviewLoops: number;
  maxTestLoops: number;
}

// Stub — Faz 3'te implement edilecek
export function orchestrate(
  _job: Job,
  _opts: OrchestratorOptions
): Promise<void> {
  return Promise.reject(new Error("Orchestrator not implemented yet"));
}
