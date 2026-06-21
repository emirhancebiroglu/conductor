export type AgentRunnerTask = {
  description: string;
  workingDir: string;
  contextFiles?: Array<{ path: string; label: string }>;
};

export type AgentRunnerResult = {
  summary: string;
  changed: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

export interface AgentRunner {
  run(
    agentConfig: {
      agentName: string;
      provider: string;
      model: string;
      systemPrompt: string;
      allowedTools: string[];
    },
    task: AgentRunnerTask,
  ): Promise<AgentRunnerResult>;
}
