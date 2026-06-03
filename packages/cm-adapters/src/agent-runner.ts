export type AgentRunnerTask = {
  description: string;
  workingDir: string;
  files?: Array<{ path: string; content: string }>;
};

export type AgentRunnerResult = {
  edits: Array<{ file: string; diff: string }>;
  summary: string;
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
    },
    task: AgentRunnerTask,
  ): Promise<AgentRunnerResult>;
}
