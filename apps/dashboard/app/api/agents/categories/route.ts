import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AgentCategoryRow } from "@conductor/core";
import { z } from "zod";
import { mapCategoryRow } from "../_mappers";

export const dynamic = "force-dynamic";

// ── GET /api/agents/categories ────────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data, error } = (await supabase
      .from("agent_categories")
      .select("*")
      .order("order", { ascending: true })) as unknown as {
      data: AgentCategoryRow[] | null;
      error: { message: string } | null;
    };

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ categories: (data ?? []).map(mapCategoryRow) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const CreateCategoryBodySchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color"),
  description: z.string().nullable().optional(),
  order: z.number().int().default(0),
});

// ── POST /api/agents/categories ───────────────────────────────────────────────
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

  const parsed = CreateCategoryBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    // Check slug uniqueness
    const { data: existing } = (await supabase
      .from("agent_categories")
      .select("id")
      .eq("slug", parsed.data.slug)
      .maybeSingle()) as unknown as { data: { id: string } | null };

    if (existing) {
      return NextResponse.json(
        { error: `Category with slug "${parsed.data.slug}" already exists` },
        { status: 409 }
      );
    }

    const { data: inserted, error: insertError } = (await (supabase.from("agent_categories") as unknown as {
      insert: (v: unknown) => { select: () => { single: () => Promise<{ data: AgentCategoryRow | null; error: { message: string } | null }> } };
    }).insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      color: parsed.data.color,
      description: parsed.data.description ?? null,
      order: parsed.data.order,
    }).select().single()) as unknown as { data: AgentCategoryRow | null; error: { message: string } | null };

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    if (!inserted) return NextResponse.json({ error: "Failed to create category" }, { status: 500 });

    return NextResponse.json({ category: mapCategoryRow(inserted) }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
