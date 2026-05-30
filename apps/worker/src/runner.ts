import { spawn } from "node:child_process";

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export type RunResult =
  | { success: true; output: string }
  | { success: false; error: string };

export type RunOptions = {
  repoDir: string;
  prompt: string;
  jobId: string;
  /** Called for each stdout/stderr line as it arrives */
  onLine?: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
};

function claudeBin(): string {
  return process.env["CLAUDE_PATH"] ?? "claude";
}

function emitLine(
  onLine: RunOptions["onLine"],
  raw: string,
  stream: "stdout" | "stderr",
): void {
  if (onLine) void Promise.resolve(onLine(raw, stream));
}

export async function runClaudeAgent(options: RunOptions): Promise<RunResult> {
  const { repoDir, prompt } = options;

  return new Promise((resolve) => {
    const child = spawn(claudeBin(), ["--print", prompt], {
      cwd: repoDir,
      env: process.env,
      shell: false,
    });

    let stdoutBuf = "";   // partial line buffer
    let stderrBuf = "";   // partial line buffer
    let stdoutFull = "";  // full accumulated stdout
    let stderrFull = "";  // full accumulated stderr
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ success: false, error: `claude agent timed out after ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutFull += chunk;
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) emitLine(options.onLine, line, "stdout");
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrFull += chunk;
      stderrBuf += chunk;
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) emitLine(options.onLine, line, "stderr");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      // flush any remaining partial lines
      if (stdoutBuf) emitLine(options.onLine, stdoutBuf, "stdout");
      if (stderrBuf) emitLine(options.onLine, stderrBuf, "stderr");

      if (code === 0) {
        resolve({ success: true, output: stdoutFull });
      } else {
        resolve({
          success: false,
          error: stderrFull || `claude exited with code ${code}`,
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ success: false, error: err.message });
    });
  });
}
