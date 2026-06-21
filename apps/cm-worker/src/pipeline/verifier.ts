import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import { dispatchAgent } from "./dispatch.js";

export type VerifierResult = {
  passed: boolean;
  summary: string;
};

type VerifierOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  workingDir: string;
  runConfig: { buildCommand?: string; testCommand?: string };
};

export async function runVerifier(opts: VerifierOptions): Promise<VerifierResult> {
  const { supabase, agentRunner, scanId, workspaceId, workingDir, runConfig } = opts;

  const buildCmd = runConfig.buildCommand ?? "";
  const testCmd = runConfig.testCommand ?? "";

  if (!buildCmd && !testCmd) {
    console.log(`[verifier] no build/test commands configured — skipping verification, assuming pass`);
    return { passed: true, summary: "no build/test commands configured" };
  }

  const task = {
    description: `Verify that security fixes did not break the project.

Run the following in the working directory:
${buildCmd ? `Build: ${buildCmd}` : ""}
${testCmd ? `Tests: ${testCmd}` : ""}

Instructions:
1. Run the build command (if configured). If it fails, report FAIL with the error output.
2. Run the test command (if configured). If any tests fail, report which tests failed.
3. If both pass (or are not configured), report PASS.
4. Do NOT modify any source files — this is a read-only verification step.
5. Output a concise summary starting with either "PASS:" or "FAIL:" followed by details.

Working directory: ${workingDir}`,
    workingDir,
  };

  console.log(`[verifier] running build/test verification for scan ${scanId}`);

  const result = await dispatchAgent(
    supabase, agentRunner, "cm-fix-verifier", scanId, workspaceId, task,
  );

  const passed = result.summary.trim().toUpperCase().startsWith("PASS:");

  console.log(`[verifier] result: ${passed ? "PASS" : "FAIL"} — ${result.summary.slice(0, 200)}`);

  return { passed, summary: result.summary };
}
