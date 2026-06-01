import { spawn } from "node:child_process";
import { accessSync } from "node:fs";
import { dirname } from "node:path";
import type { ZodType } from "zod";
import { logUsage } from "./usage.js";
import type { AgentConfig } from "./agentConfig.js";

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Lane = "cheap" | "premium";

export type RunResult =
  | { success: true; output: string }
  | { success: false; error: string };

export type RunOptions = {
  repoDir: string;
  prompt: string;
  jobId: string;
  lane: Lane;
  /** Called for each stdout/stderr line as it arrives */
  onLine?: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
};

// why: supabase any client passed through — same pattern as processJob
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

// ---------------------------------------------------------------------------
// Model/bin resolution
// ---------------------------------------------------------------------------

const PREMIUM_MODEL = "claude-sonnet-4-6";
const CHEAP_MODEL = "opencode-go/deepseek-v4-flash";

function claudeBin(): string {
  const p = process.env["CLAUDE_PATH"] ?? "claude";
  console.log(`[runner] claudeBin: CLAUDE_PATH=${p}`);
  return p;
}

// On Windows, opencode ships as a .cmd/.ps1 shim — not spawnable with shell:false.
// Resolution order:
//   1. OPENCODE_PATH env var (explicit override)
//   2. node <jsEntry>  — works if opencode-ai is in the node global modules
//   3. cmd.exe /c opencode — delegates to PATH resolution via cmd on Windows
//   4. bare "opencode" — works on Linux/macOS where it is a real binary
function opencodeArgs(): { bin: string; prefix: string[] } {
  const envPath = process.env["OPENCODE_PATH"];
  console.log(`[runner] opencodeArgs: OPENCODE_PATH=${envPath ?? "(unset)"}`);
  if (envPath) return { bin: envPath, prefix: [] };

  // Try to find the JS entrypoint next to the node binary
  const nodeBin = process.execPath; // e.g. C:\nvm4w\nodejs\node.exe
  const nodeDir = dirname(nodeBin); // parent dir — dirname handles both / and \ on Windows
  const jsEntry = `${nodeDir}/node_modules/opencode-ai/bin/opencode`;

  try {
    accessSync(jsEntry);
    return { bin: nodeBin, prefix: [jsEntry] };
  } catch {
    if (process.platform === "win32") {
      // On Windows, prefer the .cmd shim which resolves to opencode.exe correctly
      const cmdShim = `${nodeDir}/opencode.cmd`;
      try {
        accessSync(cmdShim);
        // cmd.exe full path required — shell:false means no PATH resolution
        return { bin: "C:\\Windows\\System32\\cmd.exe", prefix: ["/c", cmdShim] };
      } catch { /* noop */ }
      return { bin: "C:\\Windows\\System32\\cmd.exe", prefix: ["/c", "opencode"] };
    }
    return { bin: "opencode", prefix: [] };
  }
}

function modelLabel(lane: Lane): string {
  return lane === "premium" ? PREMIUM_MODEL : CHEAP_MODEL;
}

// ---------------------------------------------------------------------------
// Low-level spawn
// ---------------------------------------------------------------------------

function emitLine(
  onLine: RunOptions["onLine"],
  raw: string,
  stream: "stdout" | "stderr",
): void {
  if (onLine) void Promise.resolve(onLine(raw, stream));
}

