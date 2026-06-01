import type { JobStatus } from "./types.js";

export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  WAITING_INPUT: "waiting_input",
  DECOMPOSED: "decomposed",
  REVIEW_LOOP: "review_loop",
  TEST_LOOP: "test_loop",
  PR_OPENED: "pr_opened",
  MERGED: "merged",
  FAILED: "failed",
  NEEDS_HUMAN: "needs_human",
  RESEARCHING: "researching",
  PRD_READY: "prd_ready",
  SCAFFOLDING: "scaffolding",
  IDEA_EXHAUSTED: "idea_exhausted",
} as const satisfies Record<string, JobStatus>;

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  JOB_STATUS.PR_OPENED,
  JOB_STATUS.MERGED,
  JOB_STATUS.FAILED,
  JOB_STATUS.NEEDS_HUMAN,
  JOB_STATUS.IDEA_EXHAUSTED,
]);

export const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set([
  JOB_STATUS.RUNNING,
  JOB_STATUS.REVIEW_LOOP,
  JOB_STATUS.TEST_LOOP,
  JOB_STATUS.RESEARCHING,
  JOB_STATUS.SCAFFOLDING,
]);

/** Valid transitions in the state machine. */
export const TRANSITIONS: Readonly<Record<JobStatus, ReadonlyArray<JobStatus>>> = {
  queued: ["running", "researching", "failed"],
  running: ["waiting_input", "decomposed", "review_loop", "test_loop", "pr_opened", "failed", "needs_human"],
  waiting_input: ["queued", "failed"],
  decomposed: [],
  review_loop: ["running", "test_loop", "failed", "needs_human"],
  test_loop: ["pr_opened", "review_loop", "failed", "needs_human"],
  pr_opened: ["merged", "failed"],
  merged: [],
  failed: [],
  needs_human: ["queued", "failed"],
  researching: ["prd_ready", "queued", "idea_exhausted", "failed"],
  prd_ready: ["scaffolding", "researching", "failed"],
  scaffolding: ["queued", "failed"],
  idea_exhausted: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isActive(status: JobStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}
