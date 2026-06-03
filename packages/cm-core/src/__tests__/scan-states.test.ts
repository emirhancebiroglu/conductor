import { describe, it, expect } from "vitest";
import {
  canTransitionScan,
  canTransitionFix,
  isScanTerminal,
  isFixTerminal,
  SCAN_TERMINAL_STATUSES,
  FIX_TERMINAL_STATUSES,
  CM_SCAN_STATUS,
  CM_FIX_STATUS,
} from "../scan-states.js";

// ---------------------------------------------------------------------------
// Scan transitions
// ---------------------------------------------------------------------------

const LEGAL_SCAN_TRANSITIONS: Array<[string, string]> = [
  ["queued", "scanning"],
  ["queued", "failed"],
  ["scanning", "scan_done"],
  ["scanning", "scan_failed"],
  ["scanning", "failed"],
  ["scan_done", "fixing"],
  ["scan_done", "reporting"],
  ["scan_done", "failed"],
  ["scan_failed", "queued"],
  ["scan_failed", "failed"],
  ["fixing", "fixed"],
  ["fixing", "run_blocked"],
  ["fixing", "needs_human"],
  ["fixing", "failed"],
  ["run_blocked", "fixing"],
  ["run_blocked", "failed"],
  ["fixed", "rescanning"],
  ["fixed", "failed"],
  ["rescanning", "scan_done"],
  ["rescanning", "verified"],
  ["rescanning", "needs_human"],
  ["rescanning", "failed"],
  ["verified", "pr_opening"],
  ["verified", "failed"],
  ["pr_opening", "pr_opened"],
  ["pr_opening", "failed"],
  ["pr_opened", "reporting"],
  ["pr_opened", "failed"],
  ["reporting", "done"],
  ["reporting", "failed"],
  ["needs_human", "queued"],
  ["needs_human", "failed"],
];

const ILLEGAL_SCAN_TRANSITIONS: Array<[string, string]> = [
  ["queued", "done"],
  ["queued", "needs_human"],
  ["scanning", "done"],
  ["scanning", "fixing"],
  ["scan_done", "scanning"],
  ["scan_done", "queued"],
  ["scan_failed", "done"],
  ["scan_failed", "scanning"],
  ["fixing", "done"],
  ["fixing", "reporting"],
  ["run_blocked", "done"],
  ["run_blocked", "scanning"],
  ["fixed", "done"],
  ["fixed", "fixing"],
  ["rescanning", "done"],
  ["rescanning", "fixing"],
  ["verified", "done"],
  ["verified", "fixing"],
  ["pr_opening", "done"],
  ["pr_opening", "fixing"],
  ["pr_opened", "done"],
  ["pr_opened", "fixing"],
  ["reporting", "queued"],
  ["reporting", "fixing"],
  ["done", "queued"],
  ["done", "anything"],
  ["failed", "queued"],
  ["failed", "done"],
];

describe("scan state machine", () => {
  describe("canTransitionScan", () => {
    for (const [from, to] of LEGAL_SCAN_TRANSITIONS) {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransitionScan(from as never, to as never)).toBe(true);
      });
    }

    for (const [from, to] of ILLEGAL_SCAN_TRANSITIONS) {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransitionScan(from as never, to as never)).toBe(false);
      });
    }
  });

  describe("isScanTerminal", () => {
    it("marks done as terminal", () => {
      expect(isScanTerminal("done")).toBe(true);
    });

    it("marks failed as terminal", () => {
      expect(isScanTerminal("failed")).toBe(true);
    });

    it("marks needs_human as terminal", () => {
      expect(isScanTerminal("needs_human")).toBe(true);
    });

    it("does not mark queued as terminal", () => {
      expect(isScanTerminal("queued")).toBe(false);
    });

    it("does not mark scanning as terminal", () => {
      expect(isScanTerminal("scanning")).toBe(false);
    });

    it("terminal set matches CM_SCAN_STATUS values", () => {
      for (const status of Object.values(CM_SCAN_STATUS)) {
        const inSet = SCAN_TERMINAL_STATUSES.has(status);
        const expected = status === "done" || status === "failed" || status === "needs_human";
        expect(inSet).toBe(expected);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Fix transitions
// ---------------------------------------------------------------------------

const LEGAL_FIX_TRANSITIONS: Array<[string, string]> = [
  ["open", "fixing"],
  ["open", "skipped"],
  ["fixing", "fixed"],
  ["fixing", "failed"],
  ["fixed", "verified"],
  ["failed", "open"],
  ["failed", "needs_human"],
];

const ILLEGAL_FIX_TRANSITIONS: Array<[string, string]> = [
  ["open", "verified"],
  ["open", "failed"],
  ["fixing", "open"],
  ["fixing", "verified"],
  ["fixed", "open"],
  ["fixed", "failed"],
  ["skipped", "open"],
  ["verified", "open"],
  ["needs_human", "open"],
];

describe("fix state machine", () => {
  describe("canTransitionFix", () => {
    for (const [from, to] of LEGAL_FIX_TRANSITIONS) {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransitionFix(from as never, to as never)).toBe(true);
      });
    }

    for (const [from, to] of ILLEGAL_FIX_TRANSITIONS) {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransitionFix(from as never, to as never)).toBe(false);
      });
    }
  });

  describe("isFixTerminal", () => {
    it("marks verified as terminal", () => {
      expect(isFixTerminal("verified")).toBe(true);
    });

    it("marks skipped as terminal", () => {
      expect(isFixTerminal("skipped")).toBe(true);
    });

    it("marks needs_human as terminal", () => {
      expect(isFixTerminal("needs_human")).toBe(true);
    });

    it("does not mark open as terminal", () => {
      expect(isFixTerminal("open")).toBe(false);
    });

    it("does not mark fixing as terminal", () => {
      expect(isFixTerminal("fixing")).toBe(false);
    });

    it("terminal set matches CM_FIX_STATUS values", () => {
      for (const status of Object.values(CM_FIX_STATUS)) {
        const inSet = FIX_TERMINAL_STATUSES.has(status);
        const expected = status === "verified" || status === "skipped" || status === "needs_human";
        expect(inSet).toBe(expected);
      }
    });
  });
});