function spawnAgent(
  lane: Lane,
  prompt: string,
  repoDir: string,
  onLine?: RunOptions["onLine"],
  model?: string,
): Promise<RunResult> {
  let args: string[];
  let bin: string;

  const resolvedPremiumModel = model ?? PREMIUM_MODEL;
  const resolvedCheapModel = model ?? CHEAP_MODEL;

  if (lane === "premium") {
    bin = claudeBin();
    args = [
      "--dangerously-skip-permissions",
      "--print",
      "--model", resolvedPremiumModel,
      "--effort", "medium",
    ];
  } else {
    const oc = opencodeArgs();
    bin = oc.bin;
    args = [
      ...oc.prefix,
      "run",
      "--dangerously-skip-permissions",
      "-m", resolvedCheapModel,
    ];
  }

  return new Promise((resolve) => {
    // Ensure Windows user profile env vars are present — some spawn contexts (cmd.exe /c pnpm)
    // strip them, breaking Claude Code auth (reads ~/.claude/.credentials.json via HOME)
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
    if (process.platform === "win32") {
      const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? `C:\\Users\\${process.env["USERNAME"] ?? ""}`;
      spawnEnv["USERPROFILE"] = spawnEnv["USERPROFILE"] ?? home;
      spawnEnv["HOME"] = spawnEnv["HOME"] ?? home;
      spawnEnv["APPDATA"] = spawnEnv["APPDATA"] ?? `${home}\\AppData\\Roaming`;
      spawnEnv["LOCALAPPDATA"] = spawnEnv["LOCALAPPDATA"] ?? `${home}\\AppData\\Local`;
    }
    const child = spawn(bin, args, {
      cwd: repoDir,
      env: spawnEnv,
      shell: false,
    });
    // Write prompt to stdin — avoids CLI parsing issues with prompts that
    // start with '--' or other flag-like characters.
    child.stdin.write(prompt, "utf8");
    child.stdin.end();

    let stdoutBuf = "";
    let stderrBuf = "";
    let stdoutFull = "";
    let stderrFull = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ success: false, error: `agent timed out after ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutFull += chunk;
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) emitLine(onLine, line, "stdout");
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrFull += chunk;
      stderrBuf += chunk;
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) emitLine(onLine, line, "stderr");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (stdoutBuf) emitLine(onLine, stdoutBuf, "stdout");
      if (stderrBuf) emitLine(onLine, stderrBuf, "stderr");
      if (code === 0) {
        resolve({ success: true, output: stdoutFull });
      } else {
        if (stderrFull) console.warn(`[runner] agent stderr (${bin}): ${stderrFull.slice(0, 500)}`);
        resolve({ success: false, error: stderrFull || `agent exited with code ${code}` });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      console.warn(`[runner] spawn error (bin=${bin}): ${err.message}`);
      resolve({ success: false, error: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Supabase run logging
// ---------------------------------------------------------------------------

async function logRun(
  supabase: SupabaseAny,
  jobId: string,
  agentName: string,
  lane: Lane,
  status: "started" | "ok" | "retry" | "failed",
  payload: Record<string, unknown>,
  iteration = 1,
  model?: string,
): Promise<string | null> {
  const { data, error } = await supabase.from("runs").insert({
    job_id: jobId,
    agent: agentName,
    lane,
    model: model ?? modelLabel(lane),
    status,
    input: status === "started" ? payload : null,
    output: status !== "started" ? payload : null,
    iteration,
  }).select("id").maybeSingle();
  if (error) {
    // non-fatal
    console.error(`[runner] logRun failed: ${(error as { message: string }).message}`);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// JSON suffix injected into every prompt
// ---------------------------------------------------------------------------

const JSON_SUFFIX =
  "\n\nÖNEMLİ: Sadece geçerli JSON döndür. Markdown yok, açıklama yok. Başka hiçbir metin ekleme. String değerlerde ASLA \\ kullanma, Türkçe karakterleri doğrudan yaz.";

function extractJson(raw: string): string {
  // Strip ANSI escape sequences from terminal output
  // eslint-disable-next-line no-control-regex
  raw = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b./g, "");
  // Strip markdown code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return (fenced[1] ?? "").trim();
  const start = raw.search(/[{[]/);
  if (start !== -1) return raw.slice(start).trim();
  return raw.trim();
}

function sanitizeJson(raw: string): string {
  return raw.replace(/\\(['`])/g, "$1");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AgentRunOptions = {
  repoDir: string;
  systemPrompt: string;
  userPrompt: string;
  jobId: string;
  agentName: string;
  lane: Lane;
  /** Override the model used for this run (from resolveRoute). If omitted, lane default applies. */
  model?: string;
  supabase?: SupabaseAny;
  onLine?: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
  agentConfig?: AgentConfig;
};

/**
 * Run an agent and parse its stdout as JSON matching `schema`.
 * Retries once on parse failure before throwing.
 */
