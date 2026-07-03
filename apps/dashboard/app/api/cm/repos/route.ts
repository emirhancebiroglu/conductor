import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

const CreateRepoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  default_branch: z.string().default("uat"),
  source: z.enum(["auto", "manual"]).default("manual"),
  priority: z.number().int().default(100),
});

const PatchRepoSchema = z.object({
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
  default_branch: z.string().optional(),
});

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 50;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const page = Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? String(PAGE_LIMIT), 10) || PAGE_LIMIT));
  const search = (url.searchParams.get("search") ?? "").trim();
  const from = page * limit;

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    let query = supabase
      .from("cm_repo")
      .select("id, owner, name, default_branch, source, priority, enabled", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: true })
      .range(from, from + limit - 1);

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ repos: data ?? [], total: count ?? 0, page, limit });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

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

  const parsed = CreateRepoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { owner, name, default_branch, source, priority } = parsed.data;

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const pipeline = await supabase
      .from("cm_pipeline")
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle() as unknown as { data: { id: string } | null };

    if (!pipeline.data) {
      return NextResponse.json({ error: "No pipeline configured for this workspace" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("cm_repo")
      .select("id")
      .eq("pipeline_id", pipeline.data.id)
      .eq("owner", owner)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Repo already registered" }, { status: 409 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("cm_repo") as any).insert({
      pipeline_id: pipeline.data.id,
      workspace_id: workspaceId,
      owner,
      name,
      default_branch,
      source,
      priority,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ repo: data }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchRepoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("cm_repo") as any)
      .update(parsed.data)
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const { error } = await supabase
      .from("cm_repo")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
