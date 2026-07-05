import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CheckmarxCliProvider, CheckmarxScanError } from "../checkmarx-cli.js";

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: mockExeca,
}));

vi.mock("simple-git", () => ({
  simpleGit: () => ({
    clone: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("adm-zip", () => ({
  default: class {
    addLocalFolder = vi.fn();
    toBuffer = vi.fn().mockReturnValue(Buffer.from("fake-zip"));
  },
}));

const { mockReadFile } = vi.hoisted(() => ({ mockReadFile: vi.fn() }));

vi.mock("node:fs", () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readFile: mockReadFile,
  },
}));

const MOCK_ENV = {
  CX_BASE_URI: "https://checkmarx.example.com",
  CX_TENANT: "test-tenant",
  CX_APIKEY: "test-api-key-12345",
  GITHUB_TOKEN_WORK: "ghp_test-token",
};

const MOCK_SCAN_STDOUT = JSON.stringify({ id: "scan-abc-123" });

const MOCK_RESULTS_STDOUT = JSON.stringify({
  results: [
    {
      type: "sca",
      id: "CVE-2024-1234",
      severity: "HIGH",
      description: "Prototype Pollution in lodash",
      data: {
        packageName: "lodash",
        packageVersion: "4.17.20",
        fixedVersion: "4.17.21",
        recommendedVersion: "4.17.21",
        packageIdentifier: "Npm-lodash-4.17.20",
        cveId: "CVE-2024-1234",
      },
    },
  ],
});

beforeEach(() => {
  mockExeca.mockReset();
  mockReadFile.mockReset();
  mockReadFile.mockResolvedValue(MOCK_RESULTS_STDOUT);
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
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_SCAN_STDOUT, exitCode: 0 });

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
      // reject:false — execa resolves with non-zero exitCode + no result file → scan_failed
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "Scan aborted: invalid config", exitCode: 1 });
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

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

  describe("getLatestScan", () => {
    const MOCK_ENV_WITH_AUTH = { ...MOCK_ENV, CX_BASE_AUTH_URI: "https://iam.example.com" };

    const TOKEN_RESPONSE = { ok: true, json: () => Promise.resolve({ access_token: "tok-abc", expires_in: 600 }) };
    const PROJECTS_RESPONSE = { ok: true, json: () => Promise.resolve([{ id: "proj-123", name: "test-owner/ms-test-repo" }]) };
    const SCANS_RESPONSE = { ok: true, json: () => Promise.resolve([{ ID: "scan-latest-999", Status: "Completed" }]) };

    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("exchanges token, resolves project id, and returns the latest completed scan", async () => {
      mockFetch
        .mockResolvedValueOnce(TOKEN_RESPONSE)
        .mockResolvedValueOnce(PROJECTS_RESPONSE)
        .mockResolvedValueOnce(SCANS_RESPONSE);

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      const result = await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");

      expect(result).toEqual({ externalScanId: "scan-latest-999" });

      const tokenCall = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(tokenCall[0]).toContain("/auth/realms/test-tenant/protocol/openid-connect/token");
      expect(tokenCall[1]?.method).toBe("POST");

      const projectsCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(projectsCall[0]).toContain("/api/projects?name=");
      expect((projectsCall[1]?.headers as Record<string, string>).Authorization).toBe("Bearer tok-abc");

      const scansCall = mockFetch.mock.calls[2] as [string, RequestInit];
      expect(scansCall[0]).toContain("project-id=proj-123");
      expect(scansCall[0]).toContain("branch=uat");
    });

    it("caches the access token across calls instead of re-exchanging it", async () => {
      mockFetch
        .mockResolvedValueOnce(TOKEN_RESPONSE)
        .mockResolvedValueOnce(PROJECTS_RESPONSE)
        .mockResolvedValueOnce(SCANS_RESPONSE)
        .mockResolvedValueOnce(PROJECTS_RESPONSE)
        .mockResolvedValueOnce(SCANS_RESPONSE);

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");
      await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");

      const tokenExchangeCalls = mockFetch.mock.calls.filter(([url]) => (url as string).includes("openid-connect/token"));
      expect(tokenExchangeCalls).toHaveLength(1);
    });

    it("returns null without any fetch call when CX_BASE_AUTH_URI is not configured", async () => {
      const provider = new CheckmarxCliProvider(MOCK_ENV);
      const result = await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null when no matching project is found", async () => {
      mockFetch
        .mockResolvedValueOnce(TOKEN_RESPONSE)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      const result = await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");

      expect(result).toBeNull();
    });

    it("returns null when the scans response is empty", async () => {
      mockFetch
        .mockResolvedValueOnce(TOKEN_RESPONSE)
        .mockResolvedValueOnce(PROJECTS_RESPONSE)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      const result = await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");

      expect(result).toBeNull();
    });

    it("returns null instead of throwing on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      const result = await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");

      expect(result).toBeNull();
    });

    it("returns null instead of throwing when the token endpoint responds with an error status", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      const result = await provider.getLatestScan({ owner: "test-owner", name: "ms-test-repo" }, "uat");

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

  });

  describe("rescanRest", () => {
    const MOCK_ENV_WITH_AUTH = { ...MOCK_ENV, CX_BASE_AUTH_URI: "https://iam.example.com" };
    const TOKEN_RESPONSE = { ok: true, json: () => Promise.resolve({ access_token: "tok-abc", expires_in: 600 }) };
    const PROJECTS_RESPONSE = { ok: true, json: () => Promise.resolve([{ id: "proj-123", name: "test-owner/ms-test-repo" }]) };
    const SUBMIT_RESPONSE = { ok: true, json: () => Promise.resolve({ id: "rescan-999" }) };
    const RUNNING_STATUS_RESPONSE = { ok: true, json: () => Promise.resolve({ status: "Running" }) };
    const COMPLETED_STATUS_RESPONSE = { ok: true, json: () => Promise.resolve({ status: "Completed" }) };
    const SAST_RESULTS_RESPONSE = {
      ok: true,
      json: () => Promise.resolve({
        results: [{ id: "sast-1", severity: "HIGH", data: { queryName: "SQL_Injection", nodes: [{ fileName: "a.ts", line: 5 }] } }],
      }),
    };
    const SCA_RESULTS_RESPONSE = {
      ok: true,
      json: () => Promise.resolve({
        results: [{ id: "CVE-2024-1234", severity: "CRITICAL", data: { packageName: "lodash", packageVersion: "4.17.20", fixedVersion: "4.17.21" } }],
      }),
    };

    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it("submits via REST, polls until completed, and fetches SAST+SCA results via REST — no cx subprocess", async () => {
      mockFetch
        .mockResolvedValueOnce(TOKEN_RESPONSE)
        .mockResolvedValueOnce(PROJECTS_RESPONSE)
        .mockResolvedValueOnce(SUBMIT_RESPONSE)
        .mockResolvedValueOnce(RUNNING_STATUS_RESPONSE)
        .mockResolvedValueOnce(COMPLETED_STATUS_RESPONSE)
        .mockResolvedValueOnce(SAST_RESULTS_RESPONSE)
        .mockResolvedValueOnce(SCA_RESULTS_RESPONSE);

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      const resultPromise = provider.rescanRest({ owner: "test-owner", name: "ms-test-repo" }, "checkmarx-auto");

      // let the submit + first poll tick happen, then advance past the poll interval twice
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(mockExeca).not.toHaveBeenCalled();
      expect(result.externalScanId).toBe("rescan-999");
      expect(result.findings).toHaveLength(2);
      expect(result.findings?.some((f) => f.source === "sast")).toBe(true);
      expect(result.findings?.some((f) => f.source === "sca")).toBe(true);

      const submitCall = mockFetch.mock.calls[2] as [string, RequestInit];
      expect(submitCall[0]).toContain("/api/scans");
      expect(submitCall[1]?.method).toBe("POST");
      const submitBody = JSON.parse(submitCall[1]?.body as string) as { handler?: { branch?: string } };
      expect(submitBody.handler?.branch).toBe("checkmarx-auto");
    });

    it("throws if the scan ends with a non-completed terminal status", async () => {
      mockFetch
        .mockResolvedValueOnce(TOKEN_RESPONSE)
        .mockResolvedValueOnce(PROJECTS_RESPONSE)
        .mockResolvedValueOnce(SUBMIT_RESPONSE)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: "Failed" }) });

      const provider = new CheckmarxCliProvider(MOCK_ENV_WITH_AUTH);
      const resultPromise = provider.rescanRest({ owner: "test-owner", name: "ms-test-repo" }, "checkmarx-auto");

      const assertion = expect(resultPromise).rejects.toThrow(/ended with status Failed/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    });
  });

  describe("fetchResults", () => {
    it("calls cx results show with correct CLI args", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_RESULTS_STDOUT, exitCode: 0 });

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
      // reject:false means execa resolves with exitCode ≠ 0 instead of throwing
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "Scan ID not found", exitCode: 3 });
      // readFile throws → falls to exitCode check → scan_failed
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

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
      mockExeca.mockResolvedValueOnce({ stdout: MOCK_RESULTS_STDOUT, exitCode: 0 });

      const provider = new CheckmarxCliProvider(MOCK_ENV);
      const findings = await provider.fetchResults("scan-abc-123");

      expect(findings).toHaveLength(1);
      expect(findings[0]!.source).toBe("sca");
      expect(findings[0]!.severity).toBe("HIGH");
      expect(findings[0]!.fingerprint).toBeTruthy();
    });
  });
});
