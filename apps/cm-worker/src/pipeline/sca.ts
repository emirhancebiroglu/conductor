import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import type { CmFinding } from "@conductor/cm-core";
import { CmBatchFixResultSchema } from "@conductor/cm-core";
import { dispatchAgent } from "./dispatch.js";
import type { PlannerResult } from "./planner.js";

export type UpgradeImpact = "MINOR" | "MID" | "MAJOR";

export type ScaTestPolicy = "skip-minor" | "test-all";

export type ScaFixResult = {
  finding: CmFinding;
  impact: UpgradeImpact;
  tested: boolean;
  fixStatus: "fixed" | "skipped" | "failed" | "needs_human";
};

// ---------------------------------------------------------------------------
// Semver helpers (kept for policy routing — not the actual upgrade logic)
// ---------------------------------------------------------------------------

type SemverParts = { major: number; minor: number; patch: number };

// why: real version strings frequently carry a trailing vendor/build suffix
// that isn't itself numeric (e.g. "12.8.1.jre11", "4.1.115.Final",
// "2.18.2.redhat-00002") — only the leading major.minor.patch triple matters
// for impact classification. Splitting on "." and requiring every part to
// parse as a number (the old approach) made any suffixed version look
// "unparseable" and fall back to MAJOR, which corrupted the impact column
// for a large fraction of real Checkmarx SCA findings (Java/Maven ecosystem
// versions almost always carry a suffix).
function parseVersion(v: string): SemverParts | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function labelUpgradeImpact(current: string, target: string): UpgradeImpact {
  const cur = parseVersion(current);
  const tgt = parseVersion(target);
  if (!cur || !tgt) return "MAJOR";
  if (tgt.major !== cur.major) return "MAJOR";
  if (tgt.minor !== cur.minor) return "MID";
  return "MINOR";
}

// ---------------------------------------------------------------------------
// Real SCA fix via agent — one batched dispatch per fix attempt, not one
// dispatch per finding (spawn count must not scale with finding count).
// ---------------------------------------------------------------------------

type PlanItem = PlannerResult["items"][number];
type DispatchItem = { finding: CmFinding; planItem: PlanItem | undefined; impact: UpgradeImpact; skipTest: boolean };

type ScaFindingsOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  findings: CmFinding[];
  policy: ScaTestPolicy;
  workingDir: string;
  planItems: PlannerResult["items"];
};

function describeFinding({ finding, planItem, impact, skipTest }: DispatchItem): string {
  const strategy = planItem?.strategy ?? "upgrade";
  const notes = planItem?.notes ?? "";
  const testNote = skipTest ? " | test: SKIP (MINOR upgrade per sca_test_policy — still apply the fix, just skip build/test verification for this one)" : "";

  if (strategy === "mitigate") {
    return `- fingerprint: ${finding.fingerprint}
  package: ${finding.package ?? "unknown"} v${finding.currentVersion ?? "?"} | severity: ${finding.severity} | rule: ${finding.rule ?? "unknown"}
  strategy: mitigate (${planItem?.mitigationKind ?? "none"}) — no clean upgrade available
  planner notes: ${notes}`;
  }

  const targetVer = planItem?.targetVersion ?? finding.fixedVersion ?? "unknown";
  return `- fingerprint: ${finding.fingerprint}
  package: ${finding.package ?? "unknown"} v${finding.currentVersion ?? "?"} → ${targetVer} | impact: ${impact} | severity: ${finding.severity} | rule: ${finding.rule ?? "unknown"}${testNote}
  planner notes: ${notes}`;
}

/** Splits findings into ones already decided (skip/needs-human/minor-skip, persisted immediately) vs ones to send to the agent. */
async function preFilterFindings(
  supabase: SupabaseClient,
  findings: CmFinding[],
  planMap: Map<string, PlanItem>,
  policy: ScaTestPolicy,
): Promise<{ decided: ScaFixResult[]; toDispatch: DispatchItem[] }> {
  const decided: ScaFixResult[] = [];
  const toDispatch: DispatchItem[] = [];

  for (const finding of findings) {
    const planItem = planMap.get(finding.fingerprint);

    if (planItem?.strategy === "skip" || planItem?.strategy === "needs-human") {
      const fixStatus = planItem.strategy === "skip" ? "skipped" : "needs_human";
      await supabase
        .from("cm_finding")
        .update({ fix_status: fixStatus, fix_notes: planItem.notes })
        .eq("id", finding.id);
      decided.push({ finding, impact: "MINOR", tested: false, fixStatus });
      continue;
    }

    const currentVer = finding.currentVersion ?? "0.0.0";
    const targetVer = planItem?.targetVersion ?? finding.fixedVersion ?? currentVer;
    const impact = labelUpgradeImpact(currentVer, targetVer);
    const isMitigation = planItem?.strategy === "mitigate";

    // why: skip-minor policy means "don't spend build/test time re-verifying
    // a MINOR bump" — it must NOT mean "don't fix it". A CRITICAL/HIGH finding
    // (this is the only severity that ever reaches this pipeline) still needs
    // its version bumped and dependency-tree-confirmed; only the build/test
    // run is skippable. Confirmed in production: the old "skip the fix
    // entirely" behavior left dozens of real CRITICAL/HIGH SCA findings
    // completely untouched while still being marked "skipped" and let the
    // pipeline report "verified".
    const skipTest = policy === "skip-minor" && impact === "MINOR" && !isMitigation;

    toDispatch.push({ finding, planItem, impact, skipTest });
  }

  return { decided, toDispatch };
}

