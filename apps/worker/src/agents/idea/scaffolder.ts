import { ScaffolderSchema, type ScaffolderResult, type ProductManagerResult } from "@conductor/core";
import { runAgentFreeText } from "../../runner.js";
import { getAgentConfig } from "../../agentConfig.js";

export async function runScaffolder(
  prd: ProductManagerResult,
  repoDir: string,
  jobId: string,
  supabase?: unknown,
): Promise<ScaffolderResult> {
  const config = getAgentConfig("scaffolder");
  if (!config?.enabled) throw new Error("Scaffolder agent disabled");

  const userPrompt =
    `Aşağıdaki PRD'ye göre repo iskeletini oluştur ve feature_jobs listesini döndür:\n${JSON.stringify(prd)}`;

  const raw = await runAgentFreeText({
    repoDir,
    systemPrompt: config.systemPrompt,
    userPrompt,
    jobId,
    agentName: "scaffolder",
    lane: config.laneOverride ?? "cheap",
    model: config.model,
    agentConfig: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });

  // Extract JSON block from free-text output
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1]!.trim() : raw.slice(raw.search(/[{[]/)).trim();
  return ScaffolderSchema.parse(JSON.parse(jsonStr));
}
