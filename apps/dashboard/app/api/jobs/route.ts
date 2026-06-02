import { NextRequest, NextResponse } from "next/server";
import { CreateJobSchema } from "@conductor/core";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("workspace_id", workspaceId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? []);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { projectId, type, title, description, lanePreference } = parsed.data;

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    // Verify project exists and check workspace match
    const { data: project } = (await supabase
      .from("projects")
      .select("id, workspace_id")
      .eq("id", projectId)
      .maybeSingle()) as unknown as { data: { id: string; workspace_id: string } | null; error: { message: string } | null };

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.workspace_id !== workspaceId) {
      return NextResponse.json(
        { error: `Project belongs to a different workspace` },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertPayload: any = {
      project_id: projectId,
      type,
      title,
      description,
      lane_preference: lanePreference,
      workspace_id: workspaceId,
      status: "queued",
    };

    const { data, error } = await supabase
      .from("jobs")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ job: data }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
