import { NextResponse } from "next/server";
import { createOctokit } from "@conductor/github";
import { createClient } from "@/lib/supabase/server";

export interface GithubRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  default_branch: string;
  updated_at: string | null;
  html_url: string;
  private: boolean;
}

export async function GET() {
  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.CONDUCTOR_GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN not configured" }, { status: 500 });
  }

  try {
    const octokit = createOctokit(token);
    // Fetch all repos accessible to the PAT (up to 100, sorted by push date)
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: "pushed",
      direction: "desc",
    });

    const repos: GithubRepo[] = data.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      owner: r.owner.login,
      name: r.name,
      description: r.description ?? null,
      default_branch: r.default_branch,
      updated_at: r.updated_at ?? null,
      html_url: r.html_url,
      private: r.private,
    }));

    return NextResponse.json({ repos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub API error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
