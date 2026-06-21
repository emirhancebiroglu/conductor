/**
 * Live smoke test: dispatches real claude and real opencode agents, each
 * forced to use a specific tool (tavily, context7, github MCP servers, plus
 * edit/shell), and proves each tool actually fired by inspecting debug output
 * and observable side effects (e.g. a file written to disk).
 *
 * This does NOT touch Supabase or any pipeline state — it spawns the CLIs
 * directly against a scratch git worktree.
 *
 * Usage: apps\cm-worker\node_modules\.bin\tsx.CMD scripts/verify-cm-agent-tools.ts
 * Requires: TAVILY_API_KEY, GITHUB_TOKEN_WORK in env; `claude` + `opencode` on PATH.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, accessSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Mirrors packages/cm-adapters/src/claude-runner.ts opencodeArgs() — child_process.spawn
// with shell:false does not do PATH/PATHEXT resolution, so a bare "opencode" string
// fails with ENOENT on Windows even though it resolves fine in an interactive shell.
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

function loadEnv(filePath: string) {
  try {
    const lines = readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* file not found — skip */ }
}
loadEnv(join(root, "apps/dashboard/.env.local"));
loadEnv(join(root, "apps/cm-worker/.env.local"));

type ToolCase = {
  name: string;
  claudeAllowedTool: string;
  opencodeAgent: string; // which cm-* agent in opencode.json has this tool allowed
  prompt: string;
  evidenceRegexes: RegExp[];
};

const TOOL_CASES: ToolCase[] = [
  {
    name: "tavily",
    claudeAllowedTool: "mcp__tavily__tavily_search",
    opencodeAgent: "cm-sca-agent",
    prompt:
      'Use the tavily_search tool right now to search for the exact string "Conductor CM tool verification probe". ' +
      "Then reply with exactly one line: TOOL_CALLED: yes",
    evidenceRegexes: [/tavily_search/i, /TOOL_CALLED:\s*yes/i],
  },
  {
    name: "context7",
    claudeAllowedTool: "mcp__context7__resolve-library-id",
    opencodeAgent: "cm-sast-agent",
    prompt:
      "Use the context7 resolve-library-id tool right now to resolve the library id for \"react\". " +
      "Then reply with exactly one line: TOOL_CALLED: yes",
    evidenceRegexes: [/resolve-library-id|context7_resolve/i, /TOOL_CALLED:\s*yes/i],
  },
  {
    name: "github",
    claudeAllowedTool: "mcp__github__search_repositories",
    opencodeAgent: "cm-fix-planner",
    prompt:
      'Use the github search_repositories tool right now to search for repos matching "conductor-test-probe". ' +
      "Then reply with exactly one line: TOOL_CALLED: yes",
    evidenceRegexes: [/search_repositories|github_search/i, /TOOL_CALLED:\s*yes/i],
  },
];

const EDIT_CASE = {
  name: "edit",
  opencodeAgent: "cm-sast-agent",
  prompt:
    'Use your edit/write tool right now to create a file named "tool-verify-probe.txt" containing exactly the text PROBE_OK. ' +
    "Then reply with exactly one line: TOOL_CALLED: yes",
};

const SHELL_CASE = {
  name: "shell",
  opencodeAgent: "cm-sast-agent",
  prompt:
    'Use your shell/bash tool right now to run a command that writes the text SHELL_PROBE_OK into a file named "shell-verify-probe.txt". ' +
    "Then reply with exactly one line: TOOL_CALLED: yes",
};

const SYSTEM_PROMPT =
  "You are a tool-use smoke test agent. You MUST call the requested tool before answering. Never answer from memory or skip the tool call.";

async function setupScratchRepo(label: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), `cm-tool-verify-${label}-`));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "scratch repo for tool verification\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

type RunResult = { provider: string; tool: string; toolEvidence: boolean; rawTail: string };

