import { existsSync } from "node:fs";
import { join } from "node:path";
import { StateGraph, Annotation, START, END, interrupt, type CompiledStateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanProvider, AgentRunner } from "@conductor/cm-adapters";
import { GitOps } from "@conductor/cm-adapters";
import type { CmFinding } from "@conductor/cm-core";
import { filterAndRouteFindings } from "./router.js";
import { runPlanner } from "./planner.js";
import { processScaFindings } from "./sca.js";
import { processSastFindings } from "./sast.js";
import { runVerifier } from "./verifier.js";
import { generatePipelineReport } from "./report.js";
import { runBuildDeterministic, extractErrorSignature, type RunConfig } from "./build-runner.js";

export type { RunConfig };

export function autoDetectRunConfig(workDir: string): RunConfig {
  if (existsSync(join(workDir, "pom.xml"))) {
    return { buildCommand: "mvn install -DskipTests -q", testCommand: "mvn test -q" };
  }
  if (existsSync(join(workDir, "package.json"))) {
    return { buildCommand: "npm install --prefer-offline", testCommand: "npm test --if-present" };
  }
  console.log(`[fix] autoDetectRunConfig: no pom.xml or package.json found in ${workDir}, skipping build/test`);
  return {};
}

export type CmFindingRow = {
  id: string;
  scan_id: string;
  workspace_id: string;
  source: string;
  severity: string;
  rule: string | null;
  package: string | null;
  current_version: string | null;
  fixed_version: string | null;
  upgrade_impact: string | null;
  file: string | null;
  line: number | null;
  fingerprint: string;
  fix_status: string;
  fix_attempts: number;
  fix_notes: string | null;
  description: string | null;
  taint_flow: unknown;
};

