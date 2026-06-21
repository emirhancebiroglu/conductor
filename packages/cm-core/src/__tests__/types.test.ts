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
  CmFixStrategySchema,
  CmFixPlanItemSchema,
  CmFixPlanSchema,
  CmCategorySchema,
  CmMitigationKindSchema,
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
  branch_exclude_pattern: "*kubernetes*,*k8s*",
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
  description: null,
  taint_flow: null,
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

describe("CmFixStrategySchema", () => {
  it("allows all five strategies", () => {
    expect(CmFixStrategySchema.parse("upgrade")).toBe("upgrade");
    expect(CmFixStrategySchema.parse("mitigate")).toBe("mitigate");
    expect(CmFixStrategySchema.parse("code-fix")).toBe("code-fix");
    expect(CmFixStrategySchema.parse("skip")).toBe("skip");
    expect(CmFixStrategySchema.parse("needs-human")).toBe("needs-human");
  });

  it("rejects an invalid strategy", () => {
    expect(() => CmFixStrategySchema.parse("invalid")).toThrow();
  });
});

describe("CmMitigationKindSchema", () => {
  it("allows all mitigation kinds", () => {
    expect(CmMitigationKindSchema.parse("override")).toBe("override");
    expect(CmMitigationKindSchema.parse("resolution")).toBe("resolution");
    expect(CmMitigationKindSchema.parse("dependency-management")).toBe("dependency-management");
    expect(CmMitigationKindSchema.parse("alias")).toBe("alias");
    expect(CmMitigationKindSchema.parse("replacement")).toBe("replacement");
    expect(CmMitigationKindSchema.parse("none")).toBe("none");
  });

  it("rejects an invalid mitigation kind", () => {
    expect(() => CmMitigationKindSchema.parse("unknown")).toThrow();
  });
});

describe("CmCategorySchema", () => {
  it("allows all categories", () => {
    expect(CmCategorySchema.parse("frontend")).toBe("frontend");
    expect(CmCategorySchema.parse("backend")).toBe("backend");
    expect(CmCategorySchema.parse("shared")).toBe("shared");
    expect(CmCategorySchema.parse("infra")).toBe("infra");
  });

  it("rejects an invalid category", () => {
    expect(() => CmCategorySchema.parse("database")).toThrow();
  });
});

describe("CmFixPlanItemSchema", () => {
  const validItem = {
    fingerprint: "sca|lodash|CVE-2024-1234",
    strategy: "upgrade",
    category: "backend",
    reachable: true,
    exploitable: true,
    falsePositive: false,
    mitigationKind: "none",
    priority: 8,
    confidence: 0.9,
    notes: "test note",
    targetVersion: "4.17.21",
  };

  it("parses a valid fix plan item with all fields", () => {
    const result = CmFixPlanItemSchema.parse(validItem);
    expect(result.fingerprint).toBe(validItem.fingerprint);
    expect(result.strategy).toBe("upgrade");
    expect(result.category).toBe("backend");
    expect(result.falsePositive).toBe(false);
    expect(result.mitigationKind).toBe("none");
    expect(result.priority).toBe(8);
    expect(result.confidence).toBe(0.9);
    expect(result.targetVersion).toBe("4.17.21");
  });

  it("defaults falsePositive to false", () => {
    const { falsePositive: _, ...withoutFp } = validItem;
    const result = CmFixPlanItemSchema.parse(withoutFp);
    expect(result.falsePositive).toBe(false);
  });

  it("allows optional mitigationKind to be omitted", () => {
    const { mitigationKind: _, ...withoutMk } = validItem;
    const result = CmFixPlanItemSchema.parse(withoutMk);
    expect(result.mitigationKind).toBeUndefined();
  });

  it("rejects confidence outside 0-1", () => {
    expect(() => CmFixPlanItemSchema.parse({ ...validItem, confidence: 1.5 })).toThrow();
    expect(() => CmFixPlanItemSchema.parse({ ...validItem, confidence: -0.1 })).toThrow();
  });
});

describe("CmFixPlanSchema", () => {
  it("parses a valid fix plan with multiple findings", () => {
    const plan = {
      findings: [
        {
          fingerprint: "sca|pkg1|CVE-1",
          strategy: "upgrade",
          category: "backend",
          reachable: true,
          exploitable: true,
          falsePositive: false,
          priority: 10,
          confidence: 0.95,
          notes: "critical upgrade",
          targetVersion: "2.0.0",
        },
        {
          fingerprint: "sast|sql-injection|file.ts:42",
          strategy: "code-fix",
          category: "frontend",
          reachable: true,
          exploitable: true,
          falsePositive: false,
          priority: 7,
          confidence: 0.8,
          notes: "parameterize query",
        },
      ],
    };
    const result = CmFixPlanSchema.parse(plan);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.strategy).toBe("upgrade");
    expect(result.findings[1]!.strategy).toBe("code-fix");
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
