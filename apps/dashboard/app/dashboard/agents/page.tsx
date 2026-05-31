import { createClient } from "@/lib/supabase/server";
import { AgentsClient } from "@/app/dashboard/agents/agents-client";
import {
  AgentConfigSchema,
  AgentCategorySchema,
  ProviderModelSchema,
  RunningJobSchema,
} from "@conductor/core";
import type { AgentConfigRow, AgentCategoryRow, ProviderModelRow, JobRow } from "@conductor/core";
import {
  FIXTURE_AGENTS,
  FIXTURE_CATEGORIES,
  FIXTURE_PROVIDER_MODELS,
  FIXTURE_RUNNING_JOBS,
  FIXTURE_RUNNING_JOBS_WITH_RUNNING,
} from "./__fixtures";

export const dynamic = "force-dynamic";

function safeDate(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

interface Props {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AgentsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const fixture = sp["__fixture"];

  if (process.env["NODE_ENV"] !== "production" && fixture === "agents_default") {
    return (
      <AgentsClient
        initialAgents={FIXTURE_AGENTS}
        initialCategories={FIXTURE_CATEGORIES}
        providerModels={FIXTURE_PROVIDER_MODELS}
        initialRunningJobs={FIXTURE_RUNNING_JOBS}
      />
    );
  }
  if (process.env["NODE_ENV"] !== "production" && fixture === "agents_with_running") {
    return (
      <AgentsClient
        initialAgents={FIXTURE_AGENTS}
        initialCategories={FIXTURE_CATEGORIES}
        providerModels={FIXTURE_PROVIDER_MODELS}
        initialRunningJobs={FIXTURE_RUNNING_JOBS_WITH_RUNNING}
      />
    );
  }
  if (process.env["NODE_ENV"] !== "production" && fixture === "agents_all_disabled") {
    const disabled = FIXTURE_AGENTS.map((a) => ({ ...a, enabled: false }));
    return (
      <AgentsClient
        initialAgents={disabled}
        initialCategories={FIXTURE_CATEGORIES}
        providerModels={FIXTURE_PROVIDER_MODELS}
        initialRunningJobs={FIXTURE_RUNNING_JOBS}
      />
    );
  }

  const supabase = await createClient();

  const [agentsResult, categoriesResult, modelsResult, jobsResult] = await Promise.all([
    supabase
      .from("agent_config")
      .select("*")
      .order("order", { ascending: true }) as unknown as Promise<{
      data: AgentConfigRow[] | null;
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
      .not("current_agent", "is", null) as unknown as Promise<{
      data: Pick<JobRow, "id" | "title" | "current_agent" | "started_at" | "current_step_message">[] | null;
      error: { message: string } | null;
    }>,
  ]);

  if (agentsResult.error) throw new Error(`Failed to load agents: ${agentsResult.error.message}`);
  if (categoriesResult.error) throw new Error(`Failed to load categories: ${categoriesResult.error.message}`);
  if (modelsResult.error) throw new Error(`Failed to load provider models: ${modelsResult.error.message}`);
  if (jobsResult.error) throw new Error(`Failed to load running jobs: ${jobsResult.error.message}`);

  const initialAgents = (agentsResult.data ?? []).map((row) =>
    AgentConfigSchema.parse({
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
    })
  );

  const initialCategories = (categoriesResult.data ?? []).map((row) =>
    AgentCategorySchema.parse({
      id: row.id,
      name: row.name,
      slug: row.slug,
      color: row.color,
      description: row.description,
      order: row.order,
      createdAt: safeDate(row.created_at),
    })
  );

  const providerModels = (modelsResult.data ?? []).map((row) => {
    let capabilities: Record<string, unknown> = {};
    if (row.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)) {
      capabilities = row.capabilities as Record<string, unknown>;
    }
    return ProviderModelSchema.parse({
      id: row.id,
      provider: row.provider,
      modelId: row.model_id,
      displayName: row.display_name,
      capabilities,
      available: row.available,
      createdAt: safeDate(row.created_at),
    });
  });

  const initialRunningJobs = (jobsResult.data ?? []).map((row) =>
    RunningJobSchema.parse({
      jobId: row.id,
      jobTitle: row.title,
      agentName: row.current_agent!,
      startedAt: safeDate(row.started_at),
      stepMessage: row.current_step_message,
    })
  );

  return (
    <AgentsClient
      initialAgents={initialAgents}
      initialCategories={initialCategories}
      providerModels={providerModels}
      initialRunningJobs={initialRunningJobs}
    />
  );
}
