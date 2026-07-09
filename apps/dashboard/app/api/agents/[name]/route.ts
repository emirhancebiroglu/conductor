import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AgentSlugSchema, LaneSchema } from "@conductor/core";
import type { AgentConfigRow } from "@conductor/core";
import { z } from "zod";
import { mapAgentRow } from "../_mappers";

export const dynamic = "force-dynamic";

const UpdateAgentBodySchema = z.object({
  displayName: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().min(10, "System prompt must be at least 10 characters").optional(),
  skillContent: z.string().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  laneOverride: LaneSchema.nullable().optional(),
  allowedTools: z.array(z.string()).optional(),
  order: z.number().int().optional(),
});

interface RouteContext {
  params: Promise<{ name: string }>;
}

// ── PUT /api/agents/[name] ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const parsedName = AgentSlugSchema.safeParse(name);
  if (!parsedName.success) {
    return NextResponse.json({ error: "Invalid agent slug" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsedBody = UpdateAgentBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsedBody.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const { data: existing } = (await supabase
      .from("agent_config")
      .select("id, provider, model")
      .eq("agent_name", parsedName.data)
      .maybeSingle()) as unknown as { data: { id: string; provider: string; model: string } | null };

    if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    // Validate model/provider combo if either changed
    const newProvider = parsedBody.data.provider ?? existing.provider;
    const newModel = parsedBody.data.model ?? existing.model;
    if (parsedBody.data.provider !== undefined || parsedBody.data.model !== undefined) {
      const { data: modelData } = (await supabase
        .from("provider_models")
        .select("id")
        .eq("provider", newProvider)
        .eq("model_id", newModel)
        .maybeSingle()) as unknown as { data: { id: string } | null };

      if (!modelData) {
        return NextResponse.json(
          { error: `Model "${newModel}" is not available for provider "${newProvider}"` },
          { status: 400 }
        );
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsedBody.data.displayName !== undefined) updatePayload.display_name = parsedBody.data.displayName;
    if (parsedBody.data.role !== undefined) updatePayload.role = parsedBody.data.role;
    if (parsedBody.data.provider !== undefined) updatePayload.provider = parsedBody.data.provider;
    if (parsedBody.data.model !== undefined) updatePayload.model = parsedBody.data.model;
    if (parsedBody.data.systemPrompt !== undefined) updatePayload.system_prompt = parsedBody.data.systemPrompt;
    if (parsedBody.data.skillContent !== undefined) updatePayload.skill_content = parsedBody.data.skillContent;
    if (parsedBody.data.categoryId !== undefined) updatePayload.category_id = parsedBody.data.categoryId;
    if (parsedBody.data.laneOverride !== undefined) updatePayload.lane_override = parsedBody.data.laneOverride;
    if (parsedBody.data.allowedTools !== undefined) updatePayload.allowed_tools = parsedBody.data.allowedTools;
    if (parsedBody.data.order !== undefined) updatePayload.order = parsedBody.data.order;

    const { data: updated, error: updateError } = (await (supabase.from("agent_config") as unknown as {
      update: (v: unknown) => { eq: (col: string, val: string) => { select: () => { single: () => Promise<{ data: AgentConfigRow | null; error: { message: string } | null }> } } };
    }).update(updatePayload).eq("agent_name", parsedName.data).select().single()) as unknown as {
      data: AgentConfigRow | null;
      error: { message: string } | null;
    };

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });

    return NextResponse.json({ agent: mapAgentRow(updated) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PATCH /api/agents/[name] — toggle enabled ────────────────────────────────
export async function PATCH(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const parsedName = AgentSlugSchema.safeParse(name);
  if (!parsedName.success) {
    return NextResponse.json({ error: "Invalid agent slug" }, { status: 400 });
  }

  try {
    const { data: agentsList, error: listError } = (await supabase
      .from("agent_config")
      .select("agent_name, enabled")) as unknown as {
      data: { agent_name: string; enabled: boolean }[] | null;
      error: { message: string } | null;
    };

    if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

    const target = agentsList?.find((a) => a.agent_name === parsedName.data);
    if (!target) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const nextEnabled = !target.enabled;
    if (!nextEnabled) {
      const enabledCount = agentsList?.filter((a) => a.enabled).length ?? 0;
      if (enabledCount <= 1) {
        return NextResponse.json(
          { error: `Cannot disable "${parsedName.data}": at least one agent must remain enabled` },
          { status: 400 }
        );
      }
    }

    const { data: updated, error: updateError } = (await (supabase.from("agent_config") as unknown as {
      update: (v: unknown) => { eq: (col: string, val: string) => { select: () => { single: () => Promise<{ data: AgentConfigRow | null; error: { message: string } | null }> } } };
    }).update({ enabled: nextEnabled }).eq("agent_name", parsedName.data).select().single()) as unknown as {
      data: AgentConfigRow | null;
      error: { message: string } | null;
    };

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Failed to toggle agent" }, { status: 500 });

    return NextResponse.json({ agent: mapAgentRow(updated) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE /api/agents/[name] ────────────────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const parsedName = AgentSlugSchema.safeParse(name);
  if (!parsedName.success) {
    return NextResponse.json({ error: "Invalid agent slug" }, { status: 400 });
  }

  try {
    // Guard: check if agent is currently running a job
    const { data: runningJob } = (await supabase
      .from("jobs")
      .select("id")
      .eq("status", "running")
      .eq("current_agent", parsedName.data)
      .maybeSingle()) as unknown as { data: { id: string } | null };

    if (runningJob) {
      return NextResponse.json(
        { error: "Cannot delete agent while it is processing a job" },
        { status: 409 }
      );
    }

    // Guard: cannot delete the last enabled agent
    const { data: agentsList } = (await supabase
      .from("agent_config")
      .select("agent_name, enabled")) as unknown as {
      data: { agent_name: string; enabled: boolean }[] | null;
    };

    const target = agentsList?.find((a) => a.agent_name === parsedName.data);
    if (!target) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const enabledCount = agentsList?.filter((a) => a.enabled).length ?? 0;
    if (target.enabled && enabledCount <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last enabled agent" },
        { status: 400 }
      );
    }

    const { error: deleteError } = (await (supabase.from("agent_config") as unknown as {
      delete: () => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
    }).delete().eq("agent_name", parsedName.data)) as unknown as {
      error: { message: string } | null;
    };

    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