export async function runAgentForJSON<T>(
  options: AgentRunOptions & { schema: ZodType<T> },
): Promise<T> {
  const { repoDir, systemPrompt, userPrompt, jobId, agentName, lane, model, schema, supabase, onLine, agentConfig } =
    options;

  const resolvedSystemPrompt = agentConfig?.systemPrompt ?? systemPrompt;
  const resolvedModel = agentConfig?.model ?? model;
  const resolvedLane = (agentConfig?.laneOverride === "cheap" || agentConfig?.laneOverride === "premium")
    ? agentConfig.laneOverride
    : lane;

  const fullPrompt = `${resolvedSystemPrompt}\n\n${userPrompt}${JSON_SUFFIX}`;

  let startedRunId: string | null = null;
  if (supabase) {
    startedRunId = await logRun(supabase, jobId, agentName, resolvedLane, "started", { prompt: userPrompt }, 1, resolvedModel);
  }

  let lastParseError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? fullPrompt
        : `${fullPrompt}\n\nGeçersiz JSON üretildi, tekrar dene. Hata: ${lastParseError}`;

    if (attempt === 2 && supabase) {
      await logRun(supabase, jobId, agentName, resolvedLane, "retry", { attempt, error: lastParseError }, attempt, resolvedModel);
    }

    const result = await spawnAgent(resolvedLane, prompt, repoDir, onLine, resolvedModel);

    if (!result.success) {
      if (supabase) {
        await logRun(supabase, jobId, agentName, resolvedLane, "failed", { error: result.error }, attempt, resolvedModel);
      }
      throw new Error(`[${agentName}] agent failed: ${result.error}`);
    }

    if (startedRunId) {
      await logUsage(startedRunId, prompt, result.output, resolvedLane, resolvedModel ?? modelLabel(resolvedLane));
    }

    const raw = extractJson(result.output);
    const sanitized = sanitizeJson(raw);
    console.warn(`[runner] ${agentName} raw output (first 400): ${result.output.slice(0, 400)}`);

    try {
      const parsed = JSON.parse(sanitized) as unknown;
      const validated = schema.parse(parsed);
      if (supabase) {
        await logRun(supabase, jobId, agentName, resolvedLane, "ok", { output: validated as Record<string, unknown> }, attempt, resolvedModel);
      }
      return validated;
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : String(err);
      console.warn(`[runner] ${agentName} attempt ${attempt} parse failed: ${lastParseError}`);
    }
  }

  if (supabase) {
    await logRun(supabase, jobId, agentName, resolvedLane, "failed", { error: lastParseError }, 2, resolvedModel);
  }
  throw new Error(`[${agentName}] JSON parse failed after 2 attempts: ${lastParseError}`);
}

/**
 * Run an agent and return its raw stdout as a string (no JSON parsing).
 * Used for BE/FE implementation agents that produce code diffs, not JSON.
 */
export async function runAgentFreeText(options: AgentRunOptions): Promise<string> {
  const { repoDir, systemPrompt, userPrompt, jobId, agentName, lane, model, supabase, onLine, agentConfig } = options;

  const resolvedSystemPrompt = agentConfig?.systemPrompt ?? systemPrompt;
  const resolvedModel = agentConfig?.model ?? model;
  const resolvedLane = (agentConfig?.laneOverride === "cheap" || agentConfig?.laneOverride === "premium")
    ? agentConfig.laneOverride
    : lane;

  const fullPrompt = `${resolvedSystemPrompt}\n\n${userPrompt}`;

  let startedRunId: string | null = null;
  if (supabase) {
    startedRunId = await logRun(supabase, jobId, agentName, resolvedLane, "started", { prompt: userPrompt }, 1, resolvedModel);
  }

  const result = await spawnAgent(resolvedLane, fullPrompt, repoDir, onLine, resolvedModel);

  if (!result.success) {
    if (supabase) {
      await logRun(supabase, jobId, agentName, resolvedLane, "failed", { error: result.error }, 1, resolvedModel);
    }
    throw new Error(`[${agentName}] agent failed: ${result.error}`);
  }

  if (startedRunId) {
    await logUsage(startedRunId, fullPrompt, result.output, resolvedLane, resolvedModel ?? modelLabel(resolvedLane));
  }

  if (supabase) {
    await logRun(supabase, jobId, agentName, resolvedLane, "ok", { length: result.output.length }, 1, resolvedModel);
  }

  return result.output;
}

// ---------------------------------------------------------------------------
// Legacy export — kept for processJob.ts compatibility until pipeline rewrite
// ---------------------------------------------------------------------------

/** @deprecated Use runAgentFreeText instead */
export async function runClaudeAgent(options: {
  repoDir: string;
  prompt: string;
  jobId: string;
  onLine?: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
}): Promise<RunResult> {
  return spawnAgent("premium", options.prompt, options.repoDir, options.onLine);
}
