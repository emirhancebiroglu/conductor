import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspaceKind, resolveWorkspaceId } from "@/lib/workspace";
import { createOctokit, discoverRepos } from "@conductor/github";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const kind = await getActiveWorkspaceKind();
    const workspaceId = await resolveWorkspaceId(supabase, kind);

    const pipeline = await supabase
      .from("cm_pipeline")
      .select("id, discovery_name_prefix, discovery_config_path")
      .eq("workspace_id", workspaceId)
      .maybeSingle() as unknown as { data: { id: string; discovery_name_prefix: string; discovery_config_path: string } | null };

    if (!pipeline.data) {
      return NextResponse.json({ error: "No pipeline configured" }, { status: 400 });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "GITHUB_TOKEN not configured" }, { status: 500 });
    }

    const octokit = createOctokit(token);

    const repos = await discoverRepos({
      octokit,
      owner: user.user_metadata?.user_name ?? user.email?.split("@")[0] ?? "unknown",
      namePrefix: pipeline.data.discovery_name_prefix,
      configPath: pipeline.data.discovery_config_path,
    });

    let inserted = 0;
    for (const repo of repos) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("cm_repo") as any)
        .upsert({
          pipeline_id: pipeline.data.id,
          workspace_id: workspaceId,
          owner: user.user_metadata?.user_name ?? "unknown",
          name: repo.name,
          default_branch: repo.defaultBranch,
          source: "auto",
          priority: 100,
          enabled: true,
        }, { onConflict: "pipeline_id,owner,name", ignoreDuplicates: false });

      if (!error) inserted++;
    }

    return NextResponse.json({ discovered: repos.length, inserted });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
