import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  runScout,
  runExecutioner,
  runAdvocate,
  runAdversary,
  runJudge,
  runProductManager,
  runScaffolder,
} from "./agents/idea/index.js";
import type { JudgeResult, IdeaItem, ScaffolderFeatureJobSchema } from "@conductor/core";
import { z } from "zod";
import { loadAgentConfig } from "./agentConfig.js";

// why: supabase any client passed through — typed at call site
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

// Matches the DB row fields we read from processJob
export type IdeaJob = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  type: string;
  lane_preference: string;
  idea_loop_count?: number | null;
  idea_constraints?: unknown | null;
  research_output?: unknown | null;
  prd?: string | null;
  prd_approved?: boolean | null;
};

type FeatureJobRow = z.infer<typeof ScaffolderFeatureJobSchema>;

const MAX_LOOPS = 3;
const DEBATE_MAX = 3;

// ---------------------------------------------------------------------------
// Supabase helpers (local — supabase is injected, not module-global)
// ---------------------------------------------------------------------------

async function updateJob(
  supabase: SupabaseAny,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`updateJob failed: ${(error as { message: string }).message}`);
}

// ---------------------------------------------------------------------------
// Sub-job creation
// ---------------------------------------------------------------------------

async function createIdeaFeatureJobs(
  supabase: SupabaseAny,
  featureJobs: FeatureJobRow[],
  parentJob: IdeaJob,
): Promise<void> {
  const rows = featureJobs.map((f) => ({
    project_id: parentJob.project_id,
    type: "feature",
    title: f.title,
    description: f.description,
    lane_preference: parentJob.lane_preference ?? "auto",
    parent_job_id: parentJob.id,
    status: "queued",
  }));

  const { error } = await supabase.from("jobs").insert(rows);
  if (error) {
    throw new Error(`createIdeaFeatureJobs failed: ${(error as { message: string }).message}`);
  }

  console.log(
    `[ideaOrchestrator] Created ${rows.length} feature jobs from idea pipeline: ${featureJobs.map((f) => f.title).join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Scaffold phase (called after PRD is human-approved)
// ---------------------------------------------------------------------------

export async function runScaffoldPhase(
  supabase: SupabaseAny,
  job: IdeaJob,
): Promise<void> {
  await loadAgentConfig(supabase);
  const repoDir = join(tmpdir(), `conductor-scaffold-${job.id}`);
  mkdirSync(repoDir, { recursive: true });

  let pmResult;
  try {
    const raw = job.research_output as Record<string, unknown> | null;
    if (!raw?.features) throw new Error("research_output.features missing");
    // ProductManagerResult shape reconstructed from stored research_output
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pmResult = raw as any;
  } catch (err) {
    await updateJob(supabase, job.id, {
      status: "failed",
      error: `Scaffold: research_output parse hatası: ${String(err)}`,
    });
    return;
  }

  let scaffoldResult;
  try {
    scaffoldResult = await runScaffolder(pmResult, repoDir, job.id, supabase);
  } catch (err) {
    await updateJob(supabase, job.id, {
      status: "failed",
      error: `Scaffolder hatası: ${String(err)}`,
    });
    return;
  }

  try {
    await createIdeaFeatureJobs(supabase, scaffoldResult.feature_jobs, job);
  } catch (err) {
    await updateJob(supabase, job.id, {
      status: "failed",
      error: `Feature job oluşturma hatası: ${String(err)}`,
    });
    return;
  }

  await updateJob(supabase, job.id, {
    status: "decomposed",
    scaffold_repo: scaffoldResult.scaffold_notes,
  });

  console.log(`[ideaOrchestrator] Scaffold complete for job ${job.id} — ${scaffoldResult.feature_jobs.length} feature jobs queued`);
}

// ---------------------------------------------------------------------------
// Main idea pipeline
// ---------------------------------------------------------------------------

export async function runIdeaPipeline(
  supabase: SupabaseAny,
  job: IdeaJob,
): Promise<void> {
  // Idea pipeline runs entirely without a repo — use a neutral tmpdir as repoDir
  // (runner.ts requires repoDir; agents won't touch the filesystem in research phases)
  const repoDir = join(tmpdir(), `conductor-idea-${job.id}`);
  mkdirSync(repoDir, { recursive: true });

  let loopCount = (job.idea_loop_count as number | null | undefined) ?? 0;
  let constraints: object | null = (job.idea_constraints as object | null | undefined) ?? null;

  await loadAgentConfig(supabase);

  LOOP: while (loopCount < MAX_LOOPS) {
    await updateJob(supabase, job.id, {
      status: "researching",
      idea_loop_count: loopCount + 1,
      current_agent: "scout",
      current_step_message: `Araştırma turu ${loopCount + 1}`,
    });

    // ── 1. Scout ────────────────────────────────────────────────────────────
    let scoutResult;
    try {
      scoutResult = await runScout(
        job.description,
        null,
        job.id,
        repoDir,
        supabase,
        constraints ?? undefined,
      );
    } catch (err) {
      await updateJob(supabase, job.id, {
        status: "failed",
        error: `Scout hatası: ${String(err)}`,
        current_agent: null,
        current_step_message: null,
      });
      return;
    }

    // ── 2. Executioner ──────────────────────────────────────────────────────
    await updateJob(supabase, job.id, {
      current_agent: "executioner",
      current_step_message: "Kill test uygulanıyor",
    });

    const top5Ideas: IdeaItem[] = scoutResult.ideas.filter((i) =>
      scoutResult.top_5_ids.includes(i.rank),
    );

    let execResult;
    try {
      execResult = await runExecutioner(top5Ideas, job.id, repoDir, supabase);
    } catch (err) {
      await updateJob(supabase, job.id, {
        status: "failed",
        error: `Executioner hatası: ${String(err)}`,
        current_agent: null,
        current_step_message: null,
      });
      return;
    }

    if (execResult.survivors.length === 0) {
      loopCount++;
      if (loopCount >= MAX_LOOPS) break LOOP;
      constraints = {
        avoid: Object.values(execResult.kill_reasons),
        focus_on: [],
        note: "Tüm fikirler kill test'i geçemedi",
      };
      continue LOOP;
    }

    // En yüksek skorlu hayatta kalanı seç
    const bestSurvivorRank = execResult.survivors[0]!;
    const winningIdea = scoutResult.ideas.find((i) => i.rank === bestSurvivorRank)!;

    // ── 3–4. Debate loop ────────────────────────────────────────────────────
    let debateCount = 0;
    let modification: string | undefined;
    let finalJudgeResult: JudgeResult | null = null;

    while (debateCount < DEBATE_MAX) {
      // Advocate first, then Adversary sees advocate output (sequential)
      await updateJob(supabase, job.id, {
        current_agent: "advocate",
        current_step_message: `Debate ${debateCount + 1}/${DEBATE_MAX} — savunma`,
      });

      let advocateResult;
      try {
        advocateResult = await runAdvocate(winningIdea, job.id, repoDir, supabase, modification);
      } catch (err) {
        await updateJob(supabase, job.id, {
          status: "failed",
          error: `Advocate hatası: ${String(err)}`,
          current_agent: null,
          current_step_message: null,
        });
        return;
      }

      await updateJob(supabase, job.id, {
        current_agent: "adversary",
        current_step_message: `Debate ${debateCount + 1}/${DEBATE_MAX} — itiraz`,
      });

      let adversaryResult;
      try {
        adversaryResult = await runAdversary(winningIdea, advocateResult, job.id, repoDir, supabase);
      } catch (err) {
        await updateJob(supabase, job.id, {
          status: "failed",
          error: `Adversary hatası: ${String(err)}`,
          current_agent: null,
          current_step_message: null,
        });
        return;
      }

      await updateJob(supabase, job.id, {
        current_agent: "judge",
        current_step_message: `Debate ${debateCount + 1}/${DEBATE_MAX} — karar`,
      });

      let judgeResult;
      try {
        judgeResult = await runJudge(winningIdea, advocateResult, adversaryResult, job.id, repoDir, supabase);
      } catch (err) {
        await updateJob(supabase, job.id, {
          status: "failed",
          error: `Judge hatası: ${String(err)}`,
          current_agent: null,
          current_step_message: null,
        });
        return;
      }

      if (judgeResult.decision === "pass") {
        finalJudgeResult = judgeResult;
        break;
      }

      if (judgeResult.decision === "modify") {
        modification = judgeResult.modification?.modified_idea;
        debateCount++;
        continue;
      }

      if (judgeResult.decision === "deadlock") {
        loopCount++;
        constraints = (judgeResult.scout_constraints as object | null | undefined) ?? null;
        if (loopCount >= MAX_LOOPS) break LOOP;
        continue LOOP;
      }
    }

    if (!finalJudgeResult) {
      loopCount++;
      if (loopCount >= MAX_LOOPS) break LOOP;
      continue LOOP;
    }

    // ── 5. Product Manager → PRD ────────────────────────────────────────────
    await updateJob(supabase, job.id, {
      current_agent: "product-manager",
      current_step_message: "PRD oluşturuluyor",
    });

    let pmResult;
    try {
      pmResult = await runProductManager(finalJudgeResult, job.id, repoDir, supabase);
    } catch (err) {
      await updateJob(supabase, job.id, {
        status: "failed",
        error: `Product Manager hatası: ${String(err)}`,
        current_agent: null,
        current_step_message: null,
      });
      return;
    }

    await updateJob(supabase, job.id, {
      status: "prd_ready",
      prd: pmResult.prd_markdown,
      prd_approved: false,
      research_output: {
        scoutResult,
        execResult,
        judgeResult: finalJudgeResult,
        features: pmResult.features,
        pmResult,
      },
      current_agent: null,
      current_step_message: "PRD insan onayı bekliyor",
    });

    console.log(`[ideaOrchestrator] PRD ready for job ${job.id} — awaiting human approval`);
    return; // Worker durur, insan onayı bekler
  }

  // MAX_LOOPS tamamlandı, uzlaşılabilir fikir bulunamadı
  await updateJob(supabase, job.id, {
    status: "idea_exhausted",
    error: JSON.stringify({
      loops_completed: loopCount,
      summary: "3 turda uzlaşılabilir bir fikir bulunamadı",
      last_constraints: constraints,
    }),
    current_agent: null,
    current_step_message: null,
  });

  console.warn(`[ideaOrchestrator] Idea pipeline exhausted after ${loopCount} loops for job ${job.id}`);
}
