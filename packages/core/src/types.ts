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
  "waiting_input",
  "decomposed",
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
  "codebase-analyst",
  "tech-lead",
  "backend-dev",
  "frontend-dev",
  "security-reviewer",
  "code-reviewer",
  "qa-engineer",
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

// ---------------------------------------------------------------------------
// Handoff schemas (pipeline data contracts between agents)
// ---------------------------------------------------------------------------

export const ResearchNoteSchema = z.object({
  claim: z.string(),
  source: z.string(),
});
export type ResearchNote = z.infer<typeof ResearchNoteSchema>;

export const SpecSchema = z.object({
  summary: z.string(),
  user_stories: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  open_questions: z.array(z.string()),
  research_notes: z.array(ResearchNoteSchema),
});
export type Spec = z.infer<typeof SpecSchema>;

export const SubFeatureSchema = z.object({
  title: z.string(),
  description: z.string(),
});
export type SubFeature = z.infer<typeof SubFeatureSchema>;

export const ApiEndpointSchema = z.object({
  method: z.string(),
  path: z.string(),
  description: z.string(),
  request_body: z.unknown().optional(),
  response: z.unknown().optional(),
});
export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;

export const ApiContractSchema = z.object({
  shared_types: z.array(z.string()),
  endpoints: z.array(ApiEndpointSchema),
});
export type ApiContract = z.infer<typeof ApiContractSchema>;

const PLAN_TASK_AREA_MAP: Record<string, "backend" | "frontend" | "shared" | "infra"> = {
  config: "infra", lib: "shared", types: "shared", hook: "frontend",
  test: "shared", util: "shared", db: "backend", api: "backend",
};

// z.enum().catch() preserves the literal union output type (unlike z.string().transform)
export const PlanTaskSchema = z.object({
  id: z.string(),
  area: z.preprocess(
    (v) => {
      const s = String(v);
      const known = ["backend", "frontend", "shared", "infra"];
      return known.includes(s) ? s : (PLAN_TASK_AREA_MAP[s] ?? "shared");
    },
    z.enum(["backend", "frontend", "shared", "infra"]),
  ),
  desc: z.string(),
  acceptance: z.string(),
});
export type PlanTask = z.infer<typeof PlanTaskSchema>;

export const PlanSchema = z.object({
  approach: z.string(),
  complexity: z.enum(["simple", "medium", "complex"]),
  sub_features: z.array(SubFeatureSchema).nullable(),
  affected_modules: z.array(z.string()),
  api_contract: ApiContractSchema,
  tasks: z.array(PlanTaskSchema),
  branch: z.string(),
  needs_migration: z.boolean(),
  migration: z.string().nullable(),
  risks: z.array(z.string()),
});
export type Plan = z.infer<typeof PlanSchema>;

const SEC_SEVERITY_MAP: Record<string, "critical" | "high" | "med"> = {
  medium: "med", moderate: "med",
};
const SEC_CATEGORY_MAP: Record<string, "auth" | "injection" | "exposure" | "secret" | "other"> = {
  data_exposure: "exposure", "data-exposure": "exposure",
  sql_injection: "injection", "sql-injection": "injection",
  xss: "injection", secrets: "secret",
};

export const SecurityIssueSchema = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  severity: z
    .string()
    .transform((v): "critical" | "high" | "med" => {
      const mapped = SEC_SEVERITY_MAP[v];
      if (mapped) return mapped;
      if (v === "critical" || v === "high" || v === "med") return v;
      return "med";
    }),
  category: z
    .string()
    .transform((v): "auth" | "injection" | "exposure" | "secret" | "other" => {
      const mapped = SEC_CATEGORY_MAP[v];
      if (mapped) return mapped;
      if (v === "auth" || v === "injection" || v === "exposure" || v === "secret" || v === "other") return v;
      return "other";
    }),
  problem: z.string(),
  fix: z.string(),
});
export type SecurityIssue = {
  file: string;
  line: number | null;
  severity: "critical" | "high" | "med";
  category: "auth" | "injection" | "exposure" | "secret" | "other";
  problem: string;
  fix: string;
};

export const SecurityReviewSchema = z.object({
  passed: z.boolean(),
  escalate_to_tech_lead: z.boolean(),
  issues: z.array(SecurityIssueSchema),
});
export type SecurityReview = {
  passed: boolean;
  escalate_to_tech_lead: boolean;
  issues: SecurityIssue[];
};

export const ReviewIssueSchema = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  severity: z
    .string()
    .transform((v): "high" | "med" | "low" => {
      if (v === "medium" || v === "moderate") return "med";
      if (v === "high" || v === "med" || v === "low") return v;
      return "med";
    }),
  problem: z.string(),
  fix: z.string(),
  owner: z.enum(["frontend", "backend"]),
});
export type ReviewIssue = {
  file: string;
  line: number | null;
  severity: "high" | "med" | "low";
  problem: string;
  fix: string;
  owner: "frontend" | "backend";
};

export const ReviewSchema = z.object({
  approved: z.boolean(),
  escalate: z.boolean(),
  issues: z.array(ReviewIssueSchema),
});
export type Review = {
  approved: boolean;
  escalate: boolean;
  issues: ReviewIssue[];
};

export const TestResultSchema = z.object({
  passed: z.boolean(),
  needs_human: z.boolean(),
  unit: z.object({ added: z.number().int(), passing: z.number().int() }),
  e2e: z.object({ scenarios: z.number().int(), passing: z.number().int() }),
  failures: z.array(z.string()),
  commit_message: z.string(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

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
  parentJobId: z.string().uuid().nullable(),
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
  parent_job_id: z.string().uuid().nullable(),
  type: JobTypeSchema,
  title: z.string(),
  description: z.string(),
  lane_preference: LanePreferenceSchema,
  status: JobStatusSchema,
  branch: z.string().nullable(),
  pr_url: z.string().nullable(),
  spec: z.unknown().nullable(),
  plan: z.unknown().nullable(),
  answers: z.record(z.string()).nullable(),
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
