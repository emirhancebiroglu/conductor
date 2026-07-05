import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import { CmVerifyResultSchema, type CmVerifyOutcome } from "@conductor/cm-core";
import { dispatchAgent } from "./dispatch.js";
import { extractErrorSignature, signaturesMatch } from "./build-runner.js";

export type VerifierResult = {
  outcome: CmVerifyOutcome;
  summary: string;
};

type VerifierOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  /** The fix branch's own build/test run (already executed by the caller — see pipeline/build-runner.ts). */
  buildExitCode: number;
  buildOutput: string;
  /** Error signature extracted from the unmodified baseline build (pipeline/fix-graph.ts's baselineCheck node), if one was captured. */
  baselineErrorSignature?: string[];
};

/**
 * Classifies a build/test result as pass / fail_regression / fail_preexisting.
 *
 * Deterministic-first, by design: an LLM reading a raw build log is at the
 * mercy of its CLI's tool-output truncation (Claude Code caps at 30k chars,
 * opencode at 2000 lines/50KB — different limits, same risk) and its own
 * attention across a long, noisy log. Confirmed in production: the verifier
 * correctly diagnosed one scan's npm registry failure but hallucinated a
 * different, wrong cause for another scan with the exact same failure
 * signature. So the mechanical part — did it fail, and is that failure the
 * same one the baseline already had — is handled by exit codes and regex
 * extraction, never by asking a model to self-report what it read. The LLM
 * is only asked to classify the rare genuinely-ambiguous case, given the
 * pre-extracted evidence directly, not a raw log to search through.
 */
export async function runVerifier(opts: VerifierOptions): Promise<VerifierResult> {
  const { supabase, agentRunner, scanId, workspaceId, buildExitCode, buildOutput, baselineErrorSignature } = opts;

  if (buildExitCode === 0) {
    console.log(`[verifier] scan ${scanId}: build/test exited 0 — pass (no agent dispatch)`);
    return { outcome: "pass", summary: "Build and tests passed." };
  }

  const currentSignature = extractErrorSignature(buildOutput);

  if (baselineErrorSignature && signaturesMatch(currentSignature, baselineErrorSignature)) {
    console.log(`[verifier] scan ${scanId}: failure signature matches baseline exactly — fail_preexisting (no agent dispatch)`);
    return {
      outcome: "fail_preexisting",
      summary: `Build/test failure matches the unmodified baseline exactly (same ${currentSignature.length} error signature line(s)) — pre-existing, unrelated to this fix.\n${currentSignature.join("\n")}`,
    };
  }

  return classifyWithAgent({ supabase, agentRunner, scanId, workspaceId, currentSignature, baselineErrorSignature, buildOutput });
}

async function classifyWithAgent(opts: {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  currentSignature: string[];
  baselineErrorSignature: string[] | undefined;
  buildOutput: string;
}): Promise<VerifierResult> {
  const { supabase, agentRunner, scanId, workspaceId, currentSignature, baselineErrorSignature, buildOutput } = opts;

  const baselineSection = baselineErrorSignature
    ? `Baseline (unmodified code) failure signature:\n${baselineErrorSignature.length > 0 ? baselineErrorSignature.join("\n") : "(baseline build/test passed cleanly — no errors)"}`
    : "No baseline was captured for this scan.";

  const currentSection = currentSignature.length > 0
    ? currentSignature.join("\n")
    : "(no recognizable error markers extracted — see raw excerpt below)";

  const task = {
    description: `${baselineSection}

Current (fix branch) failure signature:
${currentSection}

Raw build output excerpt (for context only, the signatures above are the ground truth):
\`\`\`
${buildOutput.slice(-3000)}
\`\`\``,
    workingDir: process.cwd(),
  };

  console.log(`[verifier] scan ${scanId}: signatures differ from baseline, dispatching cm-fix-verifier for classification`);

  const result = await dispatchAgent(
    supabase, agentRunner, "cm-fix-verifier", scanId, workspaceId, task,
  );

  const jsonMatch = /\{[\s\S]*\}/m.exec(result.summary);
  const parsed = jsonMatch ? CmVerifyResultSchema.safeParse(JSON.parse(jsonMatch[0])) : null;

  if (!parsed?.success) {
    // why: unparseable verdict must never silently unblock — treat it as a
    // regression so a human looks at it.
    console.warn(`[verifier] scan ${scanId}: classification JSON missing/invalid, treating as fail_regression`);
    return { outcome: "fail_regression", summary: result.summary };
  }

  const { outcome, summary } = parsed.data;
  console.log(`[verifier] result: ${outcome.toUpperCase()} — ${summary.slice(0, 200)}`);
  return { outcome, summary };
}
