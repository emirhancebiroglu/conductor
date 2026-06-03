import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AgentRunner, AgentRunnerTask, AgentRunnerResult } from "./agent-runner.js";

export class StubRunner implements AgentRunner {
  async run(
    _agentConfig: {
      agentName: string;
      provider: string;
      model: string;
      systemPrompt: string;
    },
    task: AgentRunnerTask,
  ): Promise<AgentRunnerResult> {
    const edits: AgentRunnerResult["edits"] = [];

    for (const file of task.files ?? []) {
      const filePath = join(task.workingDir, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, "utf-8");
      edits.push({
        file: file.path,
        diff: `+++ ${file.path}\n+${file.content.replace(/\n/g, "\n+")}`,
      });
    }

    return {
      edits,
      summary: `StubRunner applied ${edits.length} file(s): ${task.description}`,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
    };
  }
}
