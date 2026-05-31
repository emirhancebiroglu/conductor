import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AgentSlugSchema, LaneSchema, RunningJobSchema } from "@conductor/core";
import type { AgentConfigRow, AgentCategoryRow, JobRow } from "@conductor/core";
import { z } from "zod";
import { mapAgentRow, mapCategoryRow } from "./_mappers";

export const dynamic = "force-dynamic";

// ── GET /api/agents ──────────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [agentsResult, jobsResult, categoriesResult] = await Promise.all([
      supabase
        .from("agent_config")
        .select("*")
        .order("order", { ascending: true }) as unknown as Promise<{
          data: AgentConfigRow[] | null;
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
      supabase
        .from("agent_categories")
        .select("*")
        .order("order", { ascending: true }) as unknown as Promise<{
          data: AgentCategoryRow[] | null;
          error: { message: string } | null;
        }>,
    ]);

    if (agentsResult.error) return NextResponse.json({ error: agentsResult.error.message }, { status: 500 });
    if (jobsResult.error) return NextResponse.json({ error: jobsResult.error.message }, { status: 500 });
    if (categoriesResult.error) return NextResponse.json({ error: categoriesResult.error.message }, { status: 500 });

    const agents = (agentsResult.data ?? []).map(mapAgentRow);
    const categories = (categoriesResult.data ?? []).map(mapCategoryRow);
    const runningJobs = (jobsResult.data ?? []).map((row) =>
      RunningJobSchema.parse({
        jobId: row.id,
        jobTitle: row.title,
        agentName: row.current_agent!,
        startedAt: row.started_at ?? new Date().toISOString(),
        stepMessage: row.current_step_message,
      })
    );

    return NextResponse.json({ agents, runningJobs, categories });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST /api/agents ─────────────────────────────────────────────────────────
const CreateAgentBodySchema = z.object({
  agentName: AgentSlugSchema,
  displayName: z.string().min(1),
  role: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(10, "System prompt must be at least 10 characters"),
  skillContent: z.string().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  laneOverride: LaneSchema.nullable().optional(),
  order: z.number().int().default(0),
  enabled: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateAgentBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const d = parsed.data;

  try {
    // Check for duplicate agent_name
    const { data: existing } = (await supabase
      .from("agent_config")
      .select("id")
      .eq("agent_name", d.agentName)
      .maybeSingle()) as unknown as { data: { id: string } | null };

    if (existing) {
      return NextResponse.json(
        { error: `Agent with slug "${d.agentName}" already exists` },
        { status: 409 }
      );
    }

    // Validate model exists for provider
    const { data: modelData } = (await supabase
      .from("provider_models")
      .select("id")
      .eq("provider", d.provider)
      .eq("model_id", d.model)
      .maybeSingle()) as unknown as { data: { id: string } | null };

    if (!modelData) {
      return NextResponse.json(
        { error: `Model "${d.model}" is not available for provider "${d.provider}"` },
        { status: 400 }
      );
    }

    const { data: inserted, error: insertError } = (await (supabase.from("agent_config") as unknown as {
      insert: (v: unknown) => { select: () => { single: () => Promise<{ data: AgentConfigRow | null; error: { message: string } | null }> } };
    }).insert({
      agent_name: d.agentName,
      display_name: d.displayName,
      role: d.role,
      provider: d.provider,
      model: d.model,
      system_prompt: d.systemPrompt,
      skill_content: d.skillContent ?? null,
      category_id: d.categoryId ?? null,
      lane_override: d.laneOverride ?? null,
      order: d.order,
      enabled: d.enabled,
    }).select().single()) as unknown as { data: AgentConfigRow | null; error: { message: string } | null };

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    if (!inserted) return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });

    return NextResponse.json({ agent: mapAgentRow(inserted) }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
