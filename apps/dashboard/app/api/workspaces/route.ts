import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRow } from "@conductor/core";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name, kind")
      .order("created_at", { ascending: true }) as unknown as {
        data: Pick<WorkspaceRow, "id" | "name" | "kind">[] | null;
        error: { message: string } | null;
      };

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? []);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
