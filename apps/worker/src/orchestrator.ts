import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createOctokit, createPR } from "@conductor/github";
import type { Spec, Plan, SubFeature } from "@conductor/core";
import {
  runProductOwner,
  runCodebaseAnalyst,
  runTechLead,
  runBackend,
  runFrontend,
  runSecurityReviewer,
  runCodeReviewer,
  runTester,
} from "./agents/index.js";
import { getUsageState } from "./usage.js";
import { resolveRoute, type AgentMode } from "./router.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Route logging
// ---------------------------------------------------------------------------

async function logRoute(agentName: string, mode: AgentMode): Promise<void> {
  try {
    const state = await getUsageState();
    const route = resolveRoute(agentName, mode, {
      goMonthlyUsedUSD: state.thisMonth.cost_usd,
      goWeeklyUsedUSD: state.last7d.cost_usd,
      go5hUsedUSD: state.last5h.cost_usd,
      softLimitHit: state.goStatus === "soft" || state.goStatus === "hard",
      hardLimitHit: state.goStatus === "hard",
    });
    const downgraded = route.reason.includes("limit");
    const suffix = downgraded ? " ⚠ " + route.reason : "";
    console.log(`[router] ${agentName}/${mode} → ${route.lane}/${route.model}${suffix}`);
  } catch (err) {
    // non-fatal — never block pipeline for routing log failure
    console.warn(`[router] logRoute failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestratorJob = {
  id: string;
  title: string;
  description: string;
  type: string;
  lane_preference: string;
  project_id: string;
};

export type OrchestratorProject = {
  owner: string;
  repo: string;
  default_branch: string;
};

// why: supabase any client passed through — typed at call site
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function updateJob(
  supabase: SupabaseAny,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`updateJob failed: ${(error as { message: string }).message}`);
}

async function needsHuman(
  supabase: SupabaseAny,
  jobId: string,
  reason: string,
): Promise<void> {
  console.warn(`[orchestrator] needs_human: ${reason}`);
  await updateJob(supabase, jobId, { status: "needs_human", error: reason }).catch(() => {});
}

async function createApproval(
  supabase: SupabaseAny,
  jobId: string,
  kind: string,
  payload: unknown,
): Promise<void> {
  const { error } = await supabase.from("approvals").insert({
    job_id: jobId,
    kind,
    payload,
    status: "pending",
  });
  if (error) {
    console.error(`[orchestrator] createApproval failed: ${(error as { message: string }).message}`);
  }
  await updateJob(supabase, jobId, {
    status: "needs_human",
    error: `Onay bekleniyor: ${kind}`,
  });
}

async function createSubJobs(
  supabase: SupabaseAny,
  subFeatures: SubFeature[],
  parentJob: OrchestratorJob,
  project: OrchestratorProject,
): Promise<void> {
  const rows = subFeatures.map((sf) => ({
    project_id: parentJob.project_id,
    type: "feature",
    title: sf.title,
    description: sf.description,
    lane_preference: parentJob.lane_preference,
    parent_job_id: parentJob.id,
    status: "queued",
  }));

  const { error } = await supabase.from("jobs").insert(rows);
  if (error) {
    throw new Error(`createSubJobs failed: ${(error as { message: string }).message}`);
  }

  console.log(
    `[orchestrator] decomposed job ${parentJob.id} into ${subFeatures.length} sub-jobs: ${subFeatures.map((sf) => sf.title).join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function gitCommit(repoDir: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", message], { cwd: repoDir });
}

async function gitPush(repoDir: string, branch: string): Promise<void> {
  await execFileAsync("git", ["push", "--set-upstream", "origin", branch], { cwd: repoDir });
}

// ---------------------------------------------------------------------------
// PR body builder
// ---------------------------------------------------------------------------

function buildPRBody(job: OrchestratorJob, spec: Spec, plan: Plan): string {
  const criteriaChecklist = spec.acceptance_criteria
    .map((c) => `- [ ] ${c}`)
    .join("\n");

  const modules = plan.affected_modules.map((m) => `- \`${m}\``).join("\n");

  return `## ${spec.summary}

### Kabul Kriterleri
${criteriaChecklist}

### Etkilenen Modüller
${modules}

### Teknik Yaklaşım
${plan.approach}

---

⚠️ **İnsan incelemesi bekliyor — merge etmeden önce kodu incele**

🤖 Conductor tarafından otomatik oluşturuldu | Job: \`${job.id}\``;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(
  supabase: SupabaseAny,
  job: OrchestratorJob,
  project: OrchestratorProject,
  repoDir: string,
): Promise<void> {
  const token = process.env["CONDUCTOR_GITHUB_TOKEN"] ?? "";
  const baseOpts = { repoDir, jobId: job.id, supabase };

  // ── 1. Product Owner ────────────────────────────────────────────────────
  let spec: Spec;
  try {
    await logRoute("product-owner", "implement");
    spec = await runProductOwner({ ...baseOpts, title: job.title, description: job.description });
  } catch (err) {
    await needsHuman(supabase, job.id, `PO agent hatası: ${String(err)}`);
    return;
  }

  if (spec.open_questions.length > 0) {
    await needsHuman(
      supabase,
      job.id,
      `PO soruları yanıt bekliyor: ${spec.open_questions.join(" | ")}`,
    );
    return;
  }

  await updateJob(supabase, job.id, { spec });

  // ── 2. Codebase Analyst ─────────────────────────────────────────────────
  let contextPath: string;
  try {
    await logRoute("codebase-analyst", "analyze");
    contextPath = await runCodebaseAnalyst({ ...baseOpts, spec, title: job.title });
  } catch (err) {
    await needsHuman(supabase, job.id, `Codebase Analyst hatası: ${String(err)}`);
    return;
  }

  // context.md agents tarafından contextPath üzerinden okunur; burada sadece varlığını doğruluyoruz
  try {
    await readFile(contextPath, "utf8");
  } catch {
    console.warn("[orchestrator] context.md okunamadı, devam ediliyor");
  }

  // ── 3. Tech Lead ────────────────────────────────────────────────────────
  let plan: Plan;
  try {
    await logRoute("tech-lead", "implement");
    plan = await runTechLead({ ...baseOpts, spec, title: job.title, contextPath });
  } catch (err) {
    await needsHuman(supabase, job.id, `Tech Lead hatası: ${String(err)}`);
    return;
  }

  await updateJob(supabase, job.id, { plan });

  // ── 4. Complexity → sub-jobs ─────────────────────────────────────────────
  if (plan.complexity === "complex" && plan.sub_features && plan.sub_features.length > 0) {
    try {
      await createSubJobs(supabase, plan.sub_features, job, project);
    } catch (err) {
      await needsHuman(supabase, job.id, `Sub-job oluşturma hatası: ${String(err)}`);
      return;
    }
    await updateJob(supabase, job.id, { status: "decomposed" });
    return;
  }

  // ── 5. Migration onayı ───────────────────────────────────────────────────
  if (plan.needs_migration) {
    await createApproval(supabase, job.id, "db_migration", {
      migration_sql: plan.migration,
      branch: plan.branch,
    });
    return;
  }

  // ── 6. BE + FE implementasyon ────────────────────────────────────────────
  try {
    await logRoute("backend-dev", "implement");
    await runBackend({ ...baseOpts, spec, plan, contextPath });
    await logRoute("frontend-dev", "implement");
    await runFrontend({ ...baseOpts, spec, plan, contextPath });
  } catch (err) {
    await needsHuman(supabase, job.id, `BE/FE implementasyon hatası: ${String(err)}`);
    return;
  }

  // ── 7. Security döngüsü (max 2 tur + 1 redesign) ─────────────────────────
  let securityPassed = false;
  let redesignDone = false;
  let secTur = 1;

  while (secTur <= 2) {
    let sec;
    try {
      await logRoute("security-reviewer", "implement");
      sec = await runSecurityReviewer({ ...baseOpts, iteration: secTur });
    } catch (err) {
      await needsHuman(supabase, job.id, `Security Reviewer hatası: ${String(err)}`);
      return;
    }

    if (sec.passed) {
      securityPassed = true;
      break;
    }

    if (sec.escalate_to_tech_lead && !redesignDone) {
      // Tech Lead redesign + yeniden implement
      try {
        await logRoute("tech-lead", "redesign");
        plan = await runTechLead({
          ...baseOpts,
          spec,
          title: job.title,
          contextPath,
          securityIssues: sec.issues,
        });
        await updateJob(supabase, job.id, { plan });
        await logRoute("backend-dev", "security-fix");
        await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: sec.issues });
        await logRoute("frontend-dev", "security-fix");
        await runFrontend({ ...baseOpts, spec, plan, contextPath, fixIssues: sec.issues });
      } catch (err) {
        await needsHuman(supabase, job.id, `Security redesign hatası: ${String(err)}`);
        return;
      }
      redesignDone = true;
      secTur = 1; // sıfırla — 2 tur daha
      continue;
    }

    if (secTur === 2) {
      await needsHuman(
        supabase,
        job.id,
        `Security ${redesignDone ? "redesign sonrası " : ""}2 turda geçilemedi`,
      );
      return;
    }

    // Tur 1 fail, eskalasyon yok → BE/FE fix
    const beIssues = sec.issues.filter(
      (x) => x.category !== "other" || !x.file.toLowerCase().includes("component"),
    );
    const feIssues = sec.issues.filter(
      (x) => x.file.toLowerCase().includes("component") || x.file.toLowerCase().includes("src/app"),
    );

    try {
      if (beIssues.length > 0) {
        await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: beIssues });
      }
      if (feIssues.length > 0) {
        await runFrontend({ ...baseOpts, spec, plan, contextPath, fixIssues: feIssues });
      }
      if (beIssues.length === 0 && feIssues.length === 0) {
        await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: sec.issues });
      }
    } catch (err) {
      await needsHuman(supabase, job.id, `Security fix hatası: ${String(err)}`);
      return;
    }

    secTur++;
  }

  if (!securityPassed) {
    await needsHuman(supabase, job.id, "Security döngüsü aşılamadı");
    return;
  }

  // ── 8. Code Review döngüsü (max 3 tur) ───────────────────────────────────
  await updateJob(supabase, job.id, { status: "review_loop" });

  for (let i = 1; i <= 3; i++) {
    let rev;
    try {
      await logRoute("code-reviewer", "review");
      rev = await runCodeReviewer({ ...baseOpts, iteration: i });
    } catch (err) {
      await needsHuman(supabase, job.id, `Code Reviewer hatası: ${String(err)}`);
      return;
    }

    if (rev.approved) break;

    if (rev.escalate || i === 3) {
      await needsHuman(
        supabase,
        job.id,
        `Code review ${i === 3 ? "3 turda" : ""} geçilemedi${rev.escalate ? " (eskalasyon)" : ""}`,
      );
      return;
    }

    const beIssues = rev.issues.filter((x) => x.owner === "backend");
    const feIssues = rev.issues.filter((x) => x.owner === "frontend");

    try {
      if (beIssues.length > 0) {
        await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: beIssues });
      }
      if (feIssues.length > 0) {
        await runFrontend({ ...baseOpts, spec, plan, contextPath, fixIssues: feIssues });
      }
    } catch (err) {
      await needsHuman(supabase, job.id, `Review fix hatası: ${String(err)}`);
      return;
    }
  }

  // ── 9. Test döngüsü (max 3 tur) ──────────────────────────────────────────
  await updateJob(supabase, job.id, { status: "test_loop" });

  const defaultCommitMsg = `feat: ${job.title} (job: ${job.id.slice(0, 8)})`;
  let lastFailures: string[] = [];

  for (let i = 1; i <= 3; i++) {
    let t;
    try {
      await logRoute("qa-engineer", "analyze");
      t = await runTester({
        ...baseOpts,
        commitMessage: defaultCommitMsg,
        ...(lastFailures.length > 0 ? { failures: lastFailures } : {}),
        iteration: i,
      });
    } catch (err) {
      await needsHuman(supabase, job.id, `Tester hatası: ${String(err)}`);
      return;
    }

    if (t.passed) {
      const commitMsg = t.commit_message || defaultCommitMsg;

      try {
        await gitCommit(repoDir, commitMsg);
        await gitPush(repoDir, plan.branch);

        const octokit = createOctokit(token);
        const prUrl = await createPR(
          octokit,
          project.owner,
          project.repo,
          job.title,
          buildPRBody(job, spec, plan),
          plan.branch,
          project.default_branch,
        );

        await updateJob(supabase, job.id, { status: "pr_opened", pr_url: prUrl });
        console.log(`[orchestrator] PR opened: ${prUrl}`);
      } catch (err) {
        await needsHuman(supabase, job.id, `Commit/push/PR hatası: ${String(err)}`);
      }
      return;
    }

    if (t.needs_human || i === 3) {
      await needsHuman(
        supabase,
        job.id,
        `Test ${i === 3 ? "3 turda" : ""} geçilemedi. Hatalar: ${t.failures.join(" | ")}`,
      );
      return;
    }

    lastFailures = t.failures;

    // Test fix: hataları BE'ye gönder
    const fixIssues = t.failures.map((f) => ({
      file: "unknown",
      line: null,
      severity: "high" as const,
      problem: f,
      fix: "testi geçirecek şekilde düzelt",
      owner: "backend" as const,
    }));

    try {
      await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues });
    } catch (err) {
      await needsHuman(supabase, job.id, `Test fix hatası: ${String(err)}`);
      return;
    }
  }
}
