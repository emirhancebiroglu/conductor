import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  AgentConfigSchema,
  AgentCategorySchema,
  ProviderModelSchema,
  RunningJobSchema,
} from "@conductor/core";
import type { AgentConfigRow, AgentCategoryRow, ProviderModelRow, JobRow } from "@conductor/core";
import { AgentEditClient } from "./agent-edit-client";

export const dynamic = "force-dynamic";

function safeDate(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

interface Props {
  readonly params: Promise<{ slug: string }>;
}

export default async function AgentDetailPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createClient();

  const [agentResult, categoriesResult, modelsResult, jobResult] = await Promise.all([
    supabase
      .from("agent_config")
      .select("*")
      .eq("agent_name", slug)
      .maybeSingle() as unknown as Promise<{
      data: AgentConfigRow | null;
      error: { message: string } | null;
    }>,
    supabase
      .from("agent_categories")
      .select("*")
      .order("order", { ascending: true }) as unknown as Promise<{
      data: AgentCategoryRow[] | null;
      error: { message: string } | null;
    }>,
    supabase
      .from("provider_models")
      .select("*")
      .eq("available", true) as unknown as Promise<{
      data: ProviderModelRow[] | null;
      error: { message: string } | null;
    }>,
    supabase
      .from("jobs")
      .select("id, title, current_agent, started_at, current_step_message")
      .eq("status", "running")
      .eq("current_agent", slug)
      .maybeSingle() as unknown as Promise<{
      data: Pick<JobRow, "id" | "title" | "current_agent" | "started_at" | "current_step_message"> | null;
      error: { message: string } | null;
    }>,
  ]);

  if (agentResult.error) throw new Error(`Failed to load agent: ${agentResult.error.message}`);
  if (!agentResult.data) notFound();

  const row = agentResult.data;
  const agent = AgentConfigSchema.parse({
    id: row.id,
    agentName: row.agent_name,
    displayName: row.display_name,
    role: row.role,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.system_prompt,
    skillContent: row.skill_content,
    categoryId: row.category_id,
    enabled: row.enabled,
    laneOverride: row.lane_override,
    order: row.order,
    createdAt: safeDate(row.created_at),
    updatedAt: safeDate(row.updated_at),
  });

  const categories = (categoriesResult.data ?? []).map((r) =>
    AgentCategorySchema.parse({
      id: r.id, name: r.name, slug: r.slug, color: r.color,
      description: r.description, order: r.order, createdAt: safeDate(r.created_at),
    })
  );

  const providerModels = (modelsResult.data ?? []).map((r) => {
    let capabilities: Record<string, unknown> = {};
    if (r.capabilities && typeof r.capabilities === "object" && !Array.isArray(r.capabilities)) {
      capabilities = r.capabilities as Record<string, unknown>;
    }
    return ProviderModelSchema.parse({
      id: r.id, provider: r.provider, modelId: r.model_id, displayName: r.display_name,
      capabilities, available: r.available, createdAt: safeDate(r.created_at),
    });
  });

  const runningJobRow = jobResult.data;
  const runningJob = runningJobRow
    ? RunningJobSchema.parse({
        jobId: runningJobRow.id,
        jobTitle: runningJobRow.title,
        agentName: runningJobRow.current_agent!,
        startedAt: safeDate(runningJobRow.started_at),
        stepMessage: runningJobRow.current_step_message,
      })
    : undefined;

  return (
    <AgentEditClient
      agent={agent}
      categories={categories}
      providerModels={providerModels}
      {...(runningJob ? { initialRunningJob: runningJob } : {})}
    />
  );
}
