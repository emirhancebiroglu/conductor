import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../config.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("config", () => {
  describe("loadConfig", () => {
    it("selects MockScanProvider by default", () => {
      delete process.env.CM_SCAN_PROVIDER;
      delete process.env.CM_AGENT_RUNNER;
      const config = loadConfig();
      expect(config.scanProvider.constructor.name).toBe("MockScanProvider");
      expect(config.agentRunner.constructor.name).toBe("StubRunner");
    });

    it("selects MockScanProvider when env is mock", () => {
      process.env.CM_SCAN_PROVIDER = "mock";
      const config = loadConfig();
      expect(config.scanProvider.constructor.name).toBe("MockScanProvider");
    });

    it("selects CheckmarxCliProvider when env is checkmarx", () => {
      process.env.CM_SCAN_PROVIDER = "checkmarx";
      process.env.CX_BASE_URI = "https://cx.example.com";
      process.env.CX_TENANT = "test";
      process.env.CX_APIKEY = "test-key";
      const config = loadConfig();
      expect(config.scanProvider.constructor.name).toBe("CheckmarxCliProvider");
    });

    it("selects StubRunner by default", () => {
      delete process.env.CM_AGENT_RUNNER;
      const config = loadConfig();
      expect(config.agentRunner.constructor.name).toBe("StubRunner");
    });

    it("selects StubRunner when env is stub", () => {
      process.env.CM_AGENT_RUNNER = "stub";
      const config = loadConfig();
      expect(config.agentRunner.constructor.name).toBe("StubRunner");
    });

    it("selects ClaudeRunner when env is claude", () => {
      process.env.CM_AGENT_RUNNER = "claude";
      const config = loadConfig();
      expect(config.agentRunner.constructor.name).toBe("ClaudeRunner");
    });

    it("throws for unknown scan provider", () => {
      process.env.CM_SCAN_PROVIDER = "unknown";
      expect(() => loadConfig()).toThrow("Unknown CM_SCAN_PROVIDER");
    });

    it("throws for unknown agent runner", () => {
      process.env.CM_AGENT_RUNNER = "unknown";
      expect(() => loadConfig()).toThrow("Unknown CM_AGENT_RUNNER");
    });
  });
});
