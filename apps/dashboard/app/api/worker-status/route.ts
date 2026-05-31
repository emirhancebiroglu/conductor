import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // why: worker_status is a view/table not in generated types yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("worker_status")
    .select("status, reason, updated_at")
    .limit(1)
    .maybeSingle() as { data: { status: string; reason: string | null; updated_at: string | null } | null };

  return NextResponse.json({
    status: data?.status ?? "online",
    reason: data?.reason ?? null,
    updated_at: data?.updated_at ?? null,
  });
}
