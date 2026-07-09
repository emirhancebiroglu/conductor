import { describe, it, expect } from "vitest";
import { listRepos, fileExists, discoverRepos } from "../client.js";

function mockOctokit(
  repos: Array<{ name: string; defaultBranch: string; hasConfig: boolean }>,
) {
  return {
    rest: {
      repos: {
        listForOrg: ({ page }: { page: number; per_page: number }) => {
          if (page === 1) {
            return {
              data: repos.map((r) => ({ name: r.name, default_branch: r.defaultBranch })),
            };
          }
          return { data: [] };
        },
        getContent: ({
          owner: _owner,
          repo,
          path: _path,
          ref: _ref,
        }: {
          owner: string;
          repo: string;
          path: string;
          ref: string;
        }) => {
          const found = repos.find((r) => r.name === repo);
          if (found && found.hasConfig) {
            return { data: { type: "file", content: "", sha: "abc123" } };
          }
          throw new Error("Not found");
        },
        listBranches: ({
          repo,
          page,
        }: {
          owner: string;
          repo: string;
          per_page: number;
          page: number;
        }) => {
          if (page === 1) {
            const branch = repos.find((r) => r.name === repo)?.defaultBranch ?? "main";
            return { data: [{ name: branch }] };
          }
          return { data: [] };
        },
      },
    },
  };
}

describe("listRepos", () => {
  it("returns all repos for an org", async () => {
    const octokit = mockOctokit([
      { name: "ms-frontend", defaultBranch: "main", hasConfig: false },
      { name: "ms-backend", defaultBranch: "main", hasConfig: false },
    ]);

    const repos = await listRepos(octokit as never, "test-org");
    expect(repos).toHaveLength(2);
    expect(repos[0]!.name).toBe("ms-frontend");
    expect(repos[1]!.name).toBe("ms-backend");
  });

  it("returns empty array for org with no repos", async () => {
    const octokit = mockOctokit([]);
    const repos = await listRepos(octokit as never, "empty-org");
    expect(repos).toHaveLength(0);
  });
});

describe("fileExists", () => {
  it("returns true when file exists", async () => {
    const octokit = mockOctokit([
      { name: "ms-frontend", defaultBranch: "main", hasConfig: true },
    ]);

    const exists = await fileExists(octokit as never, "test-org", "ms-frontend", ".github/checkmarx_scan.yml");
    expect(exists).toBe(true);
  });

  it("returns false when file does not exist", async () => {
    const octokit = mockOctokit([
      { name: "ms-frontend", defaultBranch: "main", hasConfig: false },
    ]);

    const exists = await fileExists(octokit as never, "test-org", "ms-frontend", ".github/checkmarx_scan.yml");
    expect(exists).toBe(false);
  });
});

describe("discoverRepos", () => {
  it("returns repos matching prefix with config file", async () => {
    const octokit = mockOctokit([
      { name: "ms-frontend", defaultBranch: "main", hasConfig: true },
      { name: "ms-backend", defaultBranch: "main", hasConfig: true },
      { name: "ms-infra", defaultBranch: "main", hasConfig: false },
      { name: "other-app", defaultBranch: "main", hasConfig: true },
    ]);

    const repos = await discoverRepos({
      octokit: octokit as never,
      owner: "test-org",
      namePrefix: "ms",
      configPath: ".github/checkmarx_scan.yml",
    });

    expect(repos).toHaveLength(2);
    expect(repos.map((r) => r.name).sort()).toEqual(["ms-backend", "ms-frontend"]);
  });

  it("excludes repos with wrong prefix", async () => {
    const octokit = mockOctokit([
      { name: "ms-frontend", defaultBranch: "main", hasConfig: true },
      { name: "other-app", defaultBranch: "main", hasConfig: true },
    ]);

    const repos = await discoverRepos({
      octokit: octokit as never,
      owner: "test-org",
    });

    expect(repos).toHaveLength(1);
    expect(repos[0]!.name).toBe("ms-frontend");
  });

  it("excludes repos missing the config file", async () => {
    const octokit = mockOctokit([
      { name: "ms-frontend", defaultBranch: "main", hasConfig: true },
      { name: "ms-infra", defaultBranch: "main", hasConfig: false },
    ]);

    const repos = await discoverRepos({
      octokit: octokit as never,
      owner: "test-org",
    });

    expect(repos).toHaveLength(1);
    expect(repos[0]!.name).toBe("ms-frontend");
  });

  it("honors custom prefix and config path", async () => {
    const octokit = mockOctokit([
      { name: "app-frontend", defaultBranch: "main", hasConfig: true },
      { name: "app-backend", defaultBranch: "main", hasConfig: false },
      { name: "legacy-app", defaultBranch: "main", hasConfig: true },
    ]);

    const repos = await discoverRepos({
      octokit: octokit as never,
      owner: "test-org",
      namePrefix: "app",
      configPath: ".github/custom-scan.yml",
    });

    expect(repos).toHaveLength(1);
    expect(repos[0]!.name).toBe("app-frontend");
  });

  it("returns empty when no repos match", async () => {
    const octokit = mockOctokit([
      { name: "other-app", defaultBranch: "main", hasConfig: true },
    ]);

    const repos = await discoverRepos({
      octokit: octokit as never,
      owner: "test-org",
    });

    expect(repos).toHaveLength(0);
  });
});
