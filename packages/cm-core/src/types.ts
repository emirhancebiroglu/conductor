import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives / enums
// ---------------------------------------------------------------------------

export const CmScanStatusSchema = z.enum([
  "queued",
  "scanning",
  "scan_done",
  "scan_failed",
  "fixing",
  "run_blocked",
  "fixed",
  "rescanning",
  "verified",
  "pr_opening",
  "pr_opened",
  "reporting",
  "done",
  "failed",
  "needs_human",
]);
export type CmScanStatus = z.infer<typeof CmScanStatusSchema>;

export const CmFixStatusSchema = z.enum([
  "open",
  "fixing",
  "fixed",
  "skipped",
  "failed",
  "verified",
  "needs_human",
]);
export type CmFixStatus = z.infer<typeof CmFixStatusSchema>;

export const CmSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type CmSeverity = z.infer<typeof CmSeveritySchema>;

export const CmSourceSchema = z.enum(["sca", "sast"]);
export type CmSource = z.infer<typeof CmSourceSchema>;

export const CmTriggerSchema = z.enum(["schedule", "manual", "retry"]);
export type CmTrigger = z.infer<typeof CmTriggerSchema>;

export const CmProviderSchema = z.enum(["checkmarx"]);
export type CmProvider = z.infer<typeof CmProviderSchema>;

export const CmRepoSourceSchema = z.enum(["auto", "manual"]);
export type CmRepoSource = z.infer<typeof CmRepoSourceSchema>;

export const CmScaTestPolicySchema = z.enum(["skip-minor", "test-all"]);
export type CmScaTestPolicy = z.infer<typeof CmScaTestPolicySchema>;

export const CmUpgradeImpactSchema = z.enum(["MINOR", "MID", "MAJOR"]);
export type CmUpgradeImpact = z.infer<typeof CmUpgradeImpactSchema>;

// ---------------------------------------------------------------------------
// Table: cm_pipeline
// ---------------------------------------------------------------------------

export const CmPipelineSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  cron: z.string(),
  discoveryNamePrefix: z.string(),
  discoveryConfigPath: z.string(),
  severityThreshold: z.array(CmSeveritySchema),
  scaTestPolicy: CmScaTestPolicySchema,
  fixBranch: z.string(),
  reportDir: z.string(),
  retryCooldownSeconds: z.number().int(),
  maxFixAttempts: z.number().int(),
  branchExcludePattern: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CmPipeline = z.infer<typeof CmPipelineSchema>;

export const CmPipelineRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  cron: z.string(),
  discovery_name_prefix: z.string(),
  discovery_config_path: z.string(),
  severity_threshold: z.array(z.string()),
  sca_test_policy: z.string(),
  fix_branch: z.string(),
  report_dir: z.string(),
  retry_cooldown_seconds: z.number().int(),
  max_fix_attempts: z.number().int(),
  branch_exclude_pattern: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CmPipelineRow = z.infer<typeof CmPipelineRowSchema>;

// ---------------------------------------------------------------------------
// Table: cm_repo
// ---------------------------------------------------------------------------

export const CmRepoSchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  source: CmRepoSourceSchema,
  priority: z.number().int(),
  enabled: z.boolean(),
  runConfig: z.record(z.unknown()).nullable(),
  lastScanId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CmRepo = z.infer<typeof CmRepoSchema>;

