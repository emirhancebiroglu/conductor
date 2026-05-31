import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsagePeriod = {
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
};

export type LimitStatus = "ok" | "soft" | "hard";

export type UsageState = {
  last5h: UsagePeriod;
  last7d: UsagePeriod;
  thisMonth: UsagePeriod;
  goStatus: LimitStatus;
  /** True when a hard limit is breached and new jobs should be paused */
  blocked: boolean;
};

// ---------------------------------------------------------------------------
// Limits (from docs/08_COST_AND_LIMITS.md)
// ---------------------------------------------------------------------------

const GO_5H_SOFT = 9;
const GO_WEEK_SOFT = 24;
const GO_MONTH_SOFT = 50;

const GO_5H_HARD = GO_5H_SOFT * 1.2;
const GO_WEEK_HARD = GO_WEEK_SOFT * 1.2;
const GO_MONTH_HARD = GO_MONTH_SOFT * 1.2;

// ---------------------------------------------------------------------------
// Token / cost estimation
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCost(
  inputText: string,
  outputText: string,
  lane: string,
  _model: string,
): number {
  const inputTok = estimateTokens(inputText);
  const outputTok = estimateTokens(outputText);

  if (lane === "premium") {
    // Claude Pro: $3/MTok input, $15/MTok output (estimated 2026)
    return (inputTok * 3 + outputTok * 15) / 1_000_000;
  }

  // OpenCode Go: flat monthly $60 ≈ 10M tokens → $0.000006/token
  const RATE = 0.000006;
  return (inputTok + outputTok) * RATE;
}

// ---------------------------------------------------------------------------
// Supabase client (lazy singleton — worker already has env loaded)
// ---------------------------------------------------------------------------

function getSupabase() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Log usage
// ---------------------------------------------------------------------------

export async function logUsage(
  runId: string,
  input: string,
  output: string,
  lane: string,
  model: string,
): Promise<void> {
  const provider = lane === "premium" ? "claude" : "opencode-go";
  const input_tokens = estimateTokens(input);
  const output_tokens = estimateTokens(output);
  const est_cost_usd = estimateCost(input, output, lane, model);

  const { error } = await getSupabase().from("usage_log").insert({
    run_id: runId,
    provider,
    model,
    input_tokens,
    output_tokens,
    est_cost_usd,
  });

  if (error) {
    // non-fatal — never block agent work for logging failure
    console.error(`[usage] logUsage failed: ${(error as { message: string }).message}`);
  }
}

// ---------------------------------------------------------------------------
// Read usage state + limit check
// ---------------------------------------------------------------------------

type UsageRow = { est_cost_usd: number; input_tokens: number; output_tokens: number };

function sumRows(rows: UsageRow[]): UsagePeriod {
  return rows.reduce(
    (acc, r) => ({
      cost_usd: acc.cost_usd + r.est_cost_usd,
      input_tokens: acc.input_tokens + r.input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
    }),
    { cost_usd: 0, input_tokens: 0, output_tokens: 0 },
  );
}

function limitStatus(period: UsagePeriod, soft: number, hard: number): LimitStatus {
  if (period.cost_usd >= hard) return "hard";
  if (period.cost_usd >= soft) return "soft";
  return "ok";
}

// ---------------------------------------------------------------------------
// Worker status
// ---------------------------------------------------------------------------

export type WorkerStatusValue = "online" | "paused_limit" | "paused_manual";

export async function updateWorkerStatus(
  status: WorkerStatusValue,
  reason?: string,
): Promise<void> {
  const supabase = getSupabase();
  // Always update the single row (upsert by selecting first row)
  const { data } = await supabase.from("worker_status").select("id").limit(1).maybeSingle();
  if (data?.id) {
    await supabase
      .from("worker_status")
      .update({ status, reason: reason ?? null, updated_at: new Date().toISOString() })
      .eq("id", data.id);
  } else {
    await supabase.from("worker_status").insert({ status, reason: reason ?? null });
  }
}

export async function getWorkerStatus(): Promise<WorkerStatusValue> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("worker_status")
    .select("status")
    .limit(1)
    .maybeSingle();
  return (data?.status as WorkerStatusValue | undefined) ?? "online";
}

export async function getUsageState(): Promise<UsageState> {
  const supabase = getSupabase();
  const now = new Date();

  const t5h = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
  const t7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const tMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [r5h, r7d, rMonth] = await Promise.all([
    supabase
      .from("usage_log")
      .select("est_cost_usd, input_tokens, output_tokens")
      .gte("created_at", t5h),
    supabase
      .from("usage_log")
      .select("est_cost_usd, input_tokens, output_tokens")
      .gte("created_at", t7d),
    supabase
      .from("usage_log")
      .select("est_cost_usd, input_tokens, output_tokens")
      .gte("created_at", tMonth),
  ]);

  const last5h = sumRows((r5h.data ?? []) as UsageRow[]);
  const last7d = sumRows((r7d.data ?? []) as UsageRow[]);
  const thisMonth = sumRows((rMonth.data ?? []) as UsageRow[]);

  const s5h = limitStatus(last5h, GO_5H_SOFT, GO_5H_HARD);
  const s7d = limitStatus(last7d, GO_WEEK_SOFT, GO_WEEK_HARD);
  const sMo = limitStatus(thisMonth, GO_MONTH_SOFT, GO_MONTH_HARD);

  // Worst of the three periods
  const rank: Record<LimitStatus, number> = { ok: 0, soft: 1, hard: 2 };
  const goStatus = [s5h, s7d, sMo].reduce(
    (worst, s) => (rank[s] > rank[worst] ? s : worst),
    "ok" as LimitStatus,
  );

  return {
    last5h,
    last7d,
    thisMonth,
    goStatus,
    blocked: goStatus === "hard",
  };
}
