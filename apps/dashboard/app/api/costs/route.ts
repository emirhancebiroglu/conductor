import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

// ---------------------------------------------------------------------------
// Limit constants (mirrors docs/08_COST_AND_LIMITS.md)
// ---------------------------------------------------------------------------

const LIMITS = {
  go5hSoft: 9,
  go5hHard: 12,
  goWeekSoft: 24,
  goWeekHard: 30,
  goMonthSoft: 50,
  goMonthHard: 60,
};

export type CostsPayload = {
  limits: {
    last5h: { used: number; soft: number; hard: number };
    last7d: { used: number; soft: number; hard: number };
    thisMonth: { used: number; soft: number; hard: number };
  };
  weekSummary: {
    totalJobs: number;
    successfulPRs: number;
    needsHuman: number;
    totalCostUsd: number;
    avgJobCostUsd: number;
    topAgent: { name: string; costUsd: number } | null;
  };
  recentJobs: {
    id: string;
    title: string;
    createdAt: string;
    status: string;
    agentCount: number;
    costUsd: number;
  }[];
};

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const now = new Date();
    const t5h = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    const t7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const tMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const t7dStr = t7d;

    // ── Get all job & run IDs for the active workspace ────────────────────
    const { data: wsJobRows } = await supabase
      .from("jobs")
      .select("id")
      .eq("workspace_id", workspaceId);

    const wsJobIds = ((wsJobRows ?? []) as { id: string }[]).map((r) => r.id);
    let wsRunIds: string[] = [];

    if (wsJobIds.length > 0) {
      const { data: wsRunRows } = await supabase
        .from("runs")
        .select("id")
        .in("job_id", wsJobIds);
      wsRunIds = ((wsRunRows ?? []) as { id: string }[]).map((r) => r.id);
    }

    // ── Usage log aggregates (workspace-filtered) ─────────────────────────
    async function usageAgg(timeFilter: string) {
      if (wsRunIds.length === 0) return [];
      const { data } = await supabase
        .from("usage_log")
        .select("est_cost_usd")
        .in("run_id", wsRunIds)
        .gte("created_at", timeFilter);
      return (data ?? []) as { est_cost_usd: number | null }[];
    }

    const [r5h, rMonth] = await Promise.all([
      usageAgg(t5h),
      usageAgg(tMonth),
    ]);

    const sum = (rows: { est_cost_usd: number | null }[]) =>
      rows.reduce((a, r) => a + (r.est_cost_usd ?? 0), 0);

    const limits = {
      last5h: { used: sum(r5h), soft: LIMITS.go5hSoft, hard: LIMITS.go5hHard },
      last7d: { used: 0, soft: LIMITS.goWeekSoft, hard: LIMITS.goWeekHard },
      thisMonth: { used: sum(rMonth), soft: LIMITS.goMonthSoft, hard: LIMITS.goMonthHard },
    };

    // ── Per-run cost for the past 7d ──────────────────────────────────────
    let usageRows7d: { est_cost_usd: number | null; run_id: string }[] = [];
    let runIds7d: string[] = [];

    if (wsRunIds.length > 0) {
      const { data } = await supabase
        .from("usage_log")
        .select("est_cost_usd, run_id")
        .in("run_id", wsRunIds)
        .gte("created_at", t7d);
      usageRows7d = (data ?? []) as { est_cost_usd: number | null; run_id: string }[];
      runIds7d = [...new Set(usageRows7d.map((r) => r.run_id))];
    }

    // cost per run_id
    const costPerRun = new Map<string, number>();
    for (const r of usageRows7d) {
      costPerRun.set(r.run_id, (costPerRun.get(r.run_id) ?? 0) + (r.est_cost_usd ?? 0));
    }

    const sum7d = [...costPerRun.values()].reduce((a, b) => a + b, 0);
    limits.last7d.used = sum7d;

    // runs in last 7d
    const { data: runsRaw } = runIds7d.length > 0
      ? await supabase.from("runs").select("id, job_id, agent").in("id", runIds7d)
      : { data: [] };

    type RunRow = { id: string; job_id: string; agent: string };
    const runs7d = (runsRaw ?? []) as RunRow[];

    // cost per job
    const costPerJob = new Map<string, number>();
    const agentCountPerJob = new Map<string, number>();
    // cost per agent
    const costPerAgent = new Map<string, number>();

    for (const run of runs7d) {
      const c = costPerRun.get(run.id) ?? 0;
      costPerJob.set(run.job_id, (costPerJob.get(run.job_id) ?? 0) + c);
      agentCountPerJob.set(run.job_id, (agentCountPerJob.get(run.job_id) ?? 0) + 1);
      costPerAgent.set(run.agent, (costPerAgent.get(run.agent) ?? 0) + c);
    }

    // ── Jobs in last 7d ──────────────────────────────────────────────────
    const { data: jobsRaw } = await supabase
      .from("jobs")
      .select("id, title, status, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", t7dStr)
      .order("created_at", { ascending: false });

    type JobMini = { id: string; title: string; status: string; created_at: string };
    const jobs7d = (jobsRaw ?? []) as JobMini[];

    const totalJobs = jobs7d.length;
    const successfulPRs = jobs7d.filter((j) => j.status === "pr_opened" || j.status === "merged").length;
    const needsHumanCount = jobs7d.filter((j) => j.status === "needs_human").length;
    const totalCost = [...costPerJob.values()].reduce((a, b) => a + b, 0);
    const avgJobCost = totalJobs > 0 ? totalCost / totalJobs : 0;

    let topAgent: { name: string; costUsd: number } | null = null;
    for (const [name, cost] of costPerAgent.entries()) {
      if (!topAgent || cost > topAgent.costUsd) topAgent = { name, costUsd: cost };
    }

    // ── Recent 20 jobs (workspace-filtered) ──────────────────────────────
    const { data: recentRaw } = await supabase
      .from("jobs")
      .select("id, title, status, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20);

    type JobFull = { id: string; title: string; status: string; created_at: string };
    const recentJobs = ((recentRaw ?? []) as JobFull[]).map((j) => ({
      id: j.id,
      title: j.title,
      createdAt: j.created_at,
      status: j.status,
      agentCount: agentCountPerJob.get(j.id) ?? 0,
      costUsd: costPerJob.get(j.id) ?? 0,
    }));

    const payload: CostsPayload = {
      limits,
      weekSummary: {
        totalJobs,
        successfulPRs,
        needsHuman: needsHumanCount,
        totalCostUsd: totalCost,
        avgJobCostUsd: avgJobCost,
        topAgent,
      },
      recentJobs,
    };

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
