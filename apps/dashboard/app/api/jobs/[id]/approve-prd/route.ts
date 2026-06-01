import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, type, status, prd_approved")
    .eq("id", id)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const j = job as { type: string; status: string; prd_approved: boolean | null };

  if (j.type !== "idea") {
    return NextResponse.json({ error: "Job is not an idea job" }, { status: 409 });
  }

  if (j.status !== "prd_ready") {
    return NextResponse.json({ error: "Job PRD is not ready for approval" }, { status: 409 });
  }

  // Set prd_approved=true and re-queue — worker picks it up and routes to scaffold phase
  // why: supabase generated types don't include prd_approved yet — cast until types are regenerated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("jobs") as any)
    .update({ prd_approved: true, status: "queued" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
