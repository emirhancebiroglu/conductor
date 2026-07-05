import { execa, type ExecaError } from "execa";
import { simpleGit } from "simple-git";
import AdmZip from "adm-zip";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
  CX_BASE_AUTH_URI?: string;
  CX_TENANT?: string;
  // why: the Keycloak realm slug used by the IAM token endpoint can differ
  // from CX_TENANT (e.g. tenant "toyota-europe" but realm "toyotaeurope") —
  // CX_TENANT is what the cx CLI's --tenant flag expects, which does its own
  // internal resolution. Falls back to CX_TENANT when not set.
  CX_IAM_REALM?: string;
  CX_APIKEY?: string;
  CX_SCA_RESOLVER?: string;
  GITHUB_TOKEN_WORK?: string;
  CONDUCTOR_GITHUB_TOKEN?: string;
};

async function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  const zip = new AdmZip();
  zip.addLocalFolder(sourceDir);
  await fs.writeFile(outPath, zip.toBuffer());
}

export class CheckmarxCliProvider implements ScanProvider {
  private readonly baseUri: string;
  private readonly baseAuthUri: string | undefined;
  private readonly tenant: string;
  private readonly iamRealm: string;
  private readonly apiKey: string;
  private readonly githubToken: string;
  private readonly scaResolver: string | undefined;
  private accessToken: string | undefined;
  private accessTokenExpiresAt = 0;

  constructor(env: Env = process.env) {
    const baseUri = env.CX_BASE_URI;
    const tenant = env.CX_TENANT;
    const apiKey = env.CX_APIKEY;
    const githubToken = env.GITHUB_TOKEN_WORK ?? env.CONDUCTOR_GITHUB_TOKEN;

    if (!baseUri || !tenant || !apiKey) {
      throw new CheckmarxScanError(
        "Missing Checkmarx credentials: CX_BASE_URI, CX_TENANT, CX_APIKEY",
        "system_fail",
      );
    }
    if (!githubToken) {
      throw new CheckmarxScanError(
        "Missing GitHub token: GITHUB_TOKEN_WORK or CONDUCTOR_GITHUB_TOKEN",
        "system_fail",
      );
    }

    this.baseUri = baseUri;
    // why: getLatestScan() is a pure optimization — missing this env var
    // must not block scan()/fetchResults(), so it's not validated here.
    this.baseAuthUri = env.CX_BASE_AUTH_URI;
    this.tenant = tenant;
    this.iamRealm = env.CX_IAM_REALM ?? tenant;
    this.apiKey = apiKey;
    this.githubToken = githubToken;
    this.scaResolver = env.CX_SCA_RESOLVER;
  }

  async scan(
    repo: { owner: string; name: string },
    branch: string,
  ): Promise<ScanResult> {
    const projectName = `${repo.owner}/${repo.name}`;
    const workDir = join(tmpdir(), `cx-scan-${randomUUID()}`);
    const repoDir = join(workDir, "repo");
    const zipPath = join(workDir, "source.zip");

    try {
      // Clone repo with token auth
      await fs.mkdir(workDir, { recursive: true });
      const cloneUrl = `https://x-access-token:${this.githubToken}@github.com/${repo.owner}/${repo.name}.git`;
      console.log(`[cx] cloning ${repo.owner}/${repo.name}@${branch}`);
      await simpleGit().clone(cloneUrl, repoDir, ["--branch", branch, "--depth", "1"]);

      // Zip the repo
      console.log(`[cx] zipping to ${zipPath}`);
      await zipDirectory(repoDir, zipPath);

      // Run scan — cx exits non-zero even on success (progress logs to stderr).
      // Use reject:false so we can inspect the result file before deciding success/failure.
      // When SCA resolver is configured, pass the cloned directory as file-source (not zip).
      // ScaResolver cannot process zip files — it needs an unzipped directory.
      // cx accepts directories for both SAST and SCA scanning.
      const scaResolverArgs = this.scaResolver
        ? ["--sca-resolver", this.scaResolver]
        : [];
      const fileSource = this.scaResolver ? repoDir : zipPath;

      if (this.scaResolver) {
        console.log(`[cx] SCA resolver: ${this.scaResolver}, source: dir (${repoDir})`);
      } else {
        console.log(`[cx] SCA resolver: not configured — source: zip, transitive deps may be missed for Maven/Gradle`);
      }

      console.log(`[cx] submitting scan for ${projectName}`);
      const result = await execa("cx", [
        "scan", "create",
        "--project-name", projectName,
        "--branch", branch,
        "--file-source", fileSource,
        "--scan-types", "sast,sca",
        ...scaResolverArgs,
        "--scan-info-format", "json",
        "--report-format", "json",
        "--output-path", workDir,
        "--output-name", "cx_result",
        "--base-uri", this.baseUri,
        "--tenant", this.tenant,
        "--apikey", this.apiKey,
      ], { reject: false });

      const { stdout, stderr: scanStderr, exitCode } = result;
      console.log(`[cx] exit code: ${exitCode}`);
      console.log(`[cx] stdout (first 500): ${stdout.slice(0, 500)}`);
      console.log(`[cx] stderr (first 500): ${(typeof scanStderr === "string" ? scanStderr : "").slice(0, 500)}`);

      const resultFile = join(workDir, "cx_result.json");

      // Check if result file exists — cx writes it even when it exits non-zero
      let resultFileContent: string | null = null;
      try {
        resultFileContent = await fs.readFile(resultFile, "utf-8");
      } catch { /* no file */ }

      // If no result file and exit code non-zero, it's a real failure
      if (!resultFileContent && exitCode !== 0) {
        const stderr = typeof scanStderr === "string" ? scanStderr : "";
        throw new CheckmarxScanError(
          `Checkmarx scan failed (exit ${exitCode}): ${stderr.slice(-500) || stdout.slice(-500)}`,
          "scan_failed",
          exitCode,
          stderr,
        );
      }

      // Extract scan ID from multiple sources
      let scanId = "";

      // 1. stdout JSON
      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          scanId = (parsed[0] as Record<string, string>).ID ?? (parsed[0] as Record<string, string>).id ?? "";
        } else if (typeof parsed === "object" && parsed !== null) {
          scanId = (parsed as Record<string, string>).id ?? (parsed as Record<string, string>).ID ?? "";
        }
      } catch { /* not JSON */ }

