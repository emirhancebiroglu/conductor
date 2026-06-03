import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";

const PatchPipelineSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  cron: z.string().optional(),
  discovery_name_prefix: z.string().optional(),
  discovery_config_path: z.string().optional(),
  severity_threshold: z.array(z.string()).optional(),
  sca_test_policy: z.enum(["skip-minor", "test-all"]).optional(),
  fix_branch: z.string().optional(),
  report_dir: z.string().optional(),
  retry_cooldown_seconds: z.number().int().positive().optional(),
  max_fix_attempts: z.number().int().positive().optional(),
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
      .from("cm_pipeline")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? null);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchPipelineSchema.safeParse(body);
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
    const existing = await (supabase.from("cm_pipeline") as any)
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle() as { data: { id: string } | null };

    if (!existing.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("cm_pipeline") as any)
        .insert({ workspace_id: workspaceId, ...parsed.data })
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ pipeline: data }, { status: 201 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("cm_pipeline") as any)
      .update(parsed.data)
      .eq("id", existing.data.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
