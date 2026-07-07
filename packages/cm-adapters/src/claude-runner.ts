import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentRunner, AgentRunnerTask, AgentRunnerResult } from "./agent-runner.js";

// why: every agent (planner, sca, sast, verifier) can legitimately need this
// long — triaging/fixing 50+ findings with tavily/context7 research and
// mvn dependency:tree/build verification per finding takes real wall-clock
// time. A shorter budget was killing agents mid-task (confirmed in production:
// cm-sca-agent killed at 600s while still validating dependency versions),
// and the kill was then misread downstream as a completed, unverified "fixed".
const AGENT_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

function timeoutForAgent(_agentName: string): number {
  return AGENT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Tool-token → allowedTools string expansion
// ---------------------------------------------------------------------------

const TOOL_MAP: Record<string, string[]> = {
  tavily: [
    "mcp__tavily__tavily_search",
    "mcp__tavily__tavily_extract",
    "mcp__tavily__tavily_crawl",
    "mcp__tavily__tavily_map",
    "mcp__tavily__tavily_research",
  ],
  context7: [
    "mcp__context7__resolve-library-id",
    "mcp__context7__get-library-docs",
  ],
  github: ["mcp__github__search_repositories", "mcp__github__get_file_contents", "mcp__github__search_code"],
  edit: ["Edit", "Write", "Read"],
  shell: ["Bash"],
};

// agent_config.model stores claude-CLI-style ids (e.g. "claude-sonnet-4-6", "claude-opus-4-8")
// regardless of provider — opencode needs a provider-prefixed, dot-separated id
// (e.g. "github-copilot/claude-sonnet-4.6"). Translate when dispatching via opencode.
const OPENCODE_MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-6": "github-copilot/claude-sonnet-4.6",
  "claude-opus-4-8": "github-copilot/claude-opus-4.8",
  "claude-haiku-4-5": "github-copilot/claude-haiku-4.5",
};

function resolveOpencodeModel(model: string): string {
  return OPENCODE_MODEL_MAP[model] ?? model;
}

function buildAllowedTools(tokens: string[]): string[] {
  const tools: string[] = [];
  for (const token of tokens) {
    const expanded = TOOL_MAP[token];
    if (expanded) {
      tools.push(...expanded);
    } else {
      tools.push(token);
    }
  }
  return [...new Set(tools)];
}

// ---------------------------------------------------------------------------
// Binary resolution (mirrors apps/worker/src/runner.ts)
// ---------------------------------------------------------------------------

function claudeBin(): string {
  return process.env["CLAUDE_PATH"] ?? "claude";
}

function opencodeArgs(): { bin: string; prefix: string[] } {
  const envPath = process.env["OPENCODE_PATH"];
  if (envPath) return { bin: envPath, prefix: [] };

  const nodeBin = process.execPath;
  const nodeDir = dirname(nodeBin);
  const jsEntry = `${nodeDir}/node_modules/opencode-ai/bin/opencode`;

  try {
    accessSync(jsEntry);
    return { bin: nodeBin, prefix: [jsEntry] };
  } catch {
    if (process.platform === "win32") {
      const cmdShim = `${nodeDir}/opencode.cmd`;
      try {
        accessSync(cmdShim);
        return { bin: String.raw`C:\Windows\System32\cmd.exe`, prefix: ["/c", cmdShim] };
      } catch { /* noop */ }
      return { bin: String.raw`C:\Windows\System32\cmd.exe`, prefix: ["/c", "opencode"] };
    }
    return { bin: "opencode", prefix: [] };
  }
}

// ---------------------------------------------------------------------------
// Spawn helper
// ---------------------------------------------------------------------------

type SpawnAgentOptions = {
  provider: string;
  model: string;
  allowedToolTokens: string[];
  prompt: string;
  workingDir: string;
  agentName: string;
  opencodeConfigPath: string | undefined;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
};

