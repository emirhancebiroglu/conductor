import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// why: must match apps/cm-worker/src/handlers/fix.ts's RESUME_REQUESTED_MARKER
// exactly — the worker's poll loop looks for this literal value in
// cm_scan.current_step to know a paused (needs_human) fix graph should resume.
const RESUME_REQUESTED_MARKER = "__resume_requested__";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Requests that a paused (needs_human) fix pipeline resume from wherever it
 * was interrupted, instead of restarting the whole scan from scratch. This
 * only flips a marker the cm-worker process picks up on its next poll —
 * the actual resume (LangGraph checkpoint replay) happens worker-side.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const scan = await supabase
      .from("cm_scan")
      .select("id, status")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single() as unknown as { data: { id: string; status: string } | null; error: { message: string } | null };

    if (!scan.data || scan.error) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    if (scan.data.status !== "needs_human") {
      return NextResponse.json(
        { error: `Scan is not paused for review (status=${scan.data.status})` },
        { status: 409 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("cm_scan") as any)
      .update({ current_step: RESUME_REQUESTED_MARKER })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, message: "Resume requested — cm-worker will pick it up shortly" });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
