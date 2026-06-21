import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

const CreateScanSchema = z.object({
  repo_id: z.string().uuid().optional(),
  repo_ids: z.array(z.string().uuid()).optional(),
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
      .select("*, cm_repo(owner, name, default_branch)")
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

    const repoIds = parsed.data.repo_ids ?? (parsed.data.repo_id ? [parsed.data.repo_id] : []);

    if (repoIds.length === 0) {
      return NextResponse.json({ error: "repo_id or repo_ids required" }, { status: 400 });
    }

    // Validate all repos exist and belong to the workspace
    const reposResp = await supabase
      .from("cm_repo")
      .select("id, workspace_id, priority")
      .in("id", repoIds) as unknown as { data: Array<{ id: string; workspace_id: string; priority: number }> | null };

    const repos = reposResp.data ?? [];
    if (repos.length !== repoIds.length) {
      return NextResponse.json({ error: "One or more repos not found" }, { status: 404 });
    }

    for (const repo of repos) {
      if (repo.workspace_id !== workspaceId) {
        return NextResponse.json({ error: "Repo belongs to a different workspace" }, { status: 400 });
      }
    }

    // Sort by priority (asc = higher priority first)
    repos.sort((a, b) => a.priority - b.priority);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("cm_scan") as any).insert(
      repos.map((repo) => ({
        repo_id: repo.id,
        workspace_id: workspaceId,
        status: "queued",
        provider: "checkmarx",
        trigger: "manual",
      })),
    ).select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ scans: data ?? [] }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
