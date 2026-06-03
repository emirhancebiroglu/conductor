import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

const CreateScanSchema = z.object({
  repo_id: z.string().uuid(),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const { data, error } = await supabase
      .from("cm_scan")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? []);
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

  const parsed = CreateScanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const repo = await supabase
      .from("cm_repo")
      .select("id, workspace_id")
      .eq("id", parsed.data.repo_id)
      .single() as unknown as { data: { id: string; workspace_id: string } | null; error: { message: string } | null };

    if (!repo.data || repo.error) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    if (repo.data.workspace_id !== workspaceId) {
      return NextResponse.json({ error: "Repo belongs to a different workspace" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("cm_scan") as any).insert({
      repo_id: parsed.data.repo_id,
      workspace_id: workspaceId,
      status: "queued",
      provider: "checkmarx",
      trigger: "manual",
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ scan: data }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
