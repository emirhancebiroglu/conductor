import { spawn } from "node:child_process";
import { accessSync } from "node:fs";
import type { ZodType } from "zod";
import { logUsage } from "./usage.js";

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
  return process.env["CLAUDE_PATH"] ?? "claude";
}

// On Windows, `opencode` is a .ps1 shim — not directly spawnable with shell:false.
// Resolve to: node <opencode-js-entry> so spawn works cross-platform.
function opencodeArgs(): { bin: string; prefix: string[] } {
  const envPath = process.env["OPENCODE_PATH"];
  if (envPath) return { bin: envPath, prefix: [] };

  // Try to find the JS entrypoint next to the node binary
  const nodeBin = process.execPath; // e.g. C:\nvm4w\nodejs\node.exe
  const nodeDir = nodeBin.replace(/[/\\][^/\\]+$/, ""); // parent dir
  const jsEntry = `${nodeDir}/node_modules/opencode-ai/bin/opencode`;

  // Check if it exists; fall back to bare "opencode" (works on Linux/macOS)
  try {
    accessSync(jsEntry);
    return { bin: nodeBin, prefix: [jsEntry] };
  } catch {
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
      "--variant", "max",
    ];
  }

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: repoDir,
      env: process.env,
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
        resolve({ success: false, error: stderrFull || `agent exited with code ${code}` });
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
): Promise<void> {
  const { error } = await supabase.from("runs").insert({
    job_id: jobId,
    agent: agentName,
    lane,
    model: model ?? modelLabel(lane),
    status,
    input: status === "started" ? payload : null,
    output: status !== "started" ? payload : null,
    iteration,
  });
  if (error) {
    // non-fatal
    console.error(`[runner] logRun failed: ${(error as { message: string }).message}`);
  }
}

// ---------------------------------------------------------------------------
// JSON suffix injected into every prompt
// ---------------------------------------------------------------------------

const JSON_SUFFIX =
  "\n\nÖNEMLİ: Sadece geçerli JSON döndür. Markdown yok, açıklama yok. Başka hiçbir metin ekleme.";

function extractJson(raw: string): string {
  // Strip markdown code fences if agent wrapped JSON in ```json ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  // Find first { or [ and return from there
  const start = raw.search(/[{[]/);
  if (start !== -1) return raw.slice(start).trim();
  return raw.trim();
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
};

/**
 * Run an agent and parse its stdout as JSON matching `schema`.
 * Retries once on parse failure before throwing.
 */
export async function runAgentForJSON<T>(
  options: AgentRunOptions & { schema: ZodType<T> },
): Promise<T> {
  const { repoDir, systemPrompt, userPrompt, jobId, agentName, lane, model, schema, supabase, onLine } =
    options;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}${JSON_SUFFIX}`;

  if (supabase) {
    await logRun(supabase, jobId, agentName, lane, "started", { prompt: userPrompt }, 1, model);
  }

  let lastParseError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? fullPrompt
        : `${fullPrompt}\n\nGeçersiz JSON üretildi, tekrar dene. Hata: ${lastParseError}`;

    if (attempt === 2 && supabase) {
      await logRun(supabase, jobId, agentName, lane, "retry", { attempt, error: lastParseError }, attempt, model);
    }

    const result = await spawnAgent(lane, prompt, repoDir, onLine, model);

    if (!result.success) {
      if (supabase) {
        await logRun(supabase, jobId, agentName, lane, "failed", { error: result.error }, attempt, model);
      }
      throw new Error(`[${agentName}] agent failed: ${result.error}`);
    }

    await logUsage(jobId, prompt, result.output, lane, model ?? modelLabel(lane));

    const raw = extractJson(result.output);

    try {
      const parsed = JSON.parse(raw) as unknown;
      const validated = schema.parse(parsed);
      if (supabase) {
        await logRun(supabase, jobId, agentName, lane, "ok", { output: validated as Record<string, unknown> }, attempt, model);
      }
      return validated;
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : String(err);
      console.warn(`[runner] ${agentName} attempt ${attempt} parse failed: ${lastParseError}`);
    }
  }

  if (supabase) {
    await logRun(supabase, jobId, agentName, lane, "failed", { error: lastParseError }, 2, model);
  }
  throw new Error(`[${agentName}] JSON parse failed after 2 attempts: ${lastParseError}`);
}

/**
 * Run an agent and return its raw stdout as a string (no JSON parsing).
 * Used for BE/FE implementation agents that produce code diffs, not JSON.
 */
export async function runAgentFreeText(options: AgentRunOptions): Promise<string> {
  const { repoDir, systemPrompt, userPrompt, jobId, agentName, lane, model, supabase, onLine } = options;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  if (supabase) {
    await logRun(supabase, jobId, agentName, lane, "started", { prompt: userPrompt }, 1, model);
  }

  const result = await spawnAgent(lane, fullPrompt, repoDir, onLine, model);

  if (!result.success) {
    if (supabase) {
      await logRun(supabase, jobId, agentName, lane, "failed", { error: result.error }, 1, model);
    }
    throw new Error(`[${agentName}] agent failed: ${result.error}`);
  }

  await logUsage(jobId, fullPrompt, result.output, lane, model ?? modelLabel(lane));

  if (supabase) {
    await logRun(supabase, jobId, agentName, lane, "ok", { length: result.output.length }, 1, model);
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
