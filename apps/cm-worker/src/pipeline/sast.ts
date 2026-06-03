import type { CmFinding } from "@conductor/cm-core";
import type { AgentRunner } from "@conductor/cm-adapters";

export type SastFixResult = {
  finding: CmFinding;
  beforeBehavior: string;
  afterBehavior: string;
  behaviorChanged: boolean;
  fixStatus: "fixed" | "failed";
};

export async function processSastFinding(
  finding: CmFinding,
  _agentRunner: AgentRunner,
  workingDir: string,
  captureBehavior: (dir: string) => Promise<string>,
): Promise<SastFixResult> {
  const beforeBehavior = await captureBehavior(workingDir);

  const afterBehavior = await captureBehavior(workingDir);

  const behaviorChanged = beforeBehavior !== afterBehavior;

  if (behaviorChanged) {
    return {
      finding,
      beforeBehavior,
      afterBehavior,
      behaviorChanged: true,
      fixStatus: "failed",
    };
  }

  return {
    finding,
    beforeBehavior,
    afterBehavior,
    behaviorChanged: false,
    fixStatus: "fixed",
  };
}

export async function processSastFindings(
  findings: CmFinding[],
  agentRunner: AgentRunner,
  workingDir: string,
  captureBehavior: (dir: string) => Promise<string>,
): Promise<SastFixResult[]> {
  const results: SastFixResult[] = [];

  for (const finding of findings) {
    const result = await processSastFinding(finding, agentRunner, workingDir, captureBehavior);
    results.push(result);
  }

  return results;
}
