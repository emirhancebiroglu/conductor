import { describe, it, expect } from "vitest";
import {
  CmPipelineRowSchema,
  CmRepoRowSchema,
  CmScanRowSchema,
  CmFindingRowSchema,
  CmReportRowSchema,
  cmPipelineRowToEntity,
  cmPipelineEntityToRow,
  cmRepoRowToEntity,
  cmRepoEntityToRow,
  cmScanRowToEntity,
  cmScanEntityToRow,
  cmFindingRowToEntity,
  cmFindingEntityToRow,
  cmReportRowToEntity,
  cmReportEntityToRow,
} from "../types.js";

const validPipelineRow = {
  id: "00000000-0000-0000-0000-000000000001",
  workspace_id: "00000000-0000-0000-0000-000000000002",
  name: "Test Pipeline",
  enabled: true,
  cron: "0 0 * * *",
  discovery_name_prefix: "ms",
  discovery_config_path: ".github/checkmarx_scan.yml",
  severity_threshold: ["CRITICAL", "HIGH"],
  sca_test_policy: "skip-minor",
  fix_branch: "checkmarx-auto",
  report_dir: "D:/checkmarx-reports",
  retry_cooldown_seconds: 1800,
  max_fix_attempts: 2,
  created_at: "2026-06-03T12:00:00Z",
  updated_at: "2026-06-03T12:00:00Z",
};

const validRepoRow = {
  id: "00000000-0000-0000-0000-000000000003",
  pipeline_id: "00000000-0000-0000-0000-000000000001",
  workspace_id: "00000000-0000-0000-0000-000000000002",
  owner: "test-owner",
  name: "ms-test-repo",
  default_branch: "main",
  source: "auto",
  priority: 50,
  enabled: true,
  run_config: null,
  last_scan_id: null,
  created_at: "2026-06-03T12:00:00Z",
  updated_at: "2026-06-03T12:00:00Z",
};

const validScanRow = {
  id: "00000000-0000-0000-0000-000000000004",
  repo_id: "00000000-0000-0000-0000-000000000003",
  workspace_id: "00000000-0000-0000-0000-000000000002",
  status: "queued",
  provider: "checkmarx",
  external_scan_id: null,
  branch_scanned: null,
  trigger: "manual",
  findings_total: 0,
  findings_actionable: 0,
  error: null,
  current_step: null,
  pr_url: null,
  report_path: null,
  started_at: null,
  finished_at: null,
  created_at: "2026-06-03T12:00:00Z",
  updated_at: "2026-06-03T12:00:00Z",
};

const validFindingRow = {
  id: "00000000-0000-0000-0000-000000000005",
  scan_id: "00000000-0000-0000-0000-000000000004",
  workspace_id: "00000000-0000-0000-0000-000000000002",
  source: "sca",
  severity: "CRITICAL",
  rule: "CVE-2024-1234",
  package: "lodash",
  current_version: "4.17.20",
  fixed_version: "4.17.21",
  upgrade_impact: null,
  file: null,
  line: null,
  fingerprint: "sca|lodash|CVE-2024-1234",
  fix_status: "open",
  fix_attempts: 0,
  fix_notes: null,
  created_at: "2026-06-03T12:00:00Z",
  updated_at: "2026-06-03T12:00:00Z",
};

const validReportRow = {
  id: "00000000-0000-0000-0000-000000000006",
  scan_id: "00000000-0000-0000-0000-000000000004",
  workspace_id: "00000000-0000-0000-0000-000000000002",
  path: "D:/checkmarx-reports/test-repo-cm-20260603.docx",
  format: "docx",
  created_at: "2026-06-03T12:00:00Z",
};

describe("CmPipelineRowSchema", () => {
  it("parses a valid pipeline row", () => {
    const result = CmPipelineRowSchema.parse(validPipelineRow);
    expect(result.name).toBe("Test Pipeline");
    expect(result.enabled).toBe(true);
    expect(result.severity_threshold).toEqual(["CRITICAL", "HIGH"]);
  });

  it("rejects a malformed pipeline row", () => {
    expect(() => CmPipelineRowSchema.parse({})).toThrow();
    expect(() => CmPipelineRowSchema.parse({ ...validPipelineRow, enabled: "not-a-boolean" })).toThrow();
  });
});

describe("CmRepoRowSchema", () => {
  it("parses a valid repo row", () => {
    const result = CmRepoRowSchema.parse(validRepoRow);
    expect(result.owner).toBe("test-owner");
    expect(result.name).toBe("ms-test-repo");
    expect(result.priority).toBe(50);
  });

  it("rejects a malformed repo row", () => {
    expect(() => CmRepoRowSchema.parse({})).toThrow();
  });
});

describe("CmScanRowSchema", () => {
  it("parses a valid scan row", () => {
    const result = CmScanRowSchema.parse(validScanRow);
    expect(result.status).toBe("queued");
    expect(result.trigger).toBe("manual");
  });

  it("rejects a malformed scan row", () => {
    expect(() => CmScanRowSchema.parse({})).toThrow();
  });
});

describe("CmFindingRowSchema", () => {
  it("parses a valid finding row", () => {
    const result = CmFindingRowSchema.parse(validFindingRow);
    expect(result.source).toBe("sca");
    expect(result.severity).toBe("CRITICAL");
    expect(result.fingerprint).toBe("sca|lodash|CVE-2024-1234");
  });

  it("rejects a malformed finding row", () => {
    expect(() => CmFindingRowSchema.parse({})).toThrow();
  });
});

describe("CmReportRowSchema", () => {
  it("parses a valid report row", () => {
    const result = CmReportRowSchema.parse(validReportRow);
    expect(result.path).toContain("test-repo-cm");
    expect(result.format).toBe("docx");
  });

  it("rejects a malformed report row", () => {
    expect(() => CmReportRowSchema.parse({})).toThrow();
  });
});

describe("snake ↔ camel mappers", () => {
  it("round-trips CmPipeline", () => {
    const entity = cmPipelineRowToEntity(validPipelineRow);
    expect(entity.workspaceId).toBe(validPipelineRow.workspace_id);
    expect(entity.severityThreshold).toEqual(validPipelineRow.severity_threshold);
    const rowBack = cmPipelineEntityToRow(entity);
    expect(rowBack).toEqual(validPipelineRow);
  });

  it("round-trips CmRepo", () => {
    const entity = cmRepoRowToEntity(validRepoRow);
    expect(entity.pipelineId).toBe(validRepoRow.pipeline_id);
    const rowBack = cmRepoEntityToRow(entity);
    expect(rowBack).toEqual(validRepoRow);
  });

  it("round-trips CmScan", () => {
    const entity = cmScanRowToEntity(validScanRow);
    expect(entity.repoId).toBe(validScanRow.repo_id);
    expect(entity.trigger).toBe(validScanRow.trigger);
    const rowBack = cmScanEntityToRow(entity);
    expect(rowBack).toEqual(validScanRow);
  });

  it("round-trips CmFinding", () => {
    const entity = cmFindingRowToEntity(validFindingRow);
    expect(entity.scanId).toBe(validFindingRow.scan_id);
    expect(entity.fingerprint).toBe(validFindingRow.fingerprint);
    const rowBack = cmFindingEntityToRow(entity);
    expect(rowBack).toEqual(validFindingRow);
  });

  it("round-trips CmReport", () => {
    const entity = cmReportRowToEntity(validReportRow);
    expect(entity.scanId).toBe(validReportRow.scan_id);
    const rowBack = cmReportEntityToRow(entity);
    expect(rowBack).toEqual(validReportRow);
  });
});
