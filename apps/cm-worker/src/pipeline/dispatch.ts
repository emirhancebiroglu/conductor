import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunner, AgentRunnerTask } from "@conductor/cm-adapters";

type AgentConfigRow = {
  id: string;
  agent_name: string;
  display_name: string;
  provider: string;
  model: string;
  system_prompt: string;
};

export type DispatchResult = {
  runId: string;
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function dispatchAgent(
  supabase: SupabaseClient,
  agentRunner: AgentRunner,
  agentName: string,
  scanId: string,
  workspaceId: string,
  task: AgentRunnerTask,
): Promise<DispatchResult> {
  const configResp = await supabase
    .from("agent_config")
    .select("*")
    .eq("agent_name", agentName)
    .single() as unknown as { data: AgentConfigRow | null; error: { message: string } | null };

  if (configResp.error || !configResp.data) {
    throw new Error(`Agent config not found for ${agentName}`);
  }

  const config = configResp.data;

  const result = await agentRunner.run(
    {
      agentName: config.agent_name,
      provider: config.provider,
      model: config.model,
      systemPrompt: config.system_prompt,
    },
    task,
  );

  const runResp = await supabase
    .from("runs")
    .insert({
      scan_id: scanId,
      agent: config.agent_name,
      lane: config.provider === "claude" ? "premium" : "cheap",
      model: config.model,
      status: "ok",
      input: { taskDescription: task.description },
      output: { summary: result.summary, edits: result.edits },
      log: null,
      iteration: 1,
    })
    .select("id")
    .single() as unknown as { data: { id: string } | null; error: { message: string } | null };

  if (runResp.error || !runResp.data) {
    throw new Error(`Failed to create runs row for ${agentName}`);
  }

  const runId = runResp.data.id;

  await supabase.from("usage_log").insert({
    run_id: runId,
    provider: config.provider,
    model: config.model,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    est_cost_usd: estimateCost(config.provider, result.usage.inputTokens, result.usage.outputTokens),
  });

  return {
    runId,
    agentName: config.agent_name,
    model: config.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}

function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    claude: { input: 0.000015, output: 0.000075 },
    opencode: { input: 0.000002, output: 0.000010 },
  };

  const rate = rates[provider] ?? { input: 0.000002, output: 0.000010 };
  return (inputTokens * rate.input + outputTokens * rate.output);
}
