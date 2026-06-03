import type { CmScanStatus, CmFixStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Scan state machine
// ---------------------------------------------------------------------------

export const CM_SCAN_STATUS = {
  QUEUED: "queued",
  SCANNING: "scanning",
  SCAN_DONE: "scan_done",
  SCAN_FAILED: "scan_failed",
  FIXING: "fixing",
  RUN_BLOCKED: "run_blocked",
  FIXED: "fixed",
  RESCANNING: "rescanning",
  VERIFIED: "verified",
  PR_OPENING: "pr_opening",
  PR_OPENED: "pr_opened",
  REPORTING: "reporting",
  DONE: "done",
  FAILED: "failed",
  NEEDS_HUMAN: "needs_human",
} as const satisfies Record<string, CmScanStatus>;

export const SCAN_TERMINAL_STATUSES: ReadonlySet<CmScanStatus> = new Set([
  CM_SCAN_STATUS.DONE,
  CM_SCAN_STATUS.FAILED,
  CM_SCAN_STATUS.NEEDS_HUMAN,
]);

/** Valid transitions in the scan state machine. */
export const SCAN_TRANSITIONS: Readonly<Record<CmScanStatus, ReadonlyArray<CmScanStatus>>> = {
  queued: ["scanning", "failed"],
  scanning: ["scan_done", "scan_failed", "failed"],
  scan_done: ["fixing", "reporting", "failed"],
  scan_failed: ["queued", "failed"],
  fixing: ["fixed", "run_blocked", "needs_human", "failed"],
  run_blocked: ["fixing", "failed"],
  fixed: ["rescanning", "failed"],
  rescanning: ["scan_done", "verified", "needs_human", "failed"],
  verified: ["pr_opening", "failed"],
  pr_opening: ["pr_opened", "failed"],
  pr_opened: ["reporting", "failed"],
  reporting: ["done", "failed"],
  done: [],
  failed: [],
  needs_human: ["queued", "failed"],
};

export function canTransitionScan(from: CmScanStatus, to: CmScanStatus): boolean {
  return (SCAN_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function isScanTerminal(status: CmScanStatus): boolean {
  return SCAN_TERMINAL_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Fix (finding) state machine
// ---------------------------------------------------------------------------

export const CM_FIX_STATUS = {
  OPEN: "open",
  FIXING: "fixing",
  FIXED: "fixed",
  SKIPPED: "skipped",
  FAILED: "failed",
  VERIFIED: "verified",
  NEEDS_HUMAN: "needs_human",
} as const satisfies Record<string, CmFixStatus>;

export const FIX_TERMINAL_STATUSES: ReadonlySet<CmFixStatus> = new Set([
  CM_FIX_STATUS.VERIFIED,
  CM_FIX_STATUS.SKIPPED,
  CM_FIX_STATUS.NEEDS_HUMAN,
]);

/** Valid transitions in the finding fix-status state machine. */
export const FIX_TRANSITIONS: Readonly<Record<CmFixStatus, ReadonlyArray<CmFixStatus>>> = {
  open: ["fixing", "skipped"],
  fixing: ["fixed", "failed"],
  fixed: ["verified"],
  skipped: [],
  failed: ["open", "needs_human"],
  verified: [],
  needs_human: [],
};

export function canTransitionFix(from: CmFixStatus, to: CmFixStatus): boolean {
  return (FIX_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function isFixTerminal(status: CmFixStatus): boolean {
  return FIX_TERMINAL_STATUSES.has(status);
}