export const CmRepoRowSchema = z.object({
  id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  default_branch: z.string(),
  source: z.string(),
  priority: z.number().int(),
  enabled: z.boolean(),
  run_config: z.unknown().nullable(),
  last_scan_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CmRepoRow = z.infer<typeof CmRepoRowSchema>;

// ---------------------------------------------------------------------------
// Table: cm_scan
// ---------------------------------------------------------------------------

export const CmScanSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  status: CmScanStatusSchema,
  provider: z.string(),
  externalScanId: z.string().nullable(),
  branchScanned: z.string().nullable(),
  trigger: CmTriggerSchema,
  findingsTotal: z.number().int(),
  findingsActionable: z.number().int(),
  error: z.string().nullable(),
  currentStep: z.string().nullable(),
  prUrl: z.string().nullable(),
  reportPath: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CmScan = z.infer<typeof CmScanSchema>;

export const CmScanRowSchema = z.object({
  id: z.string().uuid(),
  repo_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  status: z.string(),
  provider: z.string(),
  external_scan_id: z.string().nullable(),
  branch_scanned: z.string().nullable(),
  trigger: z.string(),
  findings_total: z.number().int(),
  findings_actionable: z.number().int(),
  error: z.string().nullable(),
  current_step: z.string().nullable(),
  pr_url: z.string().nullable(),
  report_path: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CmScanRow = z.infer<typeof CmScanRowSchema>;

// ---------------------------------------------------------------------------
// Table: cm_finding
// ---------------------------------------------------------------------------

export const CmTaintNodeSchema = z.object({
  fileName: z.string(),
  line: z.number().int(),
  column: z.number().int().optional(),
  name: z.string().optional(),
  fullName: z.string().optional(),
});
export type CmTaintNode = z.infer<typeof CmTaintNodeSchema>;

export const CmFindingSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  source: CmSourceSchema,
  severity: CmSeveritySchema,
  rule: z.string().nullable(),
  package: z.string().nullable(),
  currentVersion: z.string().nullable(),
  fixedVersion: z.string().nullable(),
  upgradeImpact: CmUpgradeImpactSchema.nullable(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  fingerprint: z.string(),
  fixStatus: CmFixStatusSchema,
  fixAttempts: z.number().int(),
  fixNotes: z.string().nullable(),
  description: z.string().nullable(),
  taintFlow: z.array(CmTaintNodeSchema).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CmFinding = z.infer<typeof CmFindingSchema>;

export const CmFindingRowSchema = z.object({
  id: z.string().uuid(),
  scan_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  source: z.string(),
  severity: z.string(),
  rule: z.string().nullable(),
  package: z.string().nullable(),
  current_version: z.string().nullable(),
  fixed_version: z.string().nullable(),
  upgrade_impact: z.string().nullable(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  fingerprint: z.string(),
  fix_status: z.string(),
  fix_attempts: z.number().int(),
  fix_notes: z.string().nullable(),
  description: z.string().nullable(),
  taint_flow: z.array(CmTaintNodeSchema).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CmFindingRow = z.infer<typeof CmFindingRowSchema>;

// ---------------------------------------------------------------------------
// Table: cm_report
// ---------------------------------------------------------------------------

export const CmReportSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  path: z.string(),
  format: z.string(),
  createdAt: z.string(),
});
export type CmReport = z.infer<typeof CmReportSchema>;

export const CmReportRowSchema = z.object({
  id: z.string().uuid(),
  scan_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  path: z.string(),
  format: z.string(),
  created_at: z.string(),
});
export type CmReportRow = z.infer<typeof CmReportRowSchema>;

// ---------------------------------------------------------------------------
// Fix plan (emitted by cm-fix-planner agent, persisted to cm_finding.fix_notes)
// ---------------------------------------------------------------------------

export const CmFixStrategySchema = z.enum(["upgrade", "mitigate", "code-fix", "skip", "needs-human"]);
export type CmFixStrategy = z.infer<typeof CmFixStrategySchema>;

export const CmMitigationKindSchema = z.enum(["override", "resolution", "dependency-management", "alias", "replacement", "none"]);
export type CmMitigationKind = z.infer<typeof CmMitigationKindSchema>;

export const CmCategorySchema = z.enum(["frontend", "backend", "shared", "infra"]);
export type CmCategory = z.infer<typeof CmCategorySchema>;

export const CmFixPlanItemSchema = z.object({
  fingerprint: z.string(),
  strategy: CmFixStrategySchema,
  category: CmCategorySchema,
  reachable: z.boolean(),
  exploitable: z.boolean(),
  falsePositive: z.boolean().default(false),
  mitigationKind: CmMitigationKindSchema.optional(),
  priority: z.number().int().min(1).max(10),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
  targetVersion: z.string().optional(),
});
export type CmFixPlanItem = z.infer<typeof CmFixPlanItemSchema>;

export const CmFixPlanSchema = z.object({
  findings: z.array(CmFixPlanItemSchema),
});
export type CmFixPlan = z.infer<typeof CmFixPlanSchema>;

// ---------------------------------------------------------------------------
// Snake ↔ Camel mappers
// ---------------------------------------------------------------------------

export function cmPipelineRowToEntity(row: CmPipelineRow): CmPipeline {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    enabled: row.enabled,
    cron: row.cron,
    discoveryNamePrefix: row.discovery_name_prefix,
    discoveryConfigPath: row.discovery_config_path,
    severityThreshold: row.severity_threshold as CmSeverity[],
    scaTestPolicy: row.sca_test_policy as CmScaTestPolicy,
    fixBranch: row.fix_branch,
    reportDir: row.report_dir,
    retryCooldownSeconds: row.retry_cooldown_seconds,
    maxFixAttempts: row.max_fix_attempts,
    branchExcludePattern: row.branch_exclude_pattern,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function cmPipelineEntityToRow(entity: CmPipeline): CmPipelineRow {
  return {
    id: entity.id,
    workspace_id: entity.workspaceId,
    name: entity.name,
    enabled: entity.enabled,
    cron: entity.cron,
    discovery_name_prefix: entity.discoveryNamePrefix,
    discovery_config_path: entity.discoveryConfigPath,
    severity_threshold: entity.severityThreshold,
    sca_test_policy: entity.scaTestPolicy,
    fix_branch: entity.fixBranch,
    report_dir: entity.reportDir,
    retry_cooldown_seconds: entity.retryCooldownSeconds,
    max_fix_attempts: entity.maxFixAttempts,
    branch_exclude_pattern: entity.branchExcludePattern,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}

export function cmRepoRowToEntity(row: CmRepoRow): CmRepo {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    workspaceId: row.workspace_id,
    owner: row.owner,
    name: row.name,
    defaultBranch: row.default_branch,
    source: row.source as CmRepoSource,
    priority: row.priority,
    enabled: row.enabled,
    runConfig: row.run_config as Record<string, unknown> | null,
    lastScanId: row.last_scan_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function cmRepoEntityToRow(entity: CmRepo): CmRepoRow {
  return {
    id: entity.id,
    pipeline_id: entity.pipelineId,
    workspace_id: entity.workspaceId,
    owner: entity.owner,
    name: entity.name,
    default_branch: entity.defaultBranch,
    source: entity.source,
    priority: entity.priority,
    enabled: entity.enabled,
    run_config: entity.runConfig,
    last_scan_id: entity.lastScanId,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}

export function cmScanRowToEntity(row: CmScanRow): CmScan {
  return {
    id: row.id,
    repoId: row.repo_id,
    workspaceId: row.workspace_id,
    status: row.status as CmScanStatus,
    provider: row.provider,
    externalScanId: row.external_scan_id,
    branchScanned: row.branch_scanned,
    trigger: row.trigger as CmTrigger,
    findingsTotal: row.findings_total,
    findingsActionable: row.findings_actionable,
    error: row.error,
    currentStep: row.current_step,
    prUrl: row.pr_url,
    reportPath: row.report_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function cmScanEntityToRow(entity: CmScan): CmScanRow {
  return {
    id: entity.id,
    repo_id: entity.repoId,
    workspace_id: entity.workspaceId,
    status: entity.status,
    provider: entity.provider,
    external_scan_id: entity.externalScanId,
    branch_scanned: entity.branchScanned,
    trigger: entity.trigger,
    findings_total: entity.findingsTotal,
    findings_actionable: entity.findingsActionable,
    error: entity.error,
    current_step: entity.currentStep,
    pr_url: entity.prUrl,
    report_path: entity.reportPath,
    started_at: entity.startedAt,
    finished_at: entity.finishedAt,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}

export function cmFindingRowToEntity(row: CmFindingRow): CmFinding {
  return {
    id: row.id,
    scanId: row.scan_id,
    workspaceId: row.workspace_id,
    source: row.source as CmSource,
    severity: row.severity as CmSeverity,
    rule: row.rule,
    package: row.package,
    currentVersion: row.current_version,
    fixedVersion: row.fixed_version,
    upgradeImpact: row.upgrade_impact as CmUpgradeImpact | null,
    file: row.file,
    line: row.line,
    fingerprint: row.fingerprint,
    fixStatus: row.fix_status as CmFixStatus,
    fixAttempts: row.fix_attempts,
    fixNotes: row.fix_notes,
    description: row.description,
    taintFlow: row.taint_flow,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function cmFindingEntityToRow(entity: CmFinding): CmFindingRow {
  return {
    id: entity.id,
    scan_id: entity.scanId,
    workspace_id: entity.workspaceId,
    source: entity.source,
    severity: entity.severity,
    rule: entity.rule,
    package: entity.package,
    current_version: entity.currentVersion,
    fixed_version: entity.fixedVersion,
    upgrade_impact: entity.upgradeImpact,
    file: entity.file,
    line: entity.line,
    fingerprint: entity.fingerprint,
    fix_status: entity.fixStatus,
    fix_attempts: entity.fixAttempts,
    fix_notes: entity.fixNotes,
    description: entity.description,
    taint_flow: entity.taintFlow,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}

export function cmReportRowToEntity(row: CmReportRow): CmReport {
  return {
    id: row.id,
    scanId: row.scan_id,
    workspaceId: row.workspace_id,
    path: row.path,
    format: row.format,
    createdAt: row.created_at,
  };
}

export function cmReportEntityToRow(entity: CmReport): CmReportRow {
  return {
    id: entity.id,
    scan_id: entity.scanId,
    workspace_id: entity.workspaceId,
    path: entity.path,
    format: entity.format,
    created_at: entity.createdAt,
  };
}
