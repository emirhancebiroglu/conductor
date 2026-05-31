import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
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
import { getAgentConfig, loadAgentConfig, type AgentConfig } from "./agentConfig.js";

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
// Agent config + step tracking helpers
// ---------------------------------------------------------------------------

async function getAgentOrSkip(
  supabase: SupabaseAny,
  agentName: string,
): Promise<AgentConfig | null> {
  let config = getAgentConfig(agentName);
  if (!config && supabase) {
    await loadAgentConfig(supabase);
    config = getAgentConfig(agentName);
  }
  return config ?? null;
}

async function hasAnyEnabledAgent(supabase: SupabaseAny): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { data } = (await supabase
      .from("agent_config")
      .select("enabled")
      .eq("enabled", true)
      .limit(1)) as unknown as { data: { enabled: boolean }[] | null };
    return (data?.length ?? 0) > 0;
  } catch {
    return true;
  }
}

async function updateStepStatus(
  supabase: SupabaseAny,
  jobId: string,
  agentName: string,
  stepMessage: string,
): Promise<void> {
  await updateJob(supabase, jobId, {
    current_agent: agentName,
    current_step_message: stepMessage,
  });
}

async function clearStepStatus(supabase: SupabaseAny, jobId: string): Promise<void> {
  await updateJob(supabase, jobId, {
    current_agent: null,
    current_step_message: null,
  });
}

type FallbackResult<T> = { skipped: true; value: T } | { skipped: false; config: AgentConfig };

