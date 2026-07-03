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

function parseVersion(v: string): SemverParts | null {
  const parts = v.split(".").map((s) => Number.parseInt(s, 10));
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return { major: parts[0]!, minor: parts[1]!, patch: parts[2]! };
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
type DispatchItem = { finding: CmFinding; planItem: PlanItem | undefined; impact: UpgradeImpact };

type ScaFindingsOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  findings: CmFinding[];
  policy: ScaTestPolicy;
  workingDir: string;
  runConfig: { buildCommand?: string; testCommand?: string };
  planItems: PlannerResult["items"];
};

function describeFinding({ finding, planItem, impact }: DispatchItem): string {
  const strategy = planItem?.strategy ?? "upgrade";
  const notes = planItem?.notes ?? "";

  if (strategy === "mitigate") {
    return `- fingerprint: ${finding.fingerprint}
  package: ${finding.package ?? "unknown"} v${finding.currentVersion ?? "?"} | severity: ${finding.severity} | rule: ${finding.rule ?? "unknown"}
  strategy: mitigate (${planItem?.mitigationKind ?? "none"}) — no clean upgrade available
  planner notes: ${notes}`;
  }

  const targetVer = planItem?.targetVersion ?? finding.fixedVersion ?? "unknown";
  return `- fingerprint: ${finding.fingerprint}
  package: ${finding.package ?? "unknown"} v${finding.currentVersion ?? "?"} → ${targetVer} | impact: ${impact} | severity: ${finding.severity} | rule: ${finding.rule ?? "unknown"}
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

    if (policy === "skip-minor" && impact === "MINOR" && !isMitigation) {
      await supabase
        .from("cm_finding")
        .update({ fix_status: "skipped", fix_notes: "MINOR upgrade skipped per sca_test_policy" })
        .eq("id", finding.id);
      decided.push({ finding, impact, tested: false, fixStatus: "skipped" });
      continue;
    }

    toDispatch.push({ finding, planItem, impact });
  }

  return { decided, toDispatch };
}

function buildBatchTask(toDispatch: DispatchItem[], runConfig: { buildCommand?: string; testCommand?: string }, workingDir: string): string {
  const buildCmd = runConfig.buildCommand ?? "";
  const testCmd = runConfig.testCommand ?? "";
  const findingsSummary = toDispatch.map(describeFinding).join("\n\n");

  return `Fix ${toDispatch.length} SCA (dependency) vulnerability finding(s) in this repo. Fix ALL of them in this single session.

For "upgrade" strategy findings:
1. Use context7 to look up the target version's changelog and API changes.
2. Use Tavily to research any breaking changes or known issues with the upgrade.
3. Find all manifest files (package.json, pom.xml, build.gradle, requirements.txt, etc.) declaring the dependency and apply the version bump.
4. If the new API has breaking changes, update the call sites accordingly.

For "mitigate" strategy findings (no clean upgrade available):
- override: add/extend npm overrides pinning the transitive dep to a patched version.
- resolution: add/extend yarn resolutions.
- dependency-management: pin via Maven <dependencyManagement> or Gradle resolutionStrategy.
- alias: alias the dependency to a patched build.
- replacement: swap the abandoned package for a maintained drop-in equivalent, update imports minimally.

After applying all fixes:
5. Run the build command to verify: ${buildCmd || "(none configured — skip build verification)"}
6. Run the test command to verify: ${testCmd || "(none configured — skip test verification)"}
7. If build or tests fail because of one of your changes, revert that specific change and mark it "failed" — don't let one bad fix block the others.
8. NEVER fake a fix — do what actually closes the finding.

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
  const { supabase, agentRunner, scanId, workspaceId, findings, policy, workingDir, runConfig, planItems } = opts;
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
    description: buildBatchTask(toDispatch, runConfig, workingDir),
    workingDir,
  };

  try {
    const result = await dispatchAgent(
      supabase, agentRunner, "cm-sca-agent", scanId, workspaceId, task,
    );

    const jsonMatch = /\{[\s\S]*\}/m.exec(result.summary);
    const parsed = jsonMatch ? CmBatchFixResultSchema.safeParse(JSON.parse(jsonMatch[0])) : null;
    const fallback: { fixStatus: "fixed" | "failed"; notes: string } = {
      fixStatus: result.changed ? "fixed" : "failed",
      notes: result.summary,
    };

    if (!parsed?.success) {
      console.warn(`[sca] batch fix result JSON missing/invalid for scan ${scanId}, falling back to overall changed status`);
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
