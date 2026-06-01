import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateIdeaSchema = z.object({
  theme: z.string().trim().optional(),
  description: z.string().trim().min(20, "En az 20 karakter gerekli"),
  target_audience: z.string().trim().optional(),
});

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

  const parsed = CreateIdeaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { theme, description, target_audience } = parsed.data;

  // Compose full description from idea + optional target audience
  const fullDescription = target_audience
    ? `${description}\n\nHedef kitle: ${target_audience}`
    : description;

  // Title: first 80 chars of description
  const title = description.slice(0, 80) + (description.length > 80 ? "…" : "");

  // idea jobs don't require a project — project_id nullable per migration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("jobs") as any)
    .insert({
      type: "idea",
      title,
      description: fullDescription,
      lane_preference: "auto",
      status: "queued",
      idea_constraints: theme ? { theme } : null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job: data }, { status: 201 });
}
