import type { CmFinding } from "@conductor/cm-core";

export type ScanResult = {
  externalScanId: string;
};

export interface ScanProvider {
  scan(repo: { owner: string; name: string }, branch: string): Promise<ScanResult>;
  fetchResults(externalScanId: string): Promise<CmFinding[]>;
}
