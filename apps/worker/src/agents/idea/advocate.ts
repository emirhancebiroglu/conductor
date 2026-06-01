import { AdvocateSchema, type AdvocateResult, type IdeaItem } from "@conductor/core";
import { runAgentForJSON } from "../../runner.js";
import { getAgentConfig } from "../../agentConfig.js";

export async function runAdvocate(
  idea: IdeaItem,
  jobId: string,
  repoDir: string,
  supabase?: unknown,
  modification?: string,
): Promise<AdvocateResult> {
  const config = getAgentConfig("advocate");
  if (!config?.enabled) throw new Error("Advocate agent disabled");

  let userPrompt = JSON.stringify(idea);
  if (modification) {
    userPrompt += `\nModifiye edilmiş versiyon: ${modification}`;
  }

  return runAgentForJSON({
    repoDir,
    systemPrompt: config.systemPrompt,
    userPrompt,
    jobId,
    agentName: "advocate",
    lane: config.laneOverride ?? "premium",
    model: config.model,
    schema: AdvocateSchema,
    agentConfig: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });
}
