import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DIFF_MAX_CHARS = 10_000;

export async function getGitDiff(repoDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--", "."], { cwd: repoDir });
    const trimmed = stdout.slice(0, DIFF_MAX_CHARS);
    if (stdout.length > DIFF_MAX_CHARS) {
      return trimmed + `\n\n[diff truncated — original ${stdout.length} chars, showing first ${DIFF_MAX_CHARS}]`;
    }
    return trimmed;
  } catch {
    return "";
  }
}
