import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import type { CmFinding } from "@conductor/cm-core";
import { CmBatchFixResultSchema } from "@conductor/cm-core";
import { dispatchAgent } from "./dispatch.js";
import type { PlannerResult } from "./planner.js";

export type SastFixResult = {
  finding: CmFinding;
  fixStatus: "fixed" | "failed" | "skipped" | "needs_human";
  summary: string;
};

type PlanItem = PlannerResult["items"][number];
type DispatchItem = { finding: CmFinding; planItem: PlanItem | undefined };

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

function describeFinding({ finding, planItem }: DispatchItem): string {
  const taintTrace = (() => {
    if (!finding.taintFlow || finding.taintFlow.length === 0) return "";
    const lines = finding.taintFlow.map((n) => {
      const name = n.name ? ` (${n.name})` : "";
      return `    ${n.fileName}:${n.line}${name}`;
    }).join("\n");
    return `\n  taint flow:\n${lines}`;
  })();

  return `- fingerprint: ${finding.fingerprint}
  file: ${finding.file ?? "unknown"}:${finding.line ?? "unknown"} | severity: ${finding.severity} | rule: ${finding.rule ?? "unknown"}
  description: ${finding.description ?? "none"}${taintTrace}
  planner notes: ${planItem?.notes ?? "none"}`;
}

/** Splits findings into ones already decided (needs-human, persisted immediately) vs ones to send to the agent. */
async function preFilterFindings(
  supabase: SupabaseClient,
  findings: CmFinding[],
  planMap: Map<string, PlanItem>,
): Promise<{ decided: SastFixResult[]; toDispatch: DispatchItem[] }> {
  const decided: SastFixResult[] = [];
  const toDispatch: DispatchItem[] = [];

  for (const finding of findings) {
    const planItem = planMap.get(finding.fingerprint);

    if (planItem?.strategy === "needs-human") {
      await supabase
        .from("cm_finding")
        .update({ fix_status: "needs_human", fix_notes: planItem.notes })
        .eq("id", finding.id);
      decided.push({ finding, fixStatus: "needs_human", summary: planItem.notes });
      continue;
    }

    if (planItem?.strategy === "skip") {
      await supabase
        .from("cm_finding")
        .update({ fix_status: "skipped", fix_notes: planItem.notes })
        .eq("id", finding.id);
      decided.push({ finding, fixStatus: "skipped", summary: planItem.notes });
      continue;
    }

    toDispatch.push({ finding, planItem });
  }

  return { decided, toDispatch };
}

function buildBatchTask(toDispatch: DispatchItem[], runConfig: { buildCommand?: string; testCommand?: string }, workingDir: string): string {
  const buildCmd = runConfig.buildCommand ?? "";
  const findingsSummary = toDispatch.map(describeFinding).join("\n\n");

  return `Fix ${toDispatch.length} SAST security vulnerability finding(s) in source code. Fix ALL of them in this single session.

Instructions:
1. Read each vulnerable file listed below.
2. Use context7 to look up secure coding patterns for each vulnerability type.
3. Apply a minimal, targeted fix per finding:
   - SQL injection: use parameterized queries / prepared statements
   - XSS: encode output, validate/sanitize input
   - Path traversal: validate/canonicalize paths
   - Command injection: avoid shell, use safe APIs
   - Other: follow OWASP guidance for the specific rule
4. Do NOT change unrelated code — minimize the diff, one finding's fix should not touch another finding's file unless truly shared.
5. Preserve all existing behavior and test assertions.
6. If a build command is configured, run it to verify compilation: ${buildCmd || "(none — skip)"}
7. If a specific fix cannot be applied safely (false positive, requires architectural change), leave that file unchanged and mark it "failed" — don't let one finding block the others.

Findings to fix:
${findingsSummary}

Return your final message as ONLY a valid JSON object (no markdown, no extra prose) matching this schema:
{
  "results": [
    { "fingerprint": "<exact fingerprint from input>", "fixStatus": "fixed" | "failed" | "skipped", "notes": "<what you did or why it failed>" }
  ]
}

Working directory: ${workingDir}`;
}

/** Persists a fixStatus per dispatched finding, preferring the agent's per-finding JSON verdict, falling back to a single shared status/notes. */
async function persistDispatchResults(
  supabase: SupabaseClient,
  toDispatch: DispatchItem[],
  byFingerprint: Map<string, { fixStatus: "fixed" | "failed" | "skipped"; notes: string }> | null,
  fallback: { fixStatus: "fixed" | "failed"; notes: string },
): Promise<SastFixResult[]> {
  const results: SastFixResult[] = [];
  for (const { finding } of toDispatch) {
    const item = byFingerprint?.get(finding.fingerprint);
    const fixStatus = item?.fixStatus ?? fallback.fixStatus;
    const notes = item?.notes ?? fallback.notes;
    await supabase
      .from("cm_finding")
      .update({ fix_status: fixStatus, fix_notes: notes.slice(0, 1000) })
      .eq("id", finding.id);
    results.push({ finding, fixStatus, summary: notes });
  }
  return results;
}

export async function processSastFindings(opts: SastFindingsOptions): Promise<SastFixResult[]> {
  const { supabase, agentRunner, scanId, workspaceId, findings, workingDir, runConfig, planItems } = opts;
  const planMap = new Map(planItems.map((i) => [i.fingerprint, i]));

  const { decided, toDispatch } = await preFilterFindings(supabase, findings, planMap);
  if (toDispatch.length === 0) {
    return decided;
  }

  await supabase
    .from("cm_finding")
    .update({ fix_status: "fixing" })
    .in("id", toDispatch.map((d) => d.finding.id));

  const task = {
    description: buildBatchTask(toDispatch, runConfig, workingDir),
    workingDir,
    contextFiles: toDispatch
      .filter((d) => d.finding.file)
      .map((d) => ({ path: d.finding.file as string, label: `vulnerable file (${d.finding.fingerprint})` })),
  };

  try {
    const result = await dispatchAgent(
      supabase, agentRunner, "cm-sast-agent", scanId, workspaceId, task,
    );

    const jsonMatch = /\{[\s\S]*\}/m.exec(result.summary);
    const parsed = jsonMatch ? CmBatchFixResultSchema.safeParse(JSON.parse(jsonMatch[0])) : null;
    const fallback: { fixStatus: "fixed" | "failed"; notes: string } = {
      fixStatus: result.changed ? "fixed" : "failed",
      notes: result.summary,
    };

    if (!parsed?.success) {
      console.warn(`[sast] batch fix result JSON missing/invalid for scan ${scanId}, falling back to overall changed status`);
    }

    const byFingerprint = parsed?.success
      ? new Map(parsed.data.results.map((r) => [r.fingerprint, r]))
      : null;

    const dispatched = await persistDispatchResults(supabase, toDispatch, byFingerprint, fallback);
    return [...decided, ...dispatched];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const dispatched = await persistDispatchResults(supabase, toDispatch, null, { fixStatus: "failed", notes: msg });
    return [...decided, ...dispatched];
  }
}
