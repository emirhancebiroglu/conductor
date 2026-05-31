import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const AnswerBodySchema = z.object({
  answers: z.record(z.string()),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
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

  const parsed = AnswerBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if ((job as { status: string }).status !== "waiting_input") {
    return NextResponse.json({ error: "Job is not waiting for input" }, { status: 409 });
  }

  // why: supabase generated types don't include answers yet — cast until migration runs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("jobs") as any)
    .update({ answers: parsed.data.answers, status: "queued" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