// why: build/test verification is intentionally NOT part of this task prompt —
// the pipeline's separate deterministic verifier (build-runner.ts's
// runBuildDeterministic, invoked once from fix-graph.ts's verify step) already
// runs build+test after all fixes land. Injecting buildCommand/testCommand here
// used to reinforce the agent re-running its own build/test per finding (real
// production waste: a 21-finding run re-ran mvn install/mvn test ~5 times back
// to back instead of once), duplicating work the verifier already does
// correctly. The agent's own system prompt now confirms only the dependency
// tree resolves to the target version — that's the one thing only it can do.
function buildBatchTask(toDispatch: DispatchItem[], workingDir: string): string {
  const findingsSummary = toDispatch.map(describeFinding).join("\n\n");

  return `Fix ${toDispatch.length} SCA (dependency) vulnerability finding(s) in this repo, per your system prompt's process and rules. Fix ALL of them in this single session.

Findings to fix:
${findingsSummary}

Working directory: ${workingDir}`;
}

/** Persists a fixStatus per dispatched finding, preferring the agent's per-finding JSON verdict, falling back to a single shared status/notes. */
async function persistDispatchResults(
  supabase: SupabaseClient,
  toDispatch: DispatchItem[],
  byFingerprint: Map<string, { fixStatus: "fixed" | "failed" | "skipped"; notes: string }> | null,
  fallback: { fixStatus: "fixed" | "failed"; notes: string },
): Promise<ScaFixResult[]> {
  const results: ScaFixResult[] = [];
  for (const { finding, impact } of toDispatch) {
    const item = byFingerprint?.get(finding.fingerprint);
    const fixStatus = item?.fixStatus ?? fallback.fixStatus;
    const notes = item?.notes ?? fallback.notes;
    await supabase
      .from("cm_finding")
      .update({ fix_status: fixStatus, fix_notes: notes.slice(0, 1000), upgrade_impact: impact })
      .eq("id", finding.id);
    results.push({ finding, impact, tested: true, fixStatus });
  }
  return results;
}

export async function processScaFindings(opts: ScaFindingsOptions): Promise<ScaFixResult[]> {
  const { supabase, agentRunner, scanId, workspaceId, findings, policy, workingDir, planItems } = opts;
  const planMap = new Map(planItems.map((i) => [i.fingerprint, i]));

  const { decided, toDispatch } = await preFilterFindings(supabase, findings, planMap, policy);
  if (toDispatch.length === 0) {
    return decided;
  }

  await supabase
    .from("cm_finding")
    .update({ fix_status: "fixing" })
    .in("id", toDispatch.map((d) => d.finding.id));

  const task = {
    description: buildBatchTask(toDispatch, workingDir),
    workingDir,
  };

  try {
    const result = await dispatchAgent(
      supabase, agentRunner, "cm-sca-agent", scanId, workspaceId, task,
    );

    const jsonMatch = /\{[\s\S]*\}/m.exec(result.summary);
    const parsed = jsonMatch ? CmBatchFixResultSchema.safeParse(JSON.parse(jsonMatch[0])) : null;
    // why: `changed` (git diff) is not proof of a completed, verified fix —
    // an agent killed mid-task (timeout) can leave partial edits behind that
    // still register as "changed". Only treat the fallback as "fixed" when
    // the agent process itself exited cleanly (result.success); a killed or
    // failed process always falls back to "failed" regardless of git state,
    // since no per-finding JSON verdict from it can be trusted either way.
    const fallback: { fixStatus: "fixed" | "failed"; notes: string } = {
      fixStatus: result.success && result.changed ? "fixed" : "failed",
      notes: result.summary,
    };

    if (!parsed?.success) {
      console.warn(`[sca] batch fix result JSON missing/invalid for scan ${scanId}, falling back to overall changed status (agent success=${result.success})`);
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
