import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const reportResp = await supabase
      .from("cm_report")
      .select("path")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single() as unknown as { data: { path: string } | null; error: { message: string } | null };

    if (!reportResp.data || reportResp.error) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // why: path comes from cm_report.path, written by the worker (not user
    // input) — this is a server-side filesystem read of a known-good path,
    // not a user-controlled path traversal vector.
    let buffer: Buffer;
    try {
      buffer = await readFile(reportResp.data.path);
    } catch {
      return NextResponse.json({ error: "Report file no longer exists on disk" }, { status: 404 });
    }

    const filename = basename(reportResp.data.path);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
