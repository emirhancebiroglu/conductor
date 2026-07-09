import { describe, it, expect, vi } from "vitest";
import { resolveCloneBranch } from "../pipeline/branch-resolution.js";
import type { GitOps } from "@conductor/cm-adapters";

describe("resolveCloneBranch", () => {
  it("returns the fix branch when it already exists remotely", async () => {
    const cloneToTemp = vi.fn().mockResolvedValue("/tmp/existing-fix-branch");
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const ops = { cloneToTemp, cleanup } as unknown as GitOps;

    const result = await resolveCloneBranch(ops, "https://github.com/o/r.git", "checkmarx-auto", "uat");

    expect(result).toEqual({ cloneBranch: "checkmarx-auto", isExistingFixBranch: true });
    expect(cloneToTemp).toHaveBeenCalledWith("https://github.com/o/r.git", "checkmarx-auto");
    expect(cleanup).toHaveBeenCalledWith("/tmp/existing-fix-branch");
  });

  it("falls back to the fallback branch when the fix branch doesn't exist remotely", async () => {
    const ops = {
      cloneToTemp: vi.fn().mockRejectedValue(new Error("branch not found")),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitOps;

    const result = await resolveCloneBranch(ops, "https://github.com/o/r.git", "checkmarx-auto", "uat");

    expect(result).toEqual({ cloneBranch: "uat", isExistingFixBranch: false });
  });
});
