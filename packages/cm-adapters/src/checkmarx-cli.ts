import { execa, type ExecaError } from "execa";
import { parseCheckmarxResults } from "@conductor/cm-core";
import type { ScanProvider, ScanResult } from "./scan-provider.js";
import type { CmFinding } from "@conductor/cm-core";

export type CheckmarxOutcome = "completed" | "scan_failed" | "system_fail";

export class CheckmarxScanError extends Error {
  constructor(
    message: string,
    public readonly outcome: CheckmarxOutcome,
    public readonly exitCode: number | null = null,
    public readonly stderr: string = "",
  ) {
    super(message);
    this.name = "CheckmarxScanError";
  }
}

type Env = {
  CX_BASE_URI?: string;
  CX_TENANT?: string;
  CX_APIKEY?: string;
};

export class CheckmarxCliProvider implements ScanProvider {
  private readonly baseUri: string;
  private readonly tenant: string;
  private readonly apiKey: string;

  constructor(env: Env = process.env) {
    const baseUri = env.CX_BASE_URI;
    const tenant = env.CX_TENANT;
    const apiKey = env.CX_APIKEY;

    if (!baseUri || !tenant || !apiKey) {
      throw new CheckmarxScanError(
        "Missing Checkmarx credentials: CX_BASE_URI, CX_TENANT, CX_APIKEY",
        "system_fail",
      );
    }

    this.baseUri = baseUri;
    this.tenant = tenant;
    this.apiKey = apiKey;
  }

  async scan(
    repo: { owner: string; name: string },
    branch: string,
  ): Promise<ScanResult> {
    const projectName = `${repo.owner}/${repo.name}`;

    try {
      const { stdout } = await execa("cx", [
        "scan",
        "create",
        "--project-name", projectName,
        "--branch", branch,
        "--report-format", "json",
        "--base-uri", this.baseUri,
        "--tenant", this.tenant,
        "--api-key", this.apiKey,
      ]);

      const parsed = JSON.parse(stdout) as unknown as { id?: string };
      const scanId = parsed.id ?? "";
      if (!scanId) {
        throw new CheckmarxScanError("Scan created but no scan ID returned", "system_fail");
      }

      return { externalScanId: scanId };
    } catch (err) {
      if (err instanceof CheckmarxScanError) throw err;

      const execaErr = err as ExecaError;
      const stderr = typeof execaErr.stderr === "string" ? execaErr.stderr : "";

      if (execaErr.exitCode !== undefined && execaErr.exitCode !== null) {
        throw new CheckmarxScanError(
          `Checkmarx scan failed: ${stderr || execaErr.message}`,
          "scan_failed",
          execaErr.exitCode,
          stderr,
        );
      }

      throw new CheckmarxScanError(
        `Checkmarx CLI error: ${execaErr.message ?? String(err)}`,
        "system_fail",
      );
    }
  }

  async fetchResults(externalScanId: string): Promise<CmFinding[]> {
    try {
      const { stdout } = await execa("cx", [
        "results",
        "show",
        "--scan-id", externalScanId,
        "--report-format", "json",
        "--base-uri", this.baseUri,
        "--tenant", this.tenant,
        "--api-key", this.apiKey,
      ]);

      const json = JSON.parse(stdout) as unknown;
      return parseCheckmarxResults(json);
    } catch (err) {
      if (err instanceof CheckmarxScanError) throw err;

      const execaErr = err as ExecaError;
      const stderr = typeof execaErr.stderr === "string" ? execaErr.stderr : "";

      if (execaErr.exitCode !== undefined && execaErr.exitCode !== null) {
        throw new CheckmarxScanError(
          `Checkmarx results failed: ${stderr || execaErr.message}`,
          "scan_failed",
          execaErr.exitCode,
          stderr,
        );
      }

      throw new CheckmarxScanError(
        `Checkmarx CLI error: ${execaErr.message ?? String(err)}`,
        "system_fail",
      );
    }
  }
}
