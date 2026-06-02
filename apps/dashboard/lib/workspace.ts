import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { WorkspaceKind } from "@conductor/core";

export const WORKSPACE_COOKIE = "active_workspace";

const VALID_KINDS = new Set(["work", "personal"]);

function parseKind(raw: string | undefined): WorkspaceKind {
  if (raw && VALID_KINDS.has(raw)) return raw as WorkspaceKind;
  return "personal";
}

export async function getActiveWorkspaceKind(): Promise<WorkspaceKind> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const raw = cookieStore.get(WORKSPACE_COOKIE)?.value;
    return parseKind(raw);
  } catch {
    return "personal";
  }
}

export async function resolveWorkspaceId(
  supabase: SupabaseClient<Database>,
  kind: WorkspaceKind,
): Promise<string> {
  const { data, error } = (await supabase
    .from("workspaces")
    .select("id")
    .eq("kind", kind)
    .maybeSingle()) as unknown as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) {
    const fallback = (await supabase
      .from("workspaces")
      .select("id")
      .eq("kind", "personal")
      .maybeSingle()) as unknown as { data: { id: string } | null; error: { message: string } | null };

    if (fallback.error || !fallback.data) {
      throw new Error("No personal workspace found");
    }
    return fallback.data.id;
  }

  return data.id;
}

export function getWorkspaceCookie(): WorkspaceKind {
  if (typeof document === "undefined") return "personal";
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${WORKSPACE_COOKIE}=([^;]*)`),
  );
  return parseKind(match?.[1]);
}

export function setWorkspaceCookie(kind: WorkspaceKind): void {
  if (typeof document === "undefined") return;
  document.cookie = `${WORKSPACE_COOKIE}=${kind};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}
