import { AdversarySchema, type AdversaryResult, type IdeaItem, type AdvocateResult } from "@conductor/core";
import { runAgentForJSON } from "../../runner.js";
import { getAgentConfig } from "../../agentConfig.js";

export async function runAdversary(
  idea: IdeaItem,
  advocateResult: AdvocateResult,
  jobId: string,
  repoDir: string,
  supabase?: unknown,
): Promise<AdversaryResult> {
  const config = getAgentConfig("adversary");
  if (!config?.enabled) throw new Error("Adversary agent disabled");

  const userPrompt =
    `Fikir: ${JSON.stringify(idea)}\nAdvocate argümanı: ${JSON.stringify(advocateResult)}`;

  return runAgentForJSON({
    repoDir,
    systemPrompt: config.systemPrompt,
    userPrompt,
    jobId,
    agentName: "adversary",
    lane: config.laneOverride ?? "cheap",
    model: config.model,
    schema: AdversarySchema,
    agentConfig: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });
}