async function checkAgentEnabled<T>(
  supabase: SupabaseAny,
  jobId: string,
  agentName: string,
  stepMessage: string,
  fallback: () => T,
): Promise<FallbackResult<T>> {
  const config = await getAgentOrSkip(supabase, agentName);
  await updateStepStatus(supabase, jobId, agentName, stepMessage);

  if (!config || !config.enabled) {
    console.warn(`[orchestrator] ⚠ Agent "${agentName}" is disabled — using fallback behavior`);
    const value = fallback();
    return { skipped: true, value };
  }

  return { skipped: false, config };
}

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
  await updateJob(supabase, jobId, { status: "needs_human", error: reason }).catch(() => { });
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
  answers?: Record<string, string>,
): Promise<void> {
  const token = process.env["CONDUCTOR_GITHUB_TOKEN"] ?? "";
  const baseOpts = { repoDir, jobId: job.id, supabase };

  let pipelineOk = false;

  try {
    const anyEnabled = await hasAnyEnabledAgent(supabase);
    if (!anyEnabled) {
      const msg = "No agents are enabled. At least one agent must be enabled to run the pipeline. Enable an agent in the dashboard and retry.";
      console.error(`[orchestrator] ${msg}`);
      await updateJob(supabase, job.id, {
        status: "failed",
        error: msg,
      });
      return;
    }
    // ── 1. Product Owner ────────────────────────────────────────────────────
    let spec: Spec;
    const poCheck = await checkAgentEnabled(supabase, job.id, "product-owner", "Analyzing requirements and generating spec", () => {
      const summary = job.description.length > 500 ? job.description.slice(0, 500) + "..." : job.description;
      const minimalSpec: Spec = {
        summary: `${job.title}: ${summary}`,
        user_stories: [`As a user, I want ${job.title.toLowerCase()} so that I can benefit from it`],
        acceptance_criteria: ["Feature works as described in the job description"],
        out_of_scope: [],
        open_questions: [],
        research_notes: [],
      };
      return minimalSpec;
    });

    if (poCheck.skipped) {
      spec = poCheck.value;
    } else {
      try {
        await logRoute("product-owner", "implement");
        spec = await runProductOwner({
          ...baseOpts,
          title: job.title,
          description: job.description,
          agentConfig: poCheck.config,
          ...(answers ? { answers } : {}),
        });
      } catch (err) {
        await needsHuman(supabase, job.id, `PO agent hatası: ${String(err)}`);
        return;
      }
    }

    if (spec.open_questions.length > 0) {
      await updateJob(supabase, job.id, { status: "waiting_input", spec });
      return;
    }

    await updateJob(supabase, job.id, { spec });

    // ── 2. Codebase Analyst ─────────────────────────────────────────────────
    let contextPath: string;
    const caCheck = await checkAgentEnabled(supabase, job.id, "codebase-analyst", "Analyzing codebase and generating context", () => {
      const fallbackPath = path.join(repoDir, "context.md");
      const note = `# Codebase Context — ${job.title}\n\n> ⚠️ Codebase analyst agent is disabled. This is a placeholder.\n\n## Mimari & Pattern'ler\n- Agent disabled, manual review recommended\n\n## Bu Feature ile İlgili Dosyalar\n- To be determined during implementation\n`;
      // why: synchronous write is fine here — pipeline is already sequential
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      writeFile(fallbackPath, note, "utf8").catch(() => { });
      return fallbackPath;
    });

    if (caCheck.skipped) {
      contextPath = caCheck.value;
    } else {
      try {
        await logRoute("codebase-analyst", "analyze");
        contextPath = await runCodebaseAnalyst({ ...baseOpts, spec, title: job.title, agentConfig: caCheck.config });
      } catch (err) {
        await needsHuman(supabase, job.id, `Codebase Analyst hatası: ${String(err)}`);
        return;
      }
    }

    try {
      await readFile(contextPath, "utf8");
    } catch {
      console.warn("[orchestrator] context.md okunamadı, devam ediliyor");
    }

    // ── 3. Tech Lead ────────────────────────────────────────────────────────
    let plan: Plan;
    const tlCheck = await checkAgentEnabled(supabase, job.id, "tech-lead", "Creating technical implementation plan", () => {
      const slug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const minimalPlan: Plan = {
        approach: `Implement ${job.title} based on spec. Follow existing codebase conventions.`,
        complexity: "simple",
        sub_features: null,
        affected_modules: ["src/"],
        api_contract: { shared_types: [], endpoints: [] },
        tasks: [{ id: "GEN-1", area: "backend", desc: `Implement ${job.title}`, acceptance: "Feature works as specified" }],
        branch: `feature/${slug}`,
        needs_migration: false,
        migration: null,
        risks: ["Agent disabled — plan is minimal"],
      };
      return minimalPlan;
    });

    if (tlCheck.skipped) {
      plan = tlCheck.value;
    } else {
      try {
        await logRoute("tech-lead", "implement");
        plan = await runTechLead({ ...baseOpts, spec, title: job.title, contextPath, agentConfig: tlCheck.config });
      } catch (err) {
        await needsHuman(supabase, job.id, `Tech Lead hatası: ${String(err)}`);
        return;
      }
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
    const beCheck = await checkAgentEnabled(supabase, job.id, "backend-dev", "Implementing backend changes", () => null);
    const feCheck = await checkAgentEnabled(supabase, job.id, "frontend-dev", "Implementing frontend changes", () => null);

    if (!beCheck.skipped || !feCheck.skipped) {
      try {
        if (!beCheck.skipped) {
          await logRoute("backend-dev", "implement");
          await runBackend({ ...baseOpts, spec, plan, contextPath, agentConfig: beCheck.config });
        } else {
          console.warn("[orchestrator] ⚠ Backend dev agent is disabled — skipping backend implementation");
        }
        if (!feCheck.skipped) {
          await logRoute("frontend-dev", "implement");
          await runFrontend({ ...baseOpts, spec, plan, contextPath, agentConfig: feCheck.config });
        } else {
          console.warn("[orchestrator] ⚠ Frontend dev agent is disabled — skipping frontend implementation");
        }
      } catch (err) {
        await needsHuman(supabase, job.id, `BE/FE implementasyon hatası: ${String(err)}`);
        return;
      }
    } else {
      console.warn("[orchestrator] ⚠ Both BE and FE dev agents are disabled — skipping implementation entirely");
    }

    // ── 7. Security döngüsü (max 2 tur + 1 redesign) ─────────────────────────
    let securityPassed = false;
    let redesignDone = false;
    let secTur = 1;

    const secCheck = await checkAgentEnabled(supabase, job.id, "security-reviewer", "Running security review", () => null);

    if (secCheck.skipped) {
      console.warn("[orchestrator] ⚠ Security reviewer agent is disabled — skipping security check");
      securityPassed = true;
    } else {
      while (secTur <= 2) {
        let sec;
        try {
          await logRoute("security-reviewer", "implement");
          sec = await runSecurityReviewer({ ...baseOpts, iteration: secTur, agentConfig: secCheck.config });
        } catch (err) {
          await needsHuman(supabase, job.id, `Security Reviewer hatası: ${String(err)}`);
          return;
        }

        if (sec.passed) {
          securityPassed = true;
          break;
        }

        if (sec.escalate_to_tech_lead && !redesignDone) {
          const tlRedesignCheck = await checkAgentEnabled(supabase, job.id, "tech-lead", "Redesigning plan for security issues", () => plan);
          if (tlRedesignCheck.skipped) {
            console.warn("[orchestrator] ⚠ Tech lead disabled — cannot redesign for security, proceeding with current plan");
            securityPassed = false;
            break;
          }
          try {
            await logRoute("tech-lead", "redesign");
            plan = await runTechLead({
              ...baseOpts,
              spec,
              title: job.title,
              contextPath,
              securityIssues: sec.issues,
              agentConfig: tlRedesignCheck.config,
            });
            await updateJob(supabase, job.id, { plan });

            const beFixCheck = await checkAgentEnabled(supabase, job.id, "backend-dev", "Fixing security issues (backend)", () => null);
            const feFixCheck = await checkAgentEnabled(supabase, job.id, "frontend-dev", "Fixing security issues (frontend)", () => null);

            if (!beFixCheck.skipped) {
              await logRoute("backend-dev", "security-fix");
              await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: sec.issues, agentConfig: beFixCheck.config });
            }
            if (!feFixCheck.skipped) {
              await logRoute("frontend-dev", "security-fix");
              await runFrontend({ ...baseOpts, spec, plan, contextPath, fixIssues: sec.issues, agentConfig: feFixCheck.config });
            }
          } catch (err) {
            await needsHuman(supabase, job.id, `Security redesign hatası: ${String(err)}`);
            return;
          }
          redesignDone = true;
          secTur = 1;
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

        const beIssues = sec.issues.filter(
          (x) => x.category !== "other" || !x.file.toLowerCase().includes("component"),
        );
        const feIssues = sec.issues.filter(
          (x) => x.file.toLowerCase().includes("component") || x.file.toLowerCase().includes("src/app"),
        );

        try {
          if (beIssues.length > 0) {
            const beFixCheck = await checkAgentEnabled(supabase, job.id, "backend-dev", "Fixing security issues (backend)", () => null);
            if (!beFixCheck.skipped) {
              await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: beIssues, agentConfig: beFixCheck.config });
            }
          }
          if (feIssues.length > 0) {
            const feFixCheck = await checkAgentEnabled(supabase, job.id, "frontend-dev", "Fixing security issues (frontend)", () => null);
            if (!feFixCheck.skipped) {
              await runFrontend({ ...baseOpts, spec, plan, contextPath, fixIssues: feIssues, agentConfig: feFixCheck.config });
            }
          }
          if (beIssues.length === 0 && feIssues.length === 0) {
            const beFixCheck = await checkAgentEnabled(supabase, job.id, "backend-dev", "Fixing security issues (backend)", () => null);
            if (!beFixCheck.skipped) {
              await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: sec.issues, agentConfig: beFixCheck.config });
            }
          }
        } catch (err) {
          await needsHuman(supabase, job.id, `Security fix hatası: ${String(err)}`);
          return;
        }

        secTur++;
      }
    }

    if (!securityPassed) {
      await needsHuman(supabase, job.id, "Security döngüsü aşılamadı");
      return;
    }

    // ── 8. Code Review döngüsü (max 3 tur) ───────────────────────────────────
    await updateJob(supabase, job.id, { status: "review_loop" });

    const crCheck = await checkAgentEnabled(supabase, job.id, "code-reviewer", "Running code review", () => null);

    if (crCheck.skipped) {
      console.warn("[orchestrator] ⚠ Code reviewer agent is disabled — skipping code review");
    } else {
      for (let i = 1; i <= 3; i++) {
        let rev;
        try {
          await logRoute("code-reviewer", "review");
          rev = await runCodeReviewer({ ...baseOpts, iteration: i, agentConfig: crCheck.config });
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
            const beFixCheck = await checkAgentEnabled(supabase, job.id, "backend-dev", "Fixing review issues (backend)", () => null);
            if (!beFixCheck.skipped) {
              await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues: beIssues, agentConfig: beFixCheck.config });
            }
          }
          if (feIssues.length > 0) {
            const feFixCheck = await checkAgentEnabled(supabase, job.id, "frontend-dev", "Fixing review issues (frontend)", () => null);
            if (!feFixCheck.skipped) {
              await runFrontend({ ...baseOpts, spec, plan, contextPath, fixIssues: feIssues, agentConfig: feFixCheck.config });
            }
          }
        } catch (err) {
          await needsHuman(supabase, job.id, `Review fix hatası: ${String(err)}`);
          return;
        }
      }
    }

    // ── 9. Test döngüsü (max 3 tur) ──────────────────────────────────────────
    await updateJob(supabase, job.id, { status: "test_loop" });

    const defaultCommitMsg = `feat: ${job.title} (job: ${job.id.slice(0, 8)})`;
    let lastFailures: string[] = [];

    const qaCheck = await checkAgentEnabled(supabase, job.id, "qa-engineer", "Running tests and QA", () => null);

    if (qaCheck.skipped) {
      console.warn("[orchestrator] ⚠ QA engineer agent is disabled — skipping testing, proceeding to commit/PR");
      try {
        await gitCommit(repoDir, defaultCommitMsg);
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
    } else {
      for (let i = 1; i <= 3; i++) {
        let t;
        try {
          await logRoute("qa-engineer", "analyze");
          t = await runTester({
            ...baseOpts,
            commitMessage: defaultCommitMsg,
            ...(lastFailures.length > 0 ? { failures: lastFailures } : {}),
            iteration: i,
            agentConfig: qaCheck.config,
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

        const fixIssues = t.failures.map((f) => ({
          file: "unknown",
          line: null,
          severity: "high" as const,
          problem: f,
          fix: "testi geçirecek şekilde düzelt",
          owner: "backend" as const,
        }));

        try {
          const beFixCheck = await checkAgentEnabled(supabase, job.id, "backend-dev", "Fixing test failures", () => null);
          if (!beFixCheck.skipped) {
            await runBackend({ ...baseOpts, spec, plan, contextPath, fixIssues, agentConfig: beFixCheck.config });
          } else {
            console.warn("[orchestrator] ⚠ Backend dev disabled — cannot fix test failures");
            await needsHuman(supabase, job.id, `Test fix hatası: backend dev agent disabled`);
            return;
          }
        } catch (err) {
          await needsHuman(supabase, job.id, `Test fix hatası: ${String(err)}`);
          return;
        }
      }
    }

    pipelineOk = true;
  } finally {
    await clearStepStatus(supabase, job.id);
    if (pipelineOk) {
      console.log(`[orchestrator] Pipeline completed for job ${job.id}`);
    }
  }
}
