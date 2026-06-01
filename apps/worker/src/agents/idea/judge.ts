import { JudgeSchema, type JudgeResult, type IdeaItem, type AdvocateResult, type AdversaryResult } from "@conductor/core";
import { runAgentForJSON } from "../../runner.js";
import { getAgentConfig } from "../../agentConfig.js";

export async function runJudge(
  idea: IdeaItem,
  advocateResult: AdvocateResult,
  adversaryResult: AdversaryResult,
  jobId: string,
  repoDir: string,
  supabase?: unknown,
): Promise<JudgeResult> {
  const config = getAgentConfig("judge");
  if (!config?.enabled) throw new Error("Judge agent disabled");

  const userPrompt = JSON.stringify({ idea, advocate: advocateResult, adversary: adversaryResult });

  return runAgentForJSON({
    repoDir,
    systemPrompt: config.systemPrompt,
    userPrompt,
    jobId,
    agentName: "judge",
    lane: config.laneOverride ?? "premium",
    model: config.model,
    schema: JudgeSchema,
    agentConfig: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });
}
