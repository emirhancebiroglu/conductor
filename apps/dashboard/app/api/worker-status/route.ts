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

  const { data } = await supabase
    .from("worker_status")
    .select("status, reason, updated_at")
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    status: data?.status ?? "online",
    reason: data?.reason ?? null,
    updated_at: data?.updated_at ?? null,
  });
}
