export {
  createOctokit,
  branchExists,
  createBranch,
  getFileContent,
  commitFile,
  createPR,
  listRepos,
  fileExists,
  discoverRepos,
  listBranches,
  getBranchAheadCount,
  selectBestBranch,
} from "./client.js";
export type { DiscoverReposOptions } from "./client.js";
