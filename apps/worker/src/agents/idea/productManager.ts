import { ProductManagerSchema, type ProductManagerResult, type JudgeResult } from "@conductor/core";
import { runAgentForJSON } from "../../runner.js";
import { getAgentConfig } from "../../agentConfig.js";

export async function runProductManager(
  judgeResult: JudgeResult,
  jobId: string,
  repoDir: string,
  supabase?: unknown,
): Promise<ProductManagerResult> {
  const config = getAgentConfig("product-manager");
  if (!config?.enabled) throw new Error("Product-manager agent disabled");

  const userPrompt = JSON.stringify(judgeResult.product_report);

  return runAgentForJSON({
    repoDir,
    systemPrompt: config.systemPrompt,
    userPrompt,
    jobId,
    agentName: "product-manager",
    lane: config.laneOverride ?? "premium",
    model: config.model,
    schema: ProductManagerSchema,
    agentConfig: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });
}