      // 2. Regex on stdout + stderr (cx logs scan ID in progress output)
      if (!scanId) {
        const combined = stdout + "\n" + (typeof scanStderr === "string" ? scanStderr : "");
        const match = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i.exec(combined);
        if (match) scanId = match[1] ?? "";
      }

      console.log(`[cx] scan ID: ${scanId || "(not found)"}`);

      // cx scan create already downloaded the result file — parse it now regardless of whether
      // we have a scan ID. This avoids a second cx invocation in fetchResults (which fails when
      // cx is not on the worker's PATH in some environments).
      let findings: CmFinding[] | undefined;
      if (resultFileContent) {
        try {
          const json = JSON.parse(resultFileContent) as unknown;
          console.log(`[cx] result file found, parsing findings inline`);
          findings = parseCheckmarxResults(json);
          console.log(`[cx] parsed ${findings.length} findings from result file`);
        } catch {
          console.log(`[cx] result file parse failed, will fall back to fetchResults`);
        }
      }

      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      // why: exactOptionalPropertyTypes requires omitting the key entirely rather than `findings: undefined`
      if (findings !== undefined) {
        return { externalScanId: scanId || "embedded", findings };
      }
      return { externalScanId: scanId || "embedded" };
    } catch (err) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      if (err instanceof CheckmarxScanError) throw err;

      const execaErr = err as ExecaError;
      throw new CheckmarxScanError(
        `Checkmarx CLI error: ${execaErr.message ?? String(err)}`,
        "system_fail",
      );
    }
  }

  /**
   * Exchanges CX_APIKEY (a Checkmarx One refresh token) for a short-lived
   * access token via the IAM realm token endpoint, caching it until near
   * expiry. Neither the API key nor the access token are ever logged.
   */
  private async getAccessToken(): Promise<string | null> {
    if (!this.baseAuthUri) return null;

    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const tokenUrl = `${this.baseAuthUri.replace(/\/$/, "")}/auth/realms/${this.iamRealm}/protocol/openid-connect/token`;
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "ast-app",
          refresh_token: this.apiKey,
        }),
      });

      if (!response.ok) return null;

      const body = await response.json() as { access_token?: string; expires_in?: number };
      if (!body.access_token) return null;

      this.accessToken = body.access_token;
      // why: refresh a bit before actual expiry to avoid a request racing token expiry
      this.accessTokenExpiresAt = Date.now() + (body.expires_in ?? 60) * 1000 - 5000;
      return this.accessToken;
    } catch {
      return null;
    }
  }

  private async findProjectId(projectName: string): Promise<string | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const url = `${this.baseUri.replace(/\/$/, "")}/api/projects?name=${encodeURIComponent(projectName)}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return null;

      const body = await response.json() as unknown;
      const projects = Array.isArray(body)
        ? body
        : (body as { projects?: unknown[] })?.projects ?? [];

      const match = (projects as Record<string, string>[]).find((p) => p.name === projectName || p.Name === projectName);
      return match?.id ?? match?.ID ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Looks up the most recent Completed scan for repo+branch via the
   * Checkmarx One REST API directly, without cloning/zipping/submitting
   * anything. Returns null if none found or on any failure (missing
   * CX_BASE_AUTH_URI, network error, no matching project/scan) — this path
   * is a pure optimization and must never throw or block a real scan.
   */
  async getLatestScan(
    repo: { owner: string; name: string },
    branch: string,
  ): Promise<{ externalScanId: string } | null> {
    const projectName = `${repo.owner}/${repo.name}`;

    const projectId = await this.findProjectId(projectName);
    if (!projectId) return null;

    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const url = `${this.baseUri.replace(/\/$/, "")}/api/scans?project-id=${encodeURIComponent(projectId)}&branch=${encodeURIComponent(branch)}&statuses=Completed&limit=1`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return null;

      const body = await response.json() as unknown;
      const scans = Array.isArray(body) ? body : (body as { scans?: unknown[] })?.scans ?? [];
      const first = (scans as Record<string, string>[])[0];
      const scanId = first?.ID ?? first?.id;
      return scanId ? { externalScanId: scanId } : null;
    } catch {
      return null;
    }
  }

  /**
   * Submits a fresh scan via the existing CLI path (scan() — this keeps the
   * `--sca-resolver` integration intact, which is required for accurate
   * Maven/Gradle transitive dependency coverage: ScaResolver runs locally
   * and `cx` itself translates its output into Checkmarx One's format, a
   * translation this class has no independent way to reproduce). Once the
   * scan completes, results are read back via the REST `/api/results`
   * endpoint instead of the CLI's `cx results show` — this is the part that
   * legitimately benefits from being REST-based (no second subprocess just
   * to re-fetch what was already submitted).
   *
   * Confirmed via a live scan against a real repo: a REST-only git-submit
   * (POST /api/scans with type:"git") does NOT run ScaResolver server-side
   * and silently drops most Maven/Gradle SCA findings (18 vs 94 on the same
   * repo/branch in a real comparison) — so the CLI submission is retained
   * deliberately, not out of caution.
   */
  async rescanRest(
    repo: { owner: string; name: string },
    branch: string,
  ): Promise<ScanResult> {
    const { externalScanId } = await this.scan(repo, branch);
    const findings = await this.fetchResultsRest(externalScanId);
    return { externalScanId, findings };
  }

  /**
   * Fetches all scanner results (SAST + SCA together) for a completed scan
   * via the REST "All Scanners Results Service" — GET /api/results?scan-id=.
   * Confirmed via a live scan: response shape is `{results: [...], totalCount}`
   * where each result already carries `type: "sast"|"sca"`, identical to what
   * `cx results show` returns — parseCheckmarxResults() needs no changes.
   */
  private async fetchResultsRest(scanId: string): Promise<CmFinding[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    const base = this.baseUri.replace(/\/$/, "");
    const resp = await fetch(`${base}/api/results?scan-id=${encodeURIComponent(scanId)}&limit=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      console.warn(`[cx-rest] /api/results fetch failed (${resp.status}) for scan ${scanId}`);
      return [];
    }

    const json = await resp.json() as unknown;
    return parseCheckmarxResults(json);
  }

  async fetchResults(externalScanId: string): Promise<CmFinding[]> {
    // If scan() couldn't extract a UUID, it stored the result file path directly
    if (externalScanId.startsWith("file:")) {
      const filePath = externalScanId.slice("file:".length);
      const workDir = filePath.split(/[\\/]cx_result\.json/)[0] ?? "";
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const json = JSON.parse(content) as unknown;
        console.log(`[cx] results from embedded file (first 500): ${JSON.stringify(json).slice(0, 500)}`);
        return parseCheckmarxResults(json);
      } finally {
        if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    const workDir = join(tmpdir(), `cx-results-${randomUUID()}`);
    try {
      await fs.mkdir(workDir, { recursive: true });

      const result = await execa("cx", [
        "results", "show",
        "--scan-id", externalScanId,
        "--report-format", "json",
        "--output-path", workDir,
        "--output-name", "cx_result",
        "--base-uri", this.baseUri,
        "--tenant", this.tenant,
        "--apikey", this.apiKey,
      ], { reject: false });

      const { stdout, exitCode } = result;

      let json: unknown;
      try {
        const resultFile = join(workDir, "cx_result.json");
        const content = await fs.readFile(resultFile, "utf-8");
        json = JSON.parse(content);
      } catch {
        if (exitCode !== 0) {
          const stderr = typeof result.stderr === "string" ? result.stderr : "";
          throw new CheckmarxScanError(
            `Checkmarx results failed (exit ${exitCode}): ${stderr.slice(-500)}`,
            "scan_failed",
            exitCode,
            stderr,
          );
        }
        json = JSON.parse(stdout);
      }

      console.log(`[cx] results raw (first 2000): ${JSON.stringify(json).slice(0, 2000)}`);
      return parseCheckmarxResults(json);
    } catch (err) {
      if (err instanceof CheckmarxScanError) throw err;
      const execaErr = err as ExecaError;
      throw new CheckmarxScanError(
        `Checkmarx CLI error: ${execaErr.message ?? String(err)}`,
        "system_fail",
      );
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
