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
      .select("id, github_owner, github_token_env, discovery_name_prefix, discovery_config_path, branch_exclude_pattern")
      .eq("workspace_id", workspaceId)
      .maybeSingle() as unknown as {
        data: {
          id: string;
          github_owner: string;
          github_token_env: string;
          discovery_name_prefix: string;
          discovery_config_path: string;
          branch_exclude_pattern: string;
        } | null;
      };

    if (!pipeline.data) {
      return NextResponse.json({ error: "No pipeline configured" }, { status: 400 });
    }

    const { github_owner, github_token_env, discovery_name_prefix, discovery_config_path, branch_exclude_pattern } = pipeline.data;

    if (!github_owner) {
      return NextResponse.json({ error: "GitHub owner not configured in pipeline settings" }, { status: 400 });
    }

    const token = process.env[github_token_env];
    if (!token) {
      return NextResponse.json({ error: `Env var ${github_token_env} not set` }, { status: 500 });
    }

    const octokit = createOctokit(token);

    const repos = await discoverRepos({
      octokit,
      owner: github_owner,
      namePrefix: discovery_name_prefix,
      configPath: discovery_config_path,
      branchExcludePattern: branch_exclude_pattern,
    });

    let inserted = 0;
    for (const repo of repos) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("cm_repo") as any)
        .upsert({
          pipeline_id: pipeline.data.id,
          workspace_id: workspaceId,
          owner: github_owner,
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
