import type { CmFinding } from "@conductor/cm-core";

export type ScanResult = {
  externalScanId: string;
  findings?: import("@conductor/cm-core").CmFinding[];
};

export interface ScanProvider {
  scan(repo: { owner: string; name: string }, branch: string): Promise<ScanResult>;
  fetchResults(externalScanId: string): Promise<CmFinding[]>;
  /**
   * Returns the most recent completed scan for repo+branch, if one exists,
   * without triggering a new scan. Used to skip a fresh `scan()` call for the
   * initial baseline scan when a recent scheduled scan already covers it.
   */
  getLatestScan?(repo: { owner: string; name: string }, branch: string): Promise<{ externalScanId: string } | null>;

  /**
   * Submits and waits for a fresh scan of repo+branch entirely via the
   * Checkmarx One REST API (no `cx` CLI subprocess) — used specifically for
   * the fix-branch validation rescan, where a slow/eventually-consistent CLI
   * round-trip isn't acceptable. Returns findings directly.
   */
  rescanRest?(repo: { owner: string; name: string }, branch: string): Promise<ScanResult>;
}
