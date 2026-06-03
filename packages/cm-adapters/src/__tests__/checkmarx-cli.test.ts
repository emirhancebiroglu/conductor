import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckmarxCliProvider, CheckmarxScanError } from "../checkmarx-cli.js";

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: mockExeca,
}));

const MOCK_ENV = {
  CX_BASE_URI: "https://checkmarx.example.com",
  CX_TENANT: "test-tenant",
  CX_APIKEY: "test-api-key-12345",
};

const MOCK_SCAN_STDOUT = JSON.stringify({ id: "scan-abc-123" });

const MOCK_RESULTS_STDOUT = JSON.stringify({
  results: {
    sca: {
      findings: [
        {
          packageName: "lodash",
          packageVersion: "4.17.20",
          fixedVersion: "4.17.21",
          severity: "HIGH",
          cveId: "CVE-2024-1234",
          type: "sca",
        },
      ],
    },
    sast: {
      findings: [],
    },
  },
});

beforeEach(() => {
  mockExeca.mockReset();
});

describe("CheckmarxCliProvider", () => {
  describe("constructor", () => {
    it("throws system_fail when env vars are missing", () => {
      expect(() => new CheckmarxCliProvider({})).toThrow(CheckmarxScanError);
      expect(() => new CheckmarxCliProvider({})).toThrow("Missing Checkmarx credentials");
    });

    it("constructs successfully when all env vars are present", () => {
      const provider = new CheckmarxCliProvider(MOCK_ENV);
      expect(provider).toBeInstanceOf(CheckmarxCliProvider);
    });
  });

  describe("scan", () => {
    it("calls cx scan create with correct CLI args", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_SCAN_STDOUT });

      const provider = new CheckmarxCliProvider(MOCK_ENV);
      const result = await provider.scan({ owner: "test-owner", name: "ms-test-repo" }, "main");

      expect(mockExeca).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockExeca.mock.calls[0] as [string, string[]];
      expect(cmd).toBe("cx");
      expect(args).toContain("scan");
      expect(args).toContain("create");
      expect(args).toContain("--project-name");
      expect(args).toContain("test-owner/ms-test-repo");
      expect(args).toContain("--branch");
      expect(args).toContain("main");
      expect(args).toContain("--report-format");
      expect(args).toContain("json");

      expect(result.externalScanId).toBe("scan-abc-123");
    });

    it("does not leak API key in error messages", async () => {
      const execaError = new Error("Checkmarx CLI error");
      Object.assign(execaError, { exitCode: 1, stderr: "Scan failed" });
      mockExeca.mockRejectedValueOnce(execaError);

      const provider = new CheckmarxCliProvider(MOCK_ENV);

      try {
        await provider.scan({ owner: "test", name: "repo" }, "main");
        expect.fail("Should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain("test-api-key-12345");
        expect(msg).not.toContain(MOCK_ENV.CX_APIKEY);
      }
    });

    it("maps Checkmarx-reported failure to scan_failed outcome", async () => {
      const execaError = new Error("Checkmarx scan failed");
      Object.assign(execaError, { exitCode: 1, stderr: "Scan aborted: invalid config" });
      mockExeca.mockRejectedValueOnce(execaError);

      const provider = new CheckmarxCliProvider(MOCK_ENV);

      try {
        await provider.scan({ owner: "test", name: "repo" }, "main");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CheckmarxScanError);
        expect((err as CheckmarxScanError).outcome).toBe("scan_failed");
        expect((err as CheckmarxScanError).exitCode).toBe(1);
      }
    });

    it("maps system/network error to system_fail outcome", async () => {
      mockExeca.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

      const provider = new CheckmarxCliProvider(MOCK_ENV);

      try {
        await provider.scan({ owner: "test", name: "repo" }, "main");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CheckmarxScanError);
        expect((err as CheckmarxScanError).outcome).toBe("system_fail");
      }
    });
  });

  describe("fetchResults", () => {
    it("calls cx results show with correct CLI args", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_RESULTS_STDOUT });

      const provider = new CheckmarxCliProvider(MOCK_ENV);
      const findings = await provider.fetchResults("scan-abc-123");

      expect(mockExeca).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockExeca.mock.calls[0] as [string, string[]];
      expect(cmd).toBe("cx");
      expect(args).toContain("results");
      expect(args).toContain("show");
      expect(args).toContain("--scan-id");
      expect(args).toContain("scan-abc-123");

      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]!.source).toBe("sca");
      expect(findings[0]!.package).toBe("lodash");
    });

    it("does not leak API key in error messages", async () => {
      const execaError = new Error("Checkmarx CLI error");
      Object.assign(execaError, { exitCode: 3, stderr: "Results not found" });
      mockExeca.mockRejectedValueOnce(execaError);

      const provider = new CheckmarxCliProvider(MOCK_ENV);

      try {
        await provider.fetchResults("scan-invalid");
        expect.fail("Should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain("test-api-key-12345");
        expect(msg).not.toContain(MOCK_ENV.CX_APIKEY);
      }
    });

    it("maps Checkmarx-reported failure to scan_failed outcome", async () => {
      const execaError = new Error("Results not found");
      Object.assign(execaError, { exitCode: 3, stderr: "Scan ID not found" });
      mockExeca.mockRejectedValueOnce(execaError);

      const provider = new CheckmarxCliProvider(MOCK_ENV);

      try {
        await provider.fetchResults("scan-invalid");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CheckmarxScanError);
        expect((err as CheckmarxScanError).outcome).toBe("scan_failed");
        expect((err as CheckmarxScanError).exitCode).toBe(3);
      }
    });

    it("maps system/network error to system_fail outcome", async () => {
      mockExeca.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));

      const provider = new CheckmarxCliProvider(MOCK_ENV);

      try {
        await provider.fetchResults("scan-abc-123");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CheckmarxScanError);
        expect((err as CheckmarxScanError).outcome).toBe("system_fail");
      }
    });

    it("parses JSON results into CmFinding[]", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_RESULTS_STDOUT });

      const provider = new CheckmarxCliProvider(MOCK_ENV);
      const findings = await provider.fetchResults("scan-abc-123");

      expect(findings).toHaveLength(1);
      expect(findings[0]!.source).toBe("sca");
      expect(findings[0]!.severity).toBe("HIGH");
      expect(findings[0]!.fingerprint).toBeTruthy();
    });
  });
});