function spawnAgent(opts: SpawnAgentOptions): Promise<{ output: string; success: boolean }> {
  const { provider, model, allowedToolTokens, prompt, workingDir, agentName, opencodeConfigPath, onLine } = opts;
  let bin: string;
  let args: string[];

  const expandedTools = buildAllowedTools(allowedToolTokens);
  const hasTools = expandedTools.length > 0;

  if (provider === "claude") {
    bin = claudeBin();
    args = [
      "--dangerously-skip-permissions",
      "--print",
      "--model", model,
      "--effort", "medium",
    ];
    if (hasTools) {
      args.push("--allowedTools", expandedTools.join(","));
    }
  } else {
    // opencode — per-agent tool restriction comes from the "agent" block in
    // opencode.json (matched by agentName), not from a CLI flag.
    const oc = opencodeArgs();
    bin = oc.bin;
    args = [
      ...oc.prefix,
      "run",
      "--dangerously-skip-permissions",
      "-m", resolveOpencodeModel(model),
      "--variant", "max",
      "--agent", agentName,
      // Without --dir, opencode resolves edits/shell relative to OPENCODE_CONFIG's
      // directory (the conductor monorepo) instead of the spawned cwd — confirmed
      // via a live probe write landing in the wrong repo. --dir pins it correctly.
      "--dir", workingDir,
    ];
    // no --pure when tools are requested (MCP plugins stay active)
  }

  return new Promise((resolve) => {
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
    if (process.platform === "win32") {
      const username = process.env["USERNAME"] ?? "";
      const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? `C:\\Users\\${username}`;
      spawnEnv["USERPROFILE"] = spawnEnv["USERPROFILE"] ?? home;
      spawnEnv["HOME"] = spawnEnv["HOME"] ?? home;
      spawnEnv["APPDATA"] = spawnEnv["APPDATA"] ?? home + String.raw`\AppData\Roaming`;
      spawnEnv["LOCALAPPDATA"] = spawnEnv["LOCALAPPDATA"] ?? home + String.raw`\AppData\Local`;
    }
    if (provider === "opencode" && opencodeConfigPath) {
      // task.workingDir is an arbitrary scanned repo's worktree — opencode's own
      // cwd-walk-up won't find our agent permission config there.
      spawnEnv["OPENCODE_CONFIG"] = opencodeConfigPath;
    }

    const child: ChildProcessWithoutNullStreams = spawn(bin, args, { cwd: workingDir, env: spawnEnv, shell: false });
    child.stdin.write(prompt, "utf8");
    child.stdin.end();

    let stdoutFull = "";
    let stderrFull = "";
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (stdoutBuf) onLine?.(stdoutBuf, "stdout");
      if (stderrBuf) onLine?.(stderrBuf, "stderr");
      if (exitCode === 0 || stdoutFull.trim().length > 0) {
        resolve({ success: true, output: stdoutFull });
      } else {
        console.warn(`[cm-runner] agent stderr: ${stderrFull.slice(0, 500)}`);
        resolve({ success: false, output: stderrFull.slice(0, 500) || "agent exited non-zero with no output" });
      }
    };

    const timeoutMs = timeoutForAgent(agentName);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      if (stdoutBuf) onLine?.(stdoutBuf, "stdout");
      // why: the agent may have already written its full JSON answer before
      // the wall-clock timeout fired — return whatever stdout was captured
      // instead of discarding it, so the caller can still parse it.
      const partial = stdoutFull.trim();
      resolve({
        success: false,
        output: partial ? `${partial}\n[timeout after ${timeoutMs / 1000}s], process killed` : `[timeout after ${timeoutMs / 1000}s]`,
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutFull += chunk;
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) onLine?.(line, "stdout");
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrFull += chunk;
      stderrBuf += chunk;
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) onLine?.(line, "stderr");
    });

    // stdout "end" fires after all data is flushed — use it together with exitCode
    child.stdout.on("end", () => finish(child.exitCode));
  });
}

// ---------------------------------------------------------------------------
// Token extraction heuristics (Claude --print outputs structured text, not JSON)
// ---------------------------------------------------------------------------

function extractTokens(output: string): { inputTokens: number; outputTokens: number } {
  // Claude --print may emit usage in last line: "Input tokens: 1234, Output tokens: 567"
  const inputMatch = /input[_ ]tokens?[:\s]+(\d+)/i.exec(output);
  const outputMatch = /output[_ ]tokens?[:\s]+(\d+)/i.exec(output);
  return {
    inputTokens: inputMatch ? Number.parseInt(inputMatch[1]!, 10) : 0,
    outputTokens: outputMatch ? Number.parseInt(outputMatch[1]!, 10) : 0,
  };
}

function buildSummary(output: string): string {
  const trimmed = output.trim();
  return trimmed || "(no output)";
}

// ---------------------------------------------------------------------------
// ClaudeRunner
// ---------------------------------------------------------------------------

export class ClaudeRunner implements AgentRunner {
  /**
   * Absolute path to the opencode.json that defines the per-agent `permission`
   * blocks (tool restrictions). Opencode only walks up from cwd to find config,
   * but task.workingDir is an arbitrary scanned repo's worktree — so this must
   * be forwarded explicitly via OPENCODE_CONFIG.
   */
  constructor(private readonly opencodeConfigPath?: string) {}

  async run(
    agentConfig: {
      agentName: string;
      provider: string;
      model: string;
      systemPrompt: string;
      allowedTools: string[];
    },
    task: AgentRunnerTask,
  ): Promise<AgentRunnerResult> {
    const prompt = this.buildPrompt(agentConfig.systemPrompt, task);

    if (agentConfig.provider !== "claude" && agentConfig.provider !== "opencode") {
      throw new Error(`Unsupported agent provider: ${agentConfig.provider}`);
    }

    console.log(`[cm-runner] dispatching ${agentConfig.agentName} (${agentConfig.provider}/${agentConfig.model}) tools=${agentConfig.allowedTools.join(",") || "none"}`);

    const { output, success } = await spawnAgent({
      provider: agentConfig.provider,
      model: agentConfig.model,
      allowedToolTokens: agentConfig.allowedTools,
      prompt,
      workingDir: task.workingDir,
      agentName: agentConfig.agentName,
      opencodeConfigPath: this.opencodeConfigPath,
      onLine: (line, stream) => {
        if (stream === "stderr") return; // don't spam stderr in main logs
        console.log(`[${agentConfig.agentName}] ${line}`);
      },
    });

    if (!success) {
      console.warn(`[cm-runner] ${agentConfig.agentName} returned failure: ${output.slice(0, 200)}`);
    }

    const usage = extractTokens(output);
    const summary = buildSummary(output);

    return {
      summary,
      changed: false, // caller sets this after git diff
      success,
      usage,
    };
  }

  private buildPrompt(systemPrompt: string, task: AgentRunnerTask): string {
    const fileLines = task.contextFiles && task.contextFiles.length > 0
      ? task.contextFiles.map((f) => `  ${f.label}: ${f.path}`).join("\n")
      : null;
    const contextSection = fileLines ? `\n\nContext files (read these first):\n${fileLines}` : "";

    return `${systemPrompt}\n\n---\n\n${task.description}${contextSection}`;
  }
}
