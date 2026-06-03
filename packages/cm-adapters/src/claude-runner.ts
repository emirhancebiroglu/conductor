import { execa } from "execa";
import type { AgentRunner, AgentRunnerTask, AgentRunnerResult } from "./agent-runner.js";

type ClaudeCliOutput = {
  edits?: Array<{ file: string; diff: string }>;
  summary?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export class ClaudeRunner implements AgentRunner {
  async run(
    agentConfig: {
      agentName: string;
      provider: string;
      model: string;
      systemPrompt: string;
    },
    task: AgentRunnerTask,
  ): Promise<AgentRunnerResult> {
    const agentId = agentConfig.agentName;

    if (agentConfig.provider === "claude") {
      return this.runClaude(agentConfig, task, agentId);
    }

    if (agentConfig.provider === "opencode") {
      return this.runOpenCode(agentConfig, task, agentId);
    }

    throw new Error(`Unsupported agent provider: ${agentConfig.provider}`);
  }

  private async runClaude(
    agentConfig: { model: string; systemPrompt: string },
    task: AgentRunnerTask,
    agentId: string,
  ): Promise<AgentRunnerResult> {
    const prompt = this.buildPrompt(agentConfig.systemPrompt, task);

    const { stdout } = await execa("claude", [
      "-p",
      prompt,
      "--model",
      agentConfig.model,
      "--output-format",
      "json",
    ], {
      cwd: task.workingDir,
    });

    return this.parseOutput(stdout, agentId);
  }

  private async runOpenCode(
    agentConfig: { model: string; systemPrompt: string },
    task: AgentRunnerTask,
    agentId: string,
  ): Promise<AgentRunnerResult> {
    const prompt = this.buildPrompt(agentConfig.systemPrompt, task);

    const { stdout } = await execa("opencode", [
      "run",
      "--model",
      agentConfig.model,
      prompt,
    ], {
      cwd: task.workingDir,
    });

    return this.parseOutput(stdout, agentId);
  }

  private buildPrompt(systemPrompt: string, task: AgentRunnerTask): string {
    const filesSection = task.files && task.files.length > 0
      ? `\n\nFiles to modify:\n${task.files.map((f) => `  ${f.path}`).join("\n")}`
      : "";

    return `${systemPrompt}\n\nTask: ${task.description}${filesSection}`;
  }

  private parseOutput(stdout: string, _agentId: string): AgentRunnerResult {
    let parsed: ClaudeCliOutput = {};

    try {
      parsed = JSON.parse(stdout) as ClaudeCliOutput;
    } catch {
      return {
        edits: [],
        summary: stdout.slice(0, 500),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    return {
      edits: parsed.edits ?? [],
      summary: parsed.summary ?? "No summary provided",
      usage: {
        inputTokens: parsed.usage?.inputTokens ?? 0,
        outputTokens: parsed.usage?.outputTokens ?? 0,
      },
    };
  }
}
