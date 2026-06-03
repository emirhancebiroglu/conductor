import { NextResponse } from "next/server";
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

    const scan = await supabase
      .from("cm_scan")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single() as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

    if (!scan.data || scan.error) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    const findings = await supabase
      .from("cm_finding")
      .select("*")
      .eq("scan_id", id) as unknown as { data: Record<string, unknown>[] | null };

    const runs = await supabase
      .from("runs")
      .select("*")
      .eq("scan_id", id)
      .order("created_at", { ascending: true }) as unknown as { data: Record<string, unknown>[] | null };

    const runIds = (runs.data ?? []).map((r) => r.id).filter(Boolean);

    let usageLog: Record<string, unknown>[] = [];
    if (runIds.length > 0) {
      const ul = await supabase
        .from("usage_log")
        .select("*")
        .in("run_id", runIds) as unknown as { data: Record<string, unknown>[] | null };
      usageLog = ul.data ?? [];
    }

    return NextResponse.json({
      scan: scan.data,
      findings: findings.data ?? [],
      runs: runs.data ?? [],
      usageLog,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
