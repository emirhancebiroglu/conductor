import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import type { CmFinding } from "@conductor/cm-core";
import { dispatchAgent } from "./dispatch.js";
import type { PlannerResult } from "./planner.js";

export type SastFixResult = {
  finding: CmFinding;
  fixStatus: "fixed" | "failed" | "skipped" | "needs_human";
  summary: string;
};

type SastFixOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  finding: CmFinding;
  workingDir: string;
  runConfig: { buildCommand?: string; testCommand?: string };
  planItem?: PlannerResult["items"][number] | undefined;
};

export async function processSastFinding(opts: SastFixOptions): Promise<SastFixResult> {
  const { supabase, agentRunner, scanId, workspaceId, finding, workingDir, runConfig, planItem } = opts;

  if (planItem?.strategy === "skip") {
    await supabase
      .from("cm_finding")
      .update({ fix_status: "skipped", fix_notes: planItem.notes })
      .eq("id", finding.id);
    return { finding, fixStatus: "skipped", summary: planItem.notes };
  }

  await supabase
    .from("cm_finding")
    .update({ fix_status: "fixing", fix_attempts: (finding.fixAttempts ?? 0) + 1 })
    .eq("id", finding.id);

  const taintTrace = (() => {
    if (!finding.taintFlow || finding.taintFlow.length === 0) return "";
    const lines = finding.taintFlow.map((n) => {
      const name = n.name ? ` (${n.name})` : "";
      return `  ${n.fileName}:${n.line}${name}`;
    }).join("\n");
    return `\nTaint flow:\n${lines}`;
  })();

  const buildCmd = runConfig.buildCommand ?? "";
  const notes = planItem?.notes ?? "";

  const task = {
    description: `Fix SAST security vulnerability in source code.

File: ${finding.file ?? "unknown"}
Line: ${finding.line ?? "unknown"}
Rule: ${finding.rule ?? "unknown"}
Severity: ${finding.severity}
Description: ${finding.description ?? "none"}${taintTrace}
Planner notes: ${notes}

Instructions:
1. Read the vulnerable file at ${finding.file ?? "(see rule)"}.
2. Use context7 to look up secure coding patterns for this vulnerability type.
3. Apply a minimal, targeted fix:
   - SQL injection: use parameterized queries / prepared statements
   - XSS: encode output, validate/sanitize input
   - Path traversal: validate/canonicalize paths
   - Command injection: avoid shell, use safe APIs
   - Other: follow OWASP guidance for the specific rule
4. Do NOT change unrelated code — minimize the diff.
5. Preserve all existing behavior and test assertions.
6. If a build command is configured, run it to verify compilation: ${buildCmd || "(none — skip)"}
7. If the fix cannot be applied safely (e.g., false positive, requires architectural change), report why and leave the file unchanged.

Working directory: ${workingDir}`,
    workingDir,
    ...(finding.file ? { contextFiles: [{ path: finding.file, label: "vulnerable file" }] } : {}),
  };

  try {
    const result = await dispatchAgent(
      supabase, agentRunner, "cm-sast-agent", scanId, workspaceId, task,
    );

    const fixStatus = result.changed ? "fixed" : "failed";
    await supabase
      .from("cm_finding")
      .update({ fix_status: fixStatus, fix_notes: result.summary.slice(0, 1000) })
      .eq("id", finding.id);

    return { finding, fixStatus, summary: result.summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("cm_finding")
      .update({ fix_status: "failed", fix_notes: msg.slice(0, 500) })
      .eq("id", finding.id);

    return { finding, fixStatus: "failed", summary: msg };
  }
}

type SastFindingsOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  findings: CmFinding[];
  workingDir: string;
  runConfig: { buildCommand?: string; testCommand?: string };
  planItems: PlannerResult["items"];
};

export async function processSastFindings(opts: SastFindingsOptions): Promise<SastFixResult[]> {
  const { supabase, findings, planItems } = opts;
  const results: SastFixResult[] = [];
  const planMap = new Map(planItems.map((i) => [i.fingerprint, i]));

  for (const finding of findings) {
    const planItem = planMap.get(finding.fingerprint);
    if (planItem?.strategy === "needs-human") {
      await supabase
        .from("cm_finding")
        .update({ fix_status: "needs_human", fix_notes: planItem.notes })
        .eq("id", finding.id);
      results.push({ finding, fixStatus: "needs_human", summary: planItem.notes });
      continue;
    }
    const result = await processSastFinding({ ...opts, finding, planItem });
    results.push(result);
  }

  return results;
}