function spawnCollect(bin: string, args: string[], cwd: string, prompt: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: env ?? process.env, shell: false });
    let out = "";
    let err = "";
    if (child.stdin) {
      child.stdin.write(prompt, "utf8");
      child.stdin.end();
    }
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(out + "\n[stderr]\n" + err + "\n[TIMEOUT]"); }, 5 * 60 * 1000);
    child.on("close", () => { clearTimeout(timer); resolve(out + "\n[stderr]\n" + err); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function runClaudeTool(tc: ToolCase): Promise<RunResult> {
  const workingDir = await setupScratchRepo(`claude-${tc.name}`);
  const debugLog = join(workingDir, "..", `claude-debug-${tc.name}.log`);
  const fullPrompt = SYSTEM_PROMPT + "\n\n---\n\n" + tc.prompt;
  const args = [
    "--dangerously-skip-permissions",
    "--print",
    fullPrompt,
    "--model", "claude-sonnet-4-6",
    "--effort", "medium",
    "--allowedTools", tc.claudeAllowedTool,
    "--debug", "mcp",
    "--debug-file", debugLog,
  ];
  const output = await spawnCollect("claude", args, workingDir, "");

  let debugContent = "";
  try { debugContent = readFileSync(debugLog, "utf-8"); } catch { /* none */ }

  const combined = output + "\n" + debugContent;
  const toolEvidence = tc.evidenceRegexes.every((re) => re.test(combined)) || tc.evidenceRegexes.some((re) => re.test(debugContent));
  return { provider: "claude", tool: tc.name, toolEvidence, rawTail: output.slice(-500) };
}

async function runOpencodeTool(tc: ToolCase, opencodeConfigPath: string): Promise<RunResult> {
  const workingDir = await setupScratchRepo(`opencode-${tc.name}`);
  const oc = opencodeArgs();
  const args = [
    ...oc.prefix,
    "run",
    "--dangerously-skip-permissions",
    "-m", "opencode-go/deepseek-v4-flash",
    "--variant", "max",
    "--agent", tc.opencodeAgent,
    "--dir", workingDir,
    "--log-level", "DEBUG",
    "--print-logs",
  ];
  const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_CONFIG: opencodeConfigPath };
  const output = await spawnCollect(oc.bin, args, workingDir, SYSTEM_PROMPT + "\n\n---\n\n" + tc.prompt, env);
  const toolEvidence = tc.evidenceRegexes.every((re) => re.test(output));
  return { provider: "opencode", tool: tc.name, toolEvidence, rawTail: output.slice(-500) };
}

async function runClaudeEdit(): Promise<RunResult> {
  const workingDir = await setupScratchRepo("claude-edit");
  const editPrompt = SYSTEM_PROMPT + "\n\n---\n\n" + EDIT_CASE.prompt;
  const args = [
    "--dangerously-skip-permissions",
    "--print",
    editPrompt,
    "--model", "claude-sonnet-4-6",
    "--effort", "medium",
    "--allowedTools", "Edit,Write,Read",
  ];
  const output = await spawnCollect("claude", args, workingDir, "");
  const filePath = join(workingDir, "tool-verify-probe.txt");
  const fileExists = existsSync(filePath);
  const fileOk = fileExists && readFileSync(filePath, "utf-8").includes("PROBE_OK");
  return { provider: "claude", tool: "edit", toolEvidence: fileOk, rawTail: output.slice(-300) + `\n[file exists: ${fileExists}, content ok: ${fileOk}]` };
}

async function runOpencodeEdit(opencodeConfigPath: string): Promise<RunResult> {
  const workingDir = await setupScratchRepo("opencode-edit");
  const oc = opencodeArgs();
  const args = [...oc.prefix, "run", "--dangerously-skip-permissions", "-m", "opencode-go/deepseek-v4-flash", "--variant", "max", "--agent", EDIT_CASE.opencodeAgent, "--dir", workingDir];
  const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_CONFIG: opencodeConfigPath };
  const output = await spawnCollect(oc.bin, args, workingDir, SYSTEM_PROMPT + "\n\n---\n\n" + EDIT_CASE.prompt, env);
  const filePath = join(workingDir, "tool-verify-probe.txt");
  const fileExists = existsSync(filePath);
  const fileOk = fileExists && readFileSync(filePath, "utf-8").includes("PROBE_OK");
  return { provider: "opencode", tool: "edit", toolEvidence: fileOk, rawTail: output.slice(-300) + `\n[file exists: ${fileExists}, content ok: ${fileOk}]` };
}

async function runClaudeShell(): Promise<RunResult> {
  const workingDir = await setupScratchRepo("claude-shell");
  const shellPrompt = SYSTEM_PROMPT + "\n\n---\n\n" + SHELL_CASE.prompt;
  const args = ["--dangerously-skip-permissions", "--print", shellPrompt, "--model", "claude-sonnet-4-6", "--effort", "medium", "--allowedTools", "Bash"];
  const output = await spawnCollect("claude", args, workingDir, "");
  const filePath = join(workingDir, "shell-verify-probe.txt");
  const fileExists = existsSync(filePath);
  const fileOk = fileExists && readFileSync(filePath, "utf-8").includes("SHELL_PROBE_OK");
  return { provider: "claude", tool: "shell", toolEvidence: fileOk, rawTail: output.slice(-300) + `\n[file exists: ${fileExists}, content ok: ${fileOk}]` };
}

