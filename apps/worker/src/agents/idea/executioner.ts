import { ExecutionerSchema, type ExecutionerResult, type IdeaItem } from "@conductor/core";
import { runAgentForJSON } from "../../runner.js";
import { getAgentConfig } from "../../agentConfig.js";

export async function runExecutioner(
  ideas: IdeaItem[],
  jobId: string,
  repoDir: string,
  supabase?: unknown,
): Promise<ExecutionerResult> {
  const config = getAgentConfig("executioner");
  if (!config?.enabled) throw new Error("Executioner agent disabled");

  const userPrompt = JSON.stringify({ ideas });

  return runAgentForJSON({
    repoDir,
    systemPrompt: config.systemPrompt,
    userPrompt,
    jobId,
    agentName: "executioner",
    lane: config.laneOverride ?? "cheap",
    model: config.model,
    schema: ExecutionerSchema,
    agentConfig: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });
}
