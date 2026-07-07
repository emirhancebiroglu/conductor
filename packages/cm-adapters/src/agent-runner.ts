export type AgentRunnerTask = {
  description: string;
  workingDir: string;
  contextFiles?: Array<{ path: string; label: string }>;
};

export type AgentRunnerResult = {
  summary: string;
  changed: boolean;
  /**
   * False when the underlying CLI process failed or was killed (e.g. wall-clock
   * timeout) rather than exiting cleanly. Callers must treat this as
   * authoritative — a killed agent may have left partial, unverified file
   * changes behind, so `changed` (a git-diff check) alone is not sufficient
   * evidence a fix actually completed.
   */
  success: boolean;
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