async function runOpencodeShell(opencodeConfigPath: string): Promise<RunResult> {
  const workingDir = await setupScratchRepo("opencode-shell");
  const oc = opencodeArgs();
  const args = [...oc.prefix, "run", "--dangerously-skip-permissions", "-m", "opencode-go/deepseek-v4-flash", "--variant", "max", "--agent", SHELL_CASE.opencodeAgent, "--dir", workingDir];
  const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_CONFIG: opencodeConfigPath };
  const output = await spawnCollect(oc.bin, args, workingDir, SYSTEM_PROMPT + "\n\n---\n\n" + SHELL_CASE.prompt, env);
  const filePath = join(workingDir, "shell-verify-probe.txt");
  const fileExists = existsSync(filePath);
  const fileOk = fileExists && readFileSync(filePath, "utf-8").includes("SHELL_PROBE_OK");
  return { provider: "opencode", tool: "shell", toolEvidence: fileOk, rawTail: output.slice(-300) + `\n[file exists: ${fileExists}, content ok: ${fileOk}]` };
}

async function main() {
  const missing: string[] = [];
  if (!process.env.TAVILY_API_KEY) missing.push("TAVILY_API_KEY");
  if (!process.env.GITHUB_TOKEN_WORK) missing.push("GITHUB_TOKEN_WORK");
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")} — cannot fully verify tool calls.`);
  }

  const opencodeConfigPath = join(root, "apps/cm-worker/opencode.json");
  console.log(`Opencode config: ${opencodeConfigPath}\n`);

  const results: RunResult[] = [];

  for (const tc of TOOL_CASES) {
    console.log(`=== ${tc.name.toUpperCase()} — claude ===`);
    try {
      const r = await runClaudeTool(tc);
      results.push(r);
      console.log(`  toolEvidence=${r.toolEvidence}`);
    } catch (e) {
      console.error(`  ERROR: ${e}`);
      results.push({ provider: "claude", tool: tc.name, toolEvidence: false, rawTail: String(e) });
    }

    console.log(`=== ${tc.name.toUpperCase()} — opencode ===`);
    try {
      const r = await runOpencodeTool(tc, opencodeConfigPath);
      results.push(r);
      console.log(`  toolEvidence=${r.toolEvidence}`);
    } catch (e) {
      console.error(`  ERROR: ${e}`);
      results.push({ provider: "opencode", tool: tc.name, toolEvidence: false, rawTail: String(e) });
    }
  }

  console.log("=== EDIT — claude ===");
  try { const r = await runClaudeEdit(); results.push(r); console.log(`  toolEvidence=${r.toolEvidence}`); }
  catch (e) { console.error(`  ERROR: ${e}`); results.push({ provider: "claude", tool: "edit", toolEvidence: false, rawTail: String(e) }); }

  console.log("=== EDIT — opencode ===");
  try { const r = await runOpencodeEdit(opencodeConfigPath); results.push(r); console.log(`  toolEvidence=${r.toolEvidence}`); }
  catch (e) { console.error(`  ERROR: ${e}`); results.push({ provider: "opencode", tool: "edit", toolEvidence: false, rawTail: String(e) }); }

  console.log("=== SHELL — claude ===");
  try { const r = await runClaudeShell(); results.push(r); console.log(`  toolEvidence=${r.toolEvidence}`); }
  catch (e) { console.error(`  ERROR: ${e}`); results.push({ provider: "claude", tool: "shell", toolEvidence: false, rawTail: String(e) }); }

  console.log("=== SHELL — opencode ===");
  try { const r = await runOpencodeShell(opencodeConfigPath); results.push(r); console.log(`  toolEvidence=${r.toolEvidence}`); }
  catch (e) { console.error(`  ERROR: ${e}`); results.push({ provider: "opencode", tool: "shell", toolEvidence: false, rawTail: String(e) }); }

  console.log("\n=== SUMMARY ===");
  console.log("tool       provider    fired");
  for (const r of results) {
    console.log(`${r.tool.padEnd(10)} ${r.provider.padEnd(10)}  ${r.toolEvidence ? "YES" : "NO"}`);
  }

  const failed = results.filter((r) => !r.toolEvidence);
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length} case(s) did not demonstrate a real tool call.`);
    for (const f of failed) {
      console.error(`\n--- ${f.tool}/${f.provider} tail ---\n${f.rawTail}`);
    }
    process.exit(1);
  }
  console.log("\nPASS: all tool cases demonstrated real tool calls for both providers.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
