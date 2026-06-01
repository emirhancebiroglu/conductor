import { IdeaSchema, type IdeaResult } from "@conductor/core";
import { runAgentForJSON } from "../../runner.js";
import { getAgentConfig } from "../../agentConfig.js";

export async function runScout(
  idea: string,
  theme: string | null,
  jobId: string,
  repoDir: string,
  supabase?: unknown,
  constraints?: object,
): Promise<IdeaResult> {
  const config = getAgentConfig("scout");
  if (!config?.enabled) throw new Error("Scout agent disabled");

  let userPrompt = theme ? `Tema: ${theme}\n\nFikir: ${idea}` : `Fikir: ${idea}`;
  if (constraints) {
    userPrompt += `\n\nÖnceki aramada şunları deneme: ${JSON.stringify(constraints)}`;
  }

  return runAgentForJSON({
    repoDir,
    systemPrompt: config.systemPrompt,
    userPrompt,
    jobId,
    agentName: "scout",
    lane: config.laneOverride ?? "cheap",
    model: config.model,
    schema: IdeaSchema,
    agentConfig: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });
}
