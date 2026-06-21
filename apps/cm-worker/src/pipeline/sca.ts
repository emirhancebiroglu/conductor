import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import type { CmFinding } from "@conductor/cm-core";
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
// Real SCA fix via agent
// ---------------------------------------------------------------------------

type ScaFixOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  finding: CmFinding;
  policy: ScaTestPolicy;
  workingDir: string;
  runConfig: { buildCommand?: string; testCommand?: string };
  planItem?: PlannerResult["items"][number] | undefined;
};

export async function processScaFinding(opts: ScaFixOptions): Promise<ScaFixResult> {
  const { supabase, agentRunner, scanId, workspaceId, finding, policy, workingDir, runConfig, planItem } = opts;
  const currentVer = finding.currentVersion ?? "0.0.0";
  const targetVer = planItem?.targetVersion ?? finding.fixedVersion ?? currentVer;
  const impact = labelUpgradeImpact(currentVer, targetVer);

  // Under skip-minor policy, skip MINOR findings without agent dispatch
  if (policy === "skip-minor" && impact === "MINOR") {
    await supabase
      .from("cm_finding")
      .update({ fix_status: "skipped", fix_notes: "MINOR upgrade skipped per sca_test_policy" })
      .eq("id", finding.id);

    return { finding, impact, tested: false, fixStatus: "skipped" };
  }

  // Mark as fixing
  await supabase
    .from("cm_finding")
    .update({ fix_status: "fixing", fix_attempts: (finding.fixAttempts ?? 0) + 1 })
    .eq("id", finding.id);

  const buildCmd = runConfig.buildCommand ?? "";
  const testCmd = runConfig.testCommand ?? "";
  const notes = planItem?.notes ?? "";
  const strategy = planItem?.strategy ?? "upgrade";
  const mitigationKind = planItem?.mitigationKind;

  const description = strategy === "mitigate"
    ? `Mitigate SCA vulnerability: no clean upgrade available.

Package: ${finding.package ?? "unknown"}
Current version: ${currentVer}
Severity: ${finding.severity}
CVE/Rule: ${finding.rule ?? "unknown"}
Planner notes: ${notes}
Mitigation kind: ${mitigationKind ?? "none"}

Instructions:
1. Use the planner's mitigation strategy (${mitigationKind}). Apply it the way a human would to close the finding.
2. ${mitigationKind === "override" ? "Add/extend npm overrides pinning the transitive dep to a patched version." : ""}
   ${mitigationKind === "resolution" ? "Add/extend yarn resolutions." : ""}
   ${mitigationKind === "dependency-management" ? "Pin via Maven <dependencyManagement> or Gradle resolutionStrategy." : ""}
   ${mitigationKind === "alias" ? "Alias the dependency to a patched build." : ""}
   ${mitigationKind === "replacement" ? "Swap the abandoned package for a maintained drop-in equivalent and update imports minimally." : ""}
3. Run the build command to verify: ${buildCmd || "(none configured — skip build verification)"}
4. Run the test command to verify: ${testCmd || "(none configured — skip test verification)"}
5. If build or tests fail, revert the change and report failure.
6. NEVER fake a fix — do what actually closes the finding.

Working directory: ${workingDir}`
    : `Fix SCA vulnerability: upgrade dependency to resolve a security finding.

Package: ${finding.package ?? "unknown"}
Current version: ${currentVer}
Target version: ${targetVer}
Severity: ${finding.severity}
CVE/Rule: ${finding.rule ?? "unknown"}
Impact: ${impact}
Planner notes: ${notes}

Instructions:
1. Use context7 to look up the target version's changelog and API changes.
2. Use Tavily to research any breaking changes or known issues with the upgrade.
3. Find all manifest files (package.json, pom.xml, build.gradle, requirements.txt, etc.) that declare this dependency.
4. Apply the version upgrade to ${targetVer} in the manifest(s).
5. If the new API has breaking changes, update the call sites accordingly.
6. Run the build command to verify: ${buildCmd || "(none configured — skip build verification)"}
7. Run the test command to verify: ${testCmd || "(none configured — skip test verification)"}
8. If build or tests fail, revert the change and report failure.

Working directory: ${workingDir}`;

  const task = {
    description,
    workingDir,
  };

  try {
    const result = await dispatchAgent(
      supabase, agentRunner, "cm-sca-agent", scanId, workspaceId, task,
    );

    const fixStatus = result.changed ? "fixed" : "failed";
    await supabase
      .from("cm_finding")
      .update({
        fix_status: fixStatus,
        fix_notes: result.summary.slice(0, 1000),
        upgrade_impact: impact,
      })
      .eq("id", finding.id);

    return { finding, impact, tested: true, fixStatus };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("cm_finding")
      .update({ fix_status: "failed", fix_notes: msg.slice(0, 500) })
      .eq("id", finding.id);

    return { finding, impact, tested: true, fixStatus: "failed" };
  }
}

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

export async function processScaFindings(opts: ScaFindingsOptions): Promise<ScaFixResult[]> {
  const { supabase, findings, planItems } = opts;
  const results: ScaFixResult[] = [];
  const planMap = new Map(planItems.map((i) => [i.fingerprint, i]));

  for (const finding of findings) {
    const planItem = planMap.get(finding.fingerprint);
    if (planItem?.strategy === "skip" || planItem?.strategy === "needs-human") {
      const fixStatus = planItem.strategy === "skip" ? "skipped" : "needs_human";
      await supabase
        .from("cm_finding")
        .update({ fix_status: fixStatus, fix_notes: planItem.notes })
        .eq("id", finding.id);
      results.push({ finding, impact: "MINOR", tested: false, fixStatus });
      continue;
    }

    const result = await processScaFinding({ ...opts, finding, planItem });
    results.push(result);
  }

  return results;
}
