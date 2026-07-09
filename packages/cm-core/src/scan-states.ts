import type { CmScanStatus, CmFixStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Scan state machine
// ---------------------------------------------------------------------------

// why: the pipeline no longer opens a PR (CLAUDE.md: "main'e asla otomatik
// merge etme" — the pipeline commits+pushes to the fix branch and stops there,
// a human takes it from there). "verified" is therefore the real terminal
// success state, not a step on the way to pr_opening/pr_opened — those states
// are dead: nothing in the worker ever sets or reads them. "reporting" is
// real though (re-added): PDF generation is a genuine, possibly-slow,
// possibly-failing step between a clean rescan and "verified", and it needs
// its own visible state so the dashboard doesn't show "Verified" before the
// report actually exists.
export const CM_SCAN_STATUS = {
  QUEUED: "queued",
  SCANNING: "scanning",
  SCAN_DONE: "scan_done",
  SCAN_FAILED: "scan_failed",
  FIXING: "fixing",
  RUN_BLOCKED: "run_blocked",
  FIXED: "fixed",
  RESCANNING: "rescanning",
  REPORTING: "reporting",
  VERIFIED: "verified",
  DONE: "done",
  FAILED: "failed",
  NEEDS_HUMAN: "needs_human",
} as const satisfies Record<string, CmScanStatus>;

export const SCAN_TERMINAL_STATUSES: ReadonlySet<CmScanStatus> = new Set([
  CM_SCAN_STATUS.VERIFIED,
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
  rescanning: ["scan_done", "reporting", "needs_human", "failed"],
  reporting: ["verified", "failed"],
  verified: ["failed"],
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
