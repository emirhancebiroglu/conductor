import { execa } from "execa";

export type RunConfig = {
  buildCommand?: string;
  testCommand?: string;
};

export type BuildResult = {
  exitCode: number;
  output: string;
};

/**
 * Runs the configured build/test commands deterministically (no agent, no LLM)
 * and captures raw combined stdout+stderr. Shared by the baseline check and
 * the verify step so both compare apples-to-apples.
 */
export async function runBuildDeterministic(dir: string, runConfig: RunConfig): Promise<BuildResult> {
  let output = "";
  let exitCode = 0;

  for (const cmd of [runConfig.buildCommand, runConfig.testCommand]) {
    if (!cmd) continue;
    const res = await execa(cmd, { shell: true, cwd: dir, reject: false, timeout: 5 * 60 * 1000 });
    output += `$ ${cmd}\n${res.stdout}\n${res.stderr}\n`;
    if ((res.exitCode ?? 0) !== 0) {
      exitCode = res.exitCode ?? 1;
      break; // don't run tests if the build itself already failed
    }
  }

  return { exitCode, output: output.trim() };
}

// ---------------------------------------------------------------------------
// Deterministic error-signature extraction — no LLM involved. This is what
// would have caught the same npm ENOVERSIONS failure identically in both the
// ms-imei and ms-tasier scans, instead of leaving it to an agent to read a
// raw build log and possibly misdiagnose it (confirmed: it did, for ms-imei).
// ---------------------------------------------------------------------------

const ERROR_PATTERNS: RegExp[] = [
  /npm ERR!.*$/gm,
  /No versions available for \S+/g,
  /E[A-Z]{3,}\b/g, // npm error codes: ENOVERSIONS, ENOTFOUND, ETARGET, etc.
  /^\[ERROR\].*$/gm,
  /BUILD FAILURE/g,
  /Exception in thread .*$/gm,
  /Traceback \(most recent call last\):/g,
  /^.*FAILED\b.*$/gm,
];

/**
 * Normalizes a matched line so two runs failing for the *same* underlying
 * reason produce identical signatures even though they executed in different
 * temp clone directories (which would otherwise defeat a naive string diff).
 */
function normalize(line: string): string {
  return line
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>") // Windows absolute paths
    .replace(/\/[^\s"']*\/(cx-|cm-|fix-graph-)[^\s"']*/g, "<path>") // our own temp dirs
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, "<timestamp>")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractErrorSignature(output: string): string[] {
  const matches = new Set<string>();
  for (const pattern of ERROR_PATTERNS) {
    for (const match of output.matchAll(pattern)) {
      const normalized = normalize(match[0]);
      if (normalized) matches.add(normalized);
    }
  }
  return [...matches].sort((a, b) => a.localeCompare(b));
}

/** Set-equality on two extracted signatures. */
export function signaturesMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x.localeCompare(y));
  const sortedB = [...b].sort((x, y) => x.localeCompare(y));
  return sortedA.every((line, i) => line === sortedB[i]);
}
