import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AgentCategoryRow } from "@conductor/core";
import { z } from "zod";
import { mapCategoryRow } from "../../_mappers";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const UpdateCategoryBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color").optional(),
  description: z.string().nullable().optional(),
  order: z.number().int().optional(),
  // slug is immutable after creation
});

// ── PUT /api/agents/categories/[id] ──────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateCategoryBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const { data: existing } = (await supabase
      .from("agent_categories")
      .select("id")
      .eq("id", id)
      .maybeSingle()) as unknown as { data: { id: string } | null };

    if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
    if (parsed.data.color !== undefined) updatePayload.color = parsed.data.color;
    if (parsed.data.description !== undefined) updatePayload.description = parsed.data.description;
    if (parsed.data.order !== undefined) updatePayload.order = parsed.data.order;

    const { data: updated, error: updateError } = (await (supabase.from("agent_categories") as unknown as {
      update: (v: unknown) => { eq: (col: string, val: string) => { select: () => { single: () => Promise<{ data: AgentCategoryRow | null; error: { message: string } | null }> } } };
    }).update(updatePayload).eq("id", id).select().single()) as unknown as {
      data: AgentCategoryRow | null;
      error: { message: string } | null;
    };

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Failed to update category" }, { status: 500 });

    return NextResponse.json({ category: mapCategoryRow(updated) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE /api/agents/categories/[id] ───────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const { data: existing } = (await supabase
      .from("agent_categories")
      .select("id")
      .eq("id", id)
      .maybeSingle()) as unknown as { data: { id: string } | null };

    if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });

    // Null out category_id on all agents in this category before deleting
    await (supabase.from("agent_config") as unknown as {
      update: (v: unknown) => { eq: (col: string, val: string) => Promise<unknown> };
    }).update({ category_id: null }).eq("category_id", id);

    const { error: deleteError } = (await (supabase.from("agent_categories") as unknown as {
      delete: () => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
    }).delete().eq("id", id)) as unknown as { error: { message: string } | null };

    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
