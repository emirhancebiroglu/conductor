import type { ScanProvider } from "@conductor/cm-adapters";
import type { AgentRunner } from "@conductor/cm-adapters";
import { MockScanProvider, CheckmarxCliProvider, StubRunner, ClaudeRunner } from "@conductor/cm-adapters";

export type AdapterConfig = {
  scanProvider: ScanProvider;
  agentRunner: AgentRunner;
};

export function loadConfig(): AdapterConfig {
  const scanProvider = createScanProvider();
  const agentRunner = createAgentRunner();
  return { scanProvider, agentRunner };
}

function createScanProvider(): ScanProvider {
  const mode = process.env.CM_SCAN_PROVIDER ?? "mock";
  switch (mode) {
    case "checkmarx":
      return new CheckmarxCliProvider();
    case "mock":
      return new MockScanProvider();
    default:
      throw new Error(`Unknown CM_SCAN_PROVIDER: ${mode}. Expected mock|checkmarx`);
  }
}

function createAgentRunner(): AgentRunner {
  const mode = process.env.CM_AGENT_RUNNER ?? "stub";
  switch (mode) {
    case "claude":
      return new ClaudeRunner();
    case "stub":
      return new StubRunner();
    default:
      throw new Error(`Unknown CM_AGENT_RUNNER: ${mode}. Expected stub|claude`);
  }
}
