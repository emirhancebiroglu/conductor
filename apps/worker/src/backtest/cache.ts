import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentConfig } from "../agentConfig.js";
import type { PipelineCoreResult } from "../ideaOrchestrator.js";
import type { CaseScore } from "./scorer.js";

export type CacheCaseEntry = {
  testCaseId: string;
  input: string;
  runs: CacheRunEntry[];
};

export type CacheRunEntry = {
  runIndex: number;
  result: PipelineCoreResult;
  score: CaseScore;
};

export interface CacheData {
  id: string;
  timestamp: string;
  promptHashes: Record<string, string>;
  cases: CacheCaseEntry[];
}

const PIPELINE_AGENTS = ["scout", "executioner", "advocate", "adversary", "judge", "product-manager", "scaffolder"] as const;

export type CascadeStage = "none" | "scout" | "executioner" | "debate";

function hashPrompt(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `h${Math.abs(hash).toString(36)}`;
}

export function computePromptHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of PIPELINE_AGENTS) {
    const config = getAgentConfig(name);
    hashes[name] = config?.systemPrompt ? hashPrompt(config.systemPrompt) : "unset";
  }
  return hashes;
}

export function detectChanges(
  currentHashes: Record<string, string>,
  cachedHashes: Record<string, string>,
): CascadeStage {
  for (const name of PIPELINE_AGENTS) {
    const changed = currentHashes[name] !== cachedHashes[name];
    if (!changed) continue;
    if (name === "scout") return "scout";
    if (name === "executioner") return "executioner";
    if (name === "advocate" || name === "adversary" || name === "judge") return "debate";
    if (name === "product-manager" || name === "scaffolder") continue;
  }
  return "none";
}

export class CacheManager {
  private dir: string;
  private data: CacheData | null = null;

  constructor(cacheDir: string) {
    this.dir = cacheDir;
  }

  get cacheDir(): string {
    return this.dir;
  }

  load(): CacheData | null {
    const path = join(this.dir, "cache.json");
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf-8");
      this.data = JSON.parse(raw) as CacheData;
      return this.data;
    } catch {
      return null;
    }
  }

  save(): void {
    if (!this.data) return;
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, "cache.json");
    writeFileSync(path, JSON.stringify(this.data, null, 2), "utf-8");
  }

  init(id: string, promptHashes: Record<string, string>): void {
    this.data = {
      id,
      timestamp: new Date().toISOString(),
      promptHashes,
      cases: [],
    };
  }

  getData(): CacheData | null {
    return this.data;
  }

  getCase(testCaseId: string): CacheCaseEntry | undefined {
    return this.data?.cases.find((c) => c.testCaseId === testCaseId);
  }

  putCaseRun(testCaseId: string, input: string, runIndex: number, result: PipelineCoreResult, score: CaseScore): void {
    if (!this.data) return;

    let entry = this.data.cases.find((c) => c.testCaseId === testCaseId);
    if (!entry) {
      entry = { testCaseId, input, runs: [] };
      this.data.cases.push(entry);
    }

    const existingIdx = entry.runs.findIndex((r) => r.runIndex === runIndex);
    const runEntry: CacheRunEntry = { runIndex, result, score };

    if (existingIdx >= 0) {
      entry.runs[existingIdx] = runEntry;
    } else {
      entry.runs.push(runEntry);
    }
  }

  getPromptHashes(): Record<string, string> {
    return this.data?.promptHashes ?? {};
  }
}

export function formatDiffReport(stage: CascadeStage, currentHashes: Record<string, string>, cachedHashes: Record<string, string>): string {
  if (stage === "none") return "  No prompt changes detected. Results identical to baseline.";

  const lines: string[] = [];
  lines.push(`  Cascade start: ${stage}`);
  lines.push("  Changed agents:");
  for (const name of PIPELINE_AGENTS) {
    if (currentHashes[name] !== cachedHashes[name]) {
      lines.push(`    ${name}: ${cachedHashes[name]} → ${currentHashes[name]}`);
    }
  }
  return lines.join("\n");
}