export function rowToFinding(row: CmFindingRow): CmFinding {
  return {
    id: row.id,
    scanId: row.scan_id,
    workspaceId: row.workspace_id,
    source: row.source as CmFinding["source"],
    severity: row.severity as CmFinding["severity"],
    rule: row.rule,
    package: row.package,
    currentVersion: row.current_version,
    fixedVersion: row.fixed_version,
    upgradeImpact: row.upgrade_impact as CmFinding["upgradeImpact"],
    file: row.file,
    line: row.line,
    fingerprint: row.fingerprint,
    fixStatus: row.fix_status as CmFinding["fixStatus"],
    fixAttempts: row.fix_attempts,
    fixNotes: row.fix_notes,
    description: row.description,
    taintFlow: (row.taint_flow as CmFinding["taintFlow"]) ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

export const FixState = Annotation.Root({
  scanId: Annotation<string>(),
  workspaceId: Annotation<string>(),
  repo: Annotation<{ owner: string; name: string }>(),
  repoUrl: Annotation<string>(),
  cloneBranch: Annotation<string>(),
  fixBranch: Annotation<string>(),
  scaPolicy: Annotation<"skip-minor" | "test-all">(),
  severityThreshold: Annotation<CmFinding["severity"][]>(),
  maxFixAttempts: Annotation<number>(),
  reportDir: Annotation<string>(),
  runConfig: Annotation<RunConfig>(),
  attempt: Annotation<number>(),
  findings: Annotation<CmFinding[]>(),
  planItems: Annotation<Awaited<ReturnType<typeof runPlanner>>["items"]>(),
  baselineBuildOutput: Annotation<string | undefined>(),
  baselineErrorSignature: Annotation<string[] | undefined>(),
  verifyOutcome: Annotation<"pass" | "fail_regression" | "fail_preexisting" | undefined>(),
  verifySummary: Annotation<string | undefined>(),
});

export type FixGraphState = typeof FixState.State;

export type FixGraphDeps = {
  supabase: SupabaseClient;
  scanProvider: ScanProvider;
  agentRunner: AgentRunner;
  ops: GitOps;
  checkpointer: BaseCheckpointSaver;
};

async function setStep(supabase: SupabaseClient, scanId: string, step: string): Promise<void> {
  await supabase.from("cm_scan").update({ current_step: step }).eq("id", scanId);
}

// ---------------------------------------------------------------------------
// runCategoryFixes — parallel SCA/SAST clones when both categories present,
// merged via diffPatch/applyPatch (built earlier this session).
// ---------------------------------------------------------------------------

type CategoryFixOptions = {
  supabase: SupabaseClient;
  agentRunner: AgentRunner;
  scanId: string;
  workspaceId: string;
  sca: CmFinding[];
  sast: CmFinding[];
  scaPolicy: "skip-minor" | "test-all";
  planItems: FixGraphState["planItems"];
  primaryDir: string;
  runConfig: RunConfig;
  ops: GitOps;
  repoUrl: string;
  cloneBranch: string;
  fixBranch: string;
};

async function runCategoryFixes(opts: CategoryFixOptions): Promise<void> {
  const { supabase, agentRunner, scanId, workspaceId, sca, sast, scaPolicy, planItems, primaryDir, runConfig, ops, repoUrl, cloneBranch, fixBranch } = opts;

  if (sca.length > 0 && sast.length === 0) {
    await processScaFindings({
      supabase, agentRunner, scanId, workspaceId,
      findings: sca, policy: scaPolicy, workingDir: primaryDir, runConfig, planItems,
    });
    return;
  }

  if (sast.length > 0 && sca.length === 0) {
    await processSastFindings({
      supabase, agentRunner, scanId, workspaceId,
      findings: sast, workingDir: primaryDir, runConfig, planItems,
    });
    return;
  }

  if (sca.length === 0 && sast.length === 0) {
    return;
  }

  const secondaryDir = await ops.cloneToTemp(repoUrl, cloneBranch);
  try {
    if (cloneBranch !== fixBranch) {
      await ops.createBranch(secondaryDir, fixBranch);
    }

    const [, sastResults] = await Promise.all([
      processScaFindings({
        supabase, agentRunner, scanId, workspaceId,
        findings: sca, policy: scaPolicy, workingDir: primaryDir, runConfig, planItems,
      }),
      processSastFindings({
        supabase, agentRunner, scanId, workspaceId,
        findings: sast, workingDir: secondaryDir, runConfig, planItems,
      }),
    ]);

    const patch = await ops.diffPatch(secondaryDir);
    const applied = await ops.applyPatch(primaryDir, patch);

    if (!applied) {
      // why: also surface which files the failed patch touched — applyPatch
      // logs git's own stderr, but knowing the file list here (without
      // reading the full patch body) is the fastest way to tell "same file
      // both agents touched" apart from "patch format issue on files SCA
      // never touched at all" without re-running anything.
      const patchedFiles = [...patch.matchAll(/^diff --git a\/(\S+) b\/\S+/gm)].map((m) => m[1]);
      console.warn(`[fix] scan ${scanId}: merge conflict applying SAST changes onto SCA clone (files in patch: ${patchedFiles.join(", ") || "none"}), deferring SAST fixes to next attempt`);
      for (const r of sastResults) {
        if (r.fixStatus === "fixed") {
          await supabase
            .from("cm_finding")
            .update({ fix_status: "failed", fix_notes: "merge conflict with SCA fixes this attempt, will retry next attempt" })
            .eq("id", r.finding.id);
        }
      }
    }
  } finally {
    await ops.cleanup(secondaryDir).catch(() => undefined);
  }
}

type RescanSyncResult = {
  clean: boolean;
  criticalHighCount: number;
  externalScanId: string;
};

/**
 * Runs the fix-branch validation rescan and syncs cm_finding to match its
 * result — the actual source of truth for "is this branch clean" is this
 * rescan, not whatever fix_status happens to be sitting in cm_finding from
 * a prior pass (a real production bug: findings mismarked "skipped"/"fixed"
 * left the DB believing a branch was clean when Checkmarx still reported real
 * CRITICAL/HIGH findings).
 *
 * Sync rules, by fingerprint:
 * - Every CRITICAL/HIGH finding the rescan reports is upserted as fix_status
 *   "open" (Checkmarx still sees it as live, full stop — it doesn't matter
 *   what an agent previously claimed about it) if it's not already "fixed"
 *   from an already-recorded verdict for THIS attempt; a brand-new fingerprint
 *   Checkmarx surfaced that wasn't in cm_finding before is inserted fresh.
 * - Any fingerprint previously CRITICAL/HIGH and still open/failed in
 *   cm_finding but ABSENT from this rescan's results is closed out as
 *   "fixed" — Checkmarx no longer reports it, so it's genuinely resolved.
 */
async function rescanFixBranch(
  supabase: SupabaseClient,
  scanProvider: ScanProvider,
  repo: { owner: string; name: string },
  fixBranch: string,
  scanId: string,
  workspaceId: string,
): Promise<RescanSyncResult> {
  // why: rescanRest still submits via the CLI (preserves --sca-resolver, required
  // for accurate Maven/Gradle transitive dependency coverage — confirmed via a
  // live scan that REST-only git-submit silently drops most such findings) but
  // reads results back via REST (/api/results) instead of a second `cx`
  // subprocess. Falls back to the CLI-based scan() only if a provider doesn't
  // implement rescanRest (e.g. test doubles).
  const scanResult = scanProvider.rescanRest
    ? await scanProvider.rescanRest({ owner: repo.owner, name: repo.name }, fixBranch)
    : await scanProvider.scan({ owner: repo.owner, name: repo.name }, fixBranch);
  const findings = scanResult.findings ?? [];
  const criticalHigh = findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");

  for (const finding of criticalHigh) {
    await supabase.from("cm_finding").upsert(
      {
        scan_id: scanId,
        workspace_id: workspaceId,
        source: finding.source,
        severity: finding.severity,
        rule: finding.rule,
        package: finding.package,
        current_version: finding.currentVersion,
        fixed_version: finding.fixedVersion,
        upgrade_impact: finding.upgradeImpact,
        file: finding.file,
        line: finding.line,
        fingerprint: finding.fingerprint,
        fix_status: "open",
        description: finding.description,
        taint_flow: finding.taintFlow,
      },
      { onConflict: "scan_id, fingerprint", ignoreDuplicates: false },
    );
  }

  const stillPresent = new Set(criticalHigh.map((f) => f.fingerprint));
  const staleResp = await supabase
    .from("cm_finding")
    .select("id, fingerprint")
    .eq("scan_id", scanId)
    .in("severity", ["CRITICAL", "HIGH"])
    .in("fix_status", ["open", "failed"]) as unknown as { data: Array<{ id: string; fingerprint: string }> | null };

  const staleIds = (staleResp.data ?? [])
    .filter((row) => !stillPresent.has(row.fingerprint))
    .map((row) => row.id);

  if (staleIds.length > 0) {
    await supabase
      .from("cm_finding")
      .update({ fix_status: "fixed", fix_notes: "Confirmed resolved by rescan — no longer reported by Checkmarx" })
      .in("id", staleIds);
  }

  return { clean: criticalHigh.length === 0, criticalHighCount: criticalHigh.length, externalScanId: scanResult.externalScanId };
}

async function reloadOpenFindings(supabase: SupabaseClient, scanId: string): Promise<CmFinding[]> {
  const resp = await supabase
    .from("cm_finding")
    .select("*")
    .eq("scan_id", scanId)
    .in("fix_status", ["open", "failed"]) as unknown as { data: CmFindingRow[] | null; error: { message: string } | null };
  return (resp.data ?? []).map(rowToFinding);
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export function buildFixGraph(deps: FixGraphDeps): CompiledStateGraph<FixGraphState, Partial<FixGraphState>, string> {
  const { supabase, scanProvider, agentRunner, ops, checkpointer } = deps;

  const transientRetry = { maxAttempts: 3, initialInterval: 2000, backoffFactor: 2, jitter: true };

  const graph = new StateGraph(FixState)
    .addNode("baselineCheck", async (state: FixGraphState) => {
      await setStep(supabase, state.scanId, "Running baseline build check...");
      const dir = await ops.cloneToTemp(state.repoUrl, state.cloneBranch);
      try {
        const runConfig = autoDetectRunConfig(dir);
        const { output } = await runBuildDeterministic(dir, runConfig);
        const baselineErrorSignature = extractErrorSignature(output);
        console.log(`[fix-graph] scan ${state.scanId}: baseline check captured ${output.length} chars, ${baselineErrorSignature.length} error signature line(s)`);
        return { runConfig, baselineBuildOutput: output || undefined, baselineErrorSignature };
      } finally {
        await ops.cleanup(dir).catch(() => undefined);
      }
    }, { retryPolicy: transientRetry })

    .addNode("plan", async (state: FixGraphState) => {
      const { sca, sast } = filterAndRouteFindings(state.findings, state.severityThreshold);
      const actionable = [...sca, ...sast];
      if (actionable.length === 0) {
        return { planItems: [] };
      }

      await setStep(supabase, state.scanId, `Fix attempt ${state.attempt}/${state.maxFixAttempts}: planning...`);

      // planner needs a clone to inspect the codebase while researching fixes
      const dir = await ops.cloneToTemp(state.repoUrl, state.cloneBranch);
      try {
        const plan = await runPlanner(supabase, agentRunner, state.scanId, state.workspaceId, actionable, dir);
        const toFix = plan.items.filter((i) => i.strategy !== "skip" && i.strategy !== "needs-human");
        const needsHuman = plan.items.filter((i) => i.strategy === "needs-human");
        console.log(`[fix-graph] scan ${state.scanId}: ${toFix.length} to fix, ${needsHuman.length} needs-human`);
        return { planItems: plan.items };
      } finally {
        await ops.cleanup(dir).catch(() => undefined);
      }
    }, { retryPolicy: transientRetry })

    .addNode("fix", async (state: FixGraphState) => {
      const { sca, sast } = filterAndRouteFindings(state.findings, state.severityThreshold);

      const stepLabel = sca.length > 0 && sast.length > 0
        ? `fixing ${sca.length} SCA + ${sast.length} SAST findings in parallel...`
        : `fixing ${sca.length + sast.length} findings...`;
      await setStep(supabase, state.scanId, `Fix attempt ${state.attempt}/${state.maxFixAttempts}: ${stepLabel}`);

      const primaryDir = await ops.cloneToTemp(state.repoUrl, state.cloneBranch);
      try {
        // why: when cloneBranch already IS fixBranch (an existing checkmarx-auto
        // branch being reused across attempts), the clone already checked it
        // out — `git checkout -b` on the branch you're already on fails.
        if (state.cloneBranch !== state.fixBranch) {
          await ops.createBranch(primaryDir, state.fixBranch);
        }

        await runCategoryFixes({
          supabase, agentRunner, scanId: state.scanId, workspaceId: state.workspaceId,
          sca, sast, scaPolicy: state.scaPolicy, planItems: state.planItems,
          primaryDir, runConfig: state.runConfig,
          ops, repoUrl: state.repoUrl, cloneBranch: state.cloneBranch, fixBranch: state.fixBranch,
        });

        // Commit+push immediately, before verification — this is the "commit
        // early" durability fix: once this lands, the edits are safe on the
        // remote fix branch regardless of what verify decides.
        await ops.commitAll(primaryDir, `CM || apply Checkmarx fix(es) (attempt ${state.attempt})`);
        // why: force — this branch is exclusively bot-owned and re-cloned
        // fresh from cloneBranch every attempt, so any pre-existing remote
        // commit on it (a prior run's fix, or a retried earlier attempt)
        // would otherwise permanently reject every future push here as
        // non-fast-forward (confirmed in production: a real scan looped on
        // this for several minutes before eventually escaping via job retries).
        await ops.push(primaryDir, state.fixBranch, { force: true });
      } finally {
        await ops.cleanup(primaryDir).catch(() => undefined);
      }

      return {};
    }, { retryPolicy: transientRetry })

    .addNode("verify", async (state: FixGraphState) => {
      await setStep(supabase, state.scanId, `Fix attempt ${state.attempt}/${state.maxFixAttempts}: verifying...`);

      // Fresh clone of the *pushed* fix branch — nothing depends on the fix
      // node's temp dir having survived. Build is run deterministically here
      // (not by the agent) so classification never depends on a model
      // correctly reading its own raw build log.
      const dir = await ops.cloneToTemp(state.repoUrl, state.fixBranch);
      try {
        const { exitCode, output } = await runBuildDeterministic(dir, state.runConfig);
        const { outcome, summary } = await runVerifier({
          supabase, agentRunner, scanId: state.scanId, workspaceId: state.workspaceId,
          buildExitCode: exitCode, buildOutput: output,
          ...(state.baselineErrorSignature === undefined ? {} : { baselineErrorSignature: state.baselineErrorSignature }),
        });
        return { verifyOutcome: outcome, verifySummary: summary };
      } finally {
        await ops.cleanup(dir).catch(() => undefined);
      }
    }, { retryPolicy: transientRetry })

    .addNode("humanReview", async (state: FixGraphState) => {
      await supabase
        .from("cm_scan")
        .update({ status: "needs_human", current_step: `Verification failed (regression): ${(state.verifySummary ?? "").slice(0, 300)}` })
        .eq("id", state.scanId);

      console.log(`[fix-graph] scan ${state.scanId}: paused for human review (fail_regression)`);
      interrupt({ scanId: state.scanId, reason: "fail_regression", summary: state.verifySummary });
      // Execution only reaches here after a human resumes with Command({ resume }).
      console.log(`[fix-graph] scan ${state.scanId}: resumed by human, retrying verify`);
      return {};
    })

    .addNode("rescan", async (state: FixGraphState) => {
      if (state.verifyOutcome === "fail_preexisting") {
        await setStep(supabase, state.scanId, `Known pre-existing issue (unrelated to fix): ${(state.verifySummary ?? "").slice(0, 300)}`);
      }

      await setStep(supabase, state.scanId, `Fix attempt ${state.attempt}/${state.maxFixAttempts}: rescanning...`);
      // why: rescanFixBranch syncs cm_finding to the rescan's actual result
      // (upserts every CRITICAL/HIGH it still finds as "open", closes out
      // fingerprints no longer reported as "fixed") — cm_finding's open/failed
      // set is therefore a reliable reflection of what Checkmarx just reported,
      // not stale state from a prior (possibly buggy) pass.
      const { clean, criticalHighCount, externalScanId } = await rescanFixBranch(
        supabase, scanProvider, state.repo, state.fixBranch, state.scanId, state.workspaceId,
      );

      // why: findings_actionable is set once at scan.ts (the original
      // CRITICAL/HIGH count from the first scan) and both the report and
      // dashboard read it as "how many actionable findings this scan had" —
      // overwriting it here with the rescan's remaining count corrupted that
      // meaning (a clean rescan would zero it out, making a fully-remediated
      // scan's report say "Actionable: 0" instead of the real original count).
      // Only external_scan_id (which rescan this was) belongs here.
      await supabase
        .from("cm_scan")
        .update({ external_scan_id: externalScanId })
        .eq("id", state.scanId);

      if (clean) {
        return { findings: [] };
      }

      console.log(`[fix-graph] scan ${state.scanId}: ${criticalHighCount} CRITICAL/HIGH remain after attempt ${state.attempt} (rescan ${externalScanId})`);
      const remaining = await reloadOpenFindings(supabase, state.scanId);

      // why: defense-in-depth only — rescanFixBranch's sync above should make
      // this impossible, but if cm_finding and the rescan ever disagree again,
      // never silently fall through to "report" (which would mark the scan
      // "verified" with real unresolved vulnerabilities still present).
      if (remaining.length === 0) {
        throw new Error(`scan ${state.scanId}: rescan reports ${criticalHighCount} CRITICAL/HIGH remaining but cm_finding sync produced zero open/failed rows — refusing to report verified`);
      }

      return { findings: remaining, attempt: state.attempt + 1 };
    }, { retryPolicy: transientRetry })

    .addNode("report", async (state: FixGraphState) => {
      await supabase
        .from("cm_scan")
        .update({ status: "reporting", current_step: "All findings resolved, generating report..." })
        .eq("id", state.scanId);

      console.log(`[fix-graph] scan ${state.scanId}: generating report...`);
      try {
        // why: a report is a required deliverable, not optional — a scan that
        // never got its PDF must never read as "verified". Pass the intended
        // final status explicitly (see report.ts) rather than letting
        // generatePipelineReport re-read cm_scan.status mid-transition, which
        // would show "reporting" in the PDF's own Final Status line.
        await generatePipelineReport(supabase, state.scanId, state.reportDir, "verified");
        await supabase
          .from("cm_scan")
          .update({ status: "verified", current_step: "All findings resolved, verified by rescan" })
          .eq("id", state.scanId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[fix-graph] scan ${state.scanId}: report generation failed: ${msg}`);
        await supabase
          .from("cm_scan")
          .update({ status: "failed", current_step: `Report generation failed: ${msg.slice(0, 300)}` })
          .eq("id", state.scanId);
      }
      return {};
    })

    .addNode("attemptsExhausted", async (state: FixGraphState) => {
      await supabase
        .from("cm_scan")
        .update({ status: "needs_human", current_step: `Fix attempts exhausted (${state.maxFixAttempts}), needs human review` })
        .eq("id", state.scanId);
      console.log(`[fix-graph] scan ${state.scanId}: fix attempts exhausted, needs human`);
      return {};
    })

    .addEdge(START, "baselineCheck")
    .addEdge("baselineCheck", "plan")
    .addConditionalEdges("plan", (state: FixGraphState) => {
      const { sca, sast } = filterAndRouteFindings(state.findings, state.severityThreshold);
      return sca.length + sast.length === 0 ? "report" : "fix";
    }, { report: "report", fix: "fix" })
    .addEdge("fix", "verify")
    .addConditionalEdges("verify", (state: FixGraphState) => {
      if (state.verifyOutcome === "fail_regression") return "humanReview";
      return "rescan";
    }, { humanReview: "humanReview", rescan: "rescan" })
    .addEdge("humanReview", "verify")
    .addConditionalEdges("rescan", (state: FixGraphState) => {
      if (state.findings.length === 0) return "report";
      if (state.attempt <= state.maxFixAttempts) return "plan";
      return "attemptsExhausted";
    }, { report: "report", plan: "plan", attemptsExhausted: "attemptsExhausted" })
    .addEdge("report", END)
    .addEdge("attemptsExhausted", END);

  return graph.compile({ checkpointer });
}
