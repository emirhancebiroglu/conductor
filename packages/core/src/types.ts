import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives / enums
// ---------------------------------------------------------------------------

export const LanePreferenceSchema = z.enum(["auto", "cheap", "premium"]);
export type LanePreference = z.infer<typeof LanePreferenceSchema>;

export const LaneSchema = z.enum(["cheap", "premium"]);
export type Lane = z.infer<typeof LaneSchema>;

export const JobTypeSchema = z.enum(["feature", "idea"]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "review_loop",
  "test_loop",
  "pr_opened",
  "merged",
  "failed",
  "needs_human",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const AgentNameSchema = z.enum([
  "product-owner",
  "architect",
  "frontend",
  "backend",
  "code-reviewer",
  "tester",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

export const RunStatusSchema = z.enum(["started", "ok", "retry", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ApprovalKindSchema = z.enum(["db_migration", "merge", "external_post"]);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

// ---------------------------------------------------------------------------
// Embedded JSON column shapes (spec / plan inside jobs)
// ---------------------------------------------------------------------------

export const SpecSchema = z.object({
  acceptanceCriteria: z.array(z.string()),
  notes: z.string().optional(),
});
export type Spec = z.infer<typeof SpecSchema>;

export const PlanTaskSchema = z.object({
  id: z.string(),
  agent: AgentNameSchema,
  description: z.string(),
});
export type PlanTask = z.infer<typeof PlanTaskSchema>;

export const PlanSchema = z.object({
  tasks: z.array(PlanTaskSchema),
  apiContract: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// Table: projects
// ---------------------------------------------------------------------------

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  repo: z.string(),
  defaultBranch: z.string(),
  createdAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Raw DB row (snake_case) */
export const ProjectRowSchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  repo: z.string(),
  default_branch: z.string(),
  created_at: z.string(),
});
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

// ---------------------------------------------------------------------------
// Table: jobs
// ---------------------------------------------------------------------------

export const JobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: JobTypeSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  lanePreference: LanePreferenceSchema,
  status: JobStatusSchema,
  branch: z.string().nullable(),
  prUrl: z.string().url().nullable(),
  spec: SpecSchema.nullable(),
  plan: PlanSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Job = z.infer<typeof JobSchema>;

/** Raw DB row (snake_case) */
export const JobRowSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  type: JobTypeSchema,
  title: z.string(),
  description: z.string(),
  lane_preference: LanePreferenceSchema,
  status: JobStatusSchema,
  branch: z.string().nullable(),
  pr_url: z.string().nullable(),
  spec: z.unknown().nullable(),
  plan: z.unknown().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobRow = z.infer<typeof JobRowSchema>;

export const CreateJobSchema = z.object({
  projectId: z.string().uuid(),
  type: JobTypeSchema.default("feature"),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  lanePreference: LanePreferenceSchema.default("auto"),
});
export type CreateJob = z.infer<typeof CreateJobSchema>;

// ---------------------------------------------------------------------------
// Table: runs
// ---------------------------------------------------------------------------

export const RunSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  agent: AgentNameSchema,
  lane: LaneSchema.nullable(),
  model: z.string().nullable(),
  status: RunStatusSchema,
  input: z.record(z.unknown()).nullable(),
  output: z.record(z.unknown()).nullable(),
  log: z.string().nullable(),
  iteration: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type Run = z.infer<typeof RunSchema>;

/** Raw DB row (snake_case) */
export const RunRowSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  agent: AgentNameSchema,
  lane: LaneSchema.nullable(),
  model: z.string().nullable(),
  status: RunStatusSchema,
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  log: z.string().nullable(),
  iteration: z.number().int(),
  created_at: z.string(),
});
export type RunRow = z.infer<typeof RunRowSchema>;

// ---------------------------------------------------------------------------
// Table: usage_log
// ---------------------------------------------------------------------------

export const UsageLogSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  estCostUsd: z.number().nullable(),
  createdAt: z.string().datetime(),
});
export type UsageLog = z.infer<typeof UsageLogSchema>;

/** Raw DB row (snake_case) */
export const UsageLogRowSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  est_cost_usd: z.number().nullable(),
  created_at: z.string(),
});
export type UsageLogRow = z.infer<typeof UsageLogRowSchema>;

// ---------------------------------------------------------------------------
// Table: approvals
// ---------------------------------------------------------------------------

export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  kind: ApprovalKindSchema,
  payload: z.record(z.unknown()).nullable(),
  status: ApprovalStatusSchema,
  decidedAt: z.string().datetime().nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/** Raw DB row (snake_case) */
export const ApprovalRowSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  kind: ApprovalKindSchema,
  payload: z.unknown().nullable(),
  status: ApprovalStatusSchema,
  decided_at: z.string().nullable(),
});
export type ApprovalRow = z.infer<typeof ApprovalRowSchema>;
