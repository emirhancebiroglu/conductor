import type { AgentRunner, AgentRunnerTask, AgentRunnerResult } from "./agent-runner.js";

export class StubRunner implements AgentRunner {
  run(
    agentConfig: {
      agentName: string;
      provider: string;
      model: string;
      systemPrompt: string;
      allowedTools: string[];
    },
    task: AgentRunnerTask,
  ): Promise<AgentRunnerResult> {
    return Promise.resolve({
      summary: `StubRunner: ${agentConfig.agentName} handled "${task.description.slice(0, 80)}"`,
      changed: false,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
    });
  }
}
