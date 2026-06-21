import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner } from "@conductor/cm-adapters";
import type { CmFinding, CmFixStrategy, CmCategory, CmMitigationKind } from "@conductor/cm-core";
import { CmFixPlanSchema } from "@conductor/cm-core";
import { dispatchAgent } from "./dispatch.js";

export type PlannerResultItem = {
  fingerprint: string;
  strategy: CmFixStrategy;
  category: CmCategory;
  reachable: boolean;
  exploitable: boolean;
  falsePositive: boolean;
  mitigationKind?: CmMitigationKind;
  priority: number;
  confidence: number;
  notes: string;
  targetVersion?: string;
};

export type PlannerResult = {
  items: PlannerResultItem[];
};

export async function runPlanner(
  supabase: SupabaseClient,
  agentRunner: AgentRunner,
  scanId: string,
  workspaceId: string,
  findings: CmFinding[],
  workingDir: string,
): Promise<PlannerResult> {
  const findingsSummary = findings.map((f) => {
    const location = f.source === "sast"
      ? `file: ${f.file ?? "unknown"}:${f.line ?? 0}`
      : `package: ${f.package ?? "unknown"} v${f.currentVersion ?? "?"} → ${f.fixedVersion ?? "?"}`;
    const taint = f.taintFlow && f.taintFlow.length > 0
      ? `\n    taint: ${f.taintFlow.slice(0, 3).map((n) => `${n.fileName}:${n.line}`).join(" → ")}`
      : "";
    return `- fingerprint: ${f.fingerprint}
  source: ${f.source} | severity: ${f.severity} | rule: ${f.rule ?? "unknown"}
  ${location}${taint}
  description: ${f.description ?? "none"}`;
  }).join("\n\n");

  const task = {
    description: `Triage the following ${findings.length} security finding(s) from a Checkmarx scan.

For each finding, determine:
1. Is the vulnerable code/dependency actually reachable in this codebase?
2. Is it practically exploitable given the context?
3. Category: frontend | backend | shared | infra (where the fix lands).
4. What is the fix strategy:
   - "upgrade" — SCA finding with a clean fixed version available.
   - "mitigate" — SCA with NO safe direct upgrade (transitive, abandoned, breaking). Pick a mitigationKind.
   - "code-fix" — SAST finding fixed in source.
   - "skip" — ONLY genuine false positive (set falsePositive=true, justify in notes).
   - "needs-human" — real finding with no safe automated fix.
5. For upgrades: what is the safe target version (latest non-breaking patch/minor, or major if required)?
6. Priority 1-10 (10 = fix immediately). confidence 0-1.
7. CRITICAL/HIGH only get auto-fixed. MEDIUM/LOW → "skip" (if false positive) or "needs-human".

Use Tavily to research CVE details, GitHub advisories, and real-world exploitability.
Use context7 to check library changelogs and breaking-change notes for version upgrades.

Return ONLY a valid JSON object matching this schema (no markdown, no explanation):
{
  "findings": [
    {
      "fingerprint": "<exact fingerprint from input>",
      "strategy": "upgrade" | "mitigate" | "code-fix" | "skip" | "needs-human",
      "category": "frontend" | "backend" | "shared" | "infra",
      "reachable": true | false,
      "exploitable": true | false,
      "falsePositive": true | false,
      "mitigationKind": "override" | "resolution" | "dependency-management" | "alias" | "replacement" | "none",
      "priority": 1-10,
      "confidence": 0.0-1.0,
      "notes": "<reasoning with cited evidence>",
      "targetVersion": "<semver string, only for upgrade strategy>"
    }
  ]
}

Findings to triage:
${findingsSummary}`,
    workingDir,
  };

  console.log(`[planner] triaging ${findings.length} findings for scan ${scanId}`);

  const result = await dispatchAgent(
    supabase, agentRunner, "cm-fix-planner", scanId, workspaceId, task,
  );

  // Parse agent output — try to extract JSON from the summary/output
  let plan: PlannerResult = { items: [] };
  try {
    const jsonMatch = /\{[\s\S]*\}/m.exec(result.summary);
    if (jsonMatch) {
      const parsed = CmFixPlanSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (parsed.success) {
        plan = {
          items: parsed.data.findings.map((item) => {
            const result: PlannerResultItem = {
              fingerprint: item.fingerprint,
              strategy: item.strategy,
              category: item.category,
              reachable: item.reachable,
              exploitable: item.exploitable,
              falsePositive: item.falsePositive,
              priority: item.priority,
              confidence: item.confidence,
              notes: item.notes,
            };
            if (item.targetVersion !== undefined) result.targetVersion = item.targetVersion;
            if (item.mitigationKind !== undefined && item.mitigationKind !== "none") result.mitigationKind = item.mitigationKind;
            return result;
          }),
        };
      } else {
        console.warn(`[planner] fix plan schema validation failed:`, parsed.error.flatten());
      }
    } else {
      console.warn(`[planner] no JSON found in agent output, using fallback plan`);
    }
  } catch {
    console.warn(`[planner] JSON parse failed, using fallback plan`);
  }

  // Fallback: if no valid plan, default all findings to their natural strategy
  if (plan.items.length === 0) {
    plan.items = findings.map((f) => {
      const base: PlannerResultItem = {
        fingerprint: f.fingerprint,
        strategy: f.source === "sca" ? "upgrade" : "code-fix",
        category: "shared",
        reachable: true,
        exploitable: true,
        falsePositive: false,
        priority: f.severity === "CRITICAL" ? 10 : f.severity === "HIGH" ? 7 : 4,
        confidence: 0.7,
        notes: "fallback: planner output unparseable",
      };
      if (f.fixedVersion) base.targetVersion = f.fixedVersion;
      return base;
    });
  }

  // Persist plan decisions to cm_finding.fix_notes
  for (const item of plan.items) {
    let fixStatus: string;
    if (item.strategy === "skip" && item.falsePositive) {
      fixStatus = "skipped";
    } else if (item.strategy === "needs-human") {
      fixStatus = "needs_human";
    } else {
      fixStatus = "open";
    }

    await supabase
      .from("cm_finding")
      .update({
        fix_notes: JSON.stringify(item),
        fix_status: fixStatus,
      })
      .eq("scan_id", scanId)
      .eq("fingerprint", item.fingerprint);
  }

  // Sort by priority desc
  plan.items.sort((a, b) => b.priority - a.priority);

  console.log(`[planner] plan ready: ${plan.items.filter((i) => i.strategy !== "skip").length} to fix, ${plan.items.filter((i) => i.strategy === "skip").length} skipped`);
  return plan;
}
