import { z } from "zod";

// ---------------------------------------------------------------------------
// Scout
// ---------------------------------------------------------------------------

export const PainEvidenceSchema = z.object({
  quote: z.string(),
  source: z.string(),
});

export const IdeaScoresSchema = z.object({
  pain_severity: z.number(),
  market_size: z.number(),
  competition_gap: z.number(),
  buildability: z.number(),
  distribution: z.number(),
  opportunity_score: z.number(),
});

export const IdeaItemSchema = z.object({
  rank: z.number().int(),
  title: z.string(),
  one_liner: z.string(),
  pain_evidence: z.array(PainEvidenceSchema),
  scores: IdeaScoresSchema,
  top_competitors: z.array(z.string()),
  competitor_gap: z.string(),
});
export type IdeaItem = z.infer<typeof IdeaItemSchema>;

export const IdeaSchema = z.object({
  research_areas: z.array(z.string()),
  ideas: z.array(IdeaItemSchema),
  top_5_ids: z.array(z.number().int()),
});
export type IdeaResult = z.infer<typeof IdeaSchema>;

// ---------------------------------------------------------------------------
// Executioner
// ---------------------------------------------------------------------------

export const KillScenarioSchema = z.object({
  test: z.string(),
  finding: z.string(),
  severity: z.enum(["none", "low", "medium", "fatal"]),
});

export const ExecutionerResultItemSchema = z.object({
  idea_rank: z.number().int(),
  title: z.string(),
  verdict: z.enum(["survived", "killed"]),
  kill_scenarios: z.array(KillScenarioSchema),
  survival_reasoning: z.string(),
});

export const ExecutionerSchema = z.object({
  results: z.array(ExecutionerResultItemSchema),
  survivors: z.array(z.number().int()),
  killed: z.array(z.number().int()),
  kill_reasons: z.record(z.string()),
});
export type ExecutionerResult = z.infer<typeof ExecutionerSchema>;

// ---------------------------------------------------------------------------
// Advocate
// ---------------------------------------------------------------------------

export const AdvocateSchema = z.object({
  idea_title: z.string(),
  verdict: z.string(),
  timing_argument: z.object({
    why_now: z.string(),
    evidence: z.array(z.string()),
  }),
  best_execution: z.object({
    day_90: z.string(),
    first_customer_channel: z.string(),
    month_6_milestone: z.string(),
  }),
  competitive_gap: z.object({
    gap_description: z.string(),
    gap_durability: z.string(),
    gap_reasoning: z.string(),
  }),
  beachhead: z.object({
    segment: z.string(),
    size: z.string(),
    access: z.string(),
  }),
  strongest_argument: z.string(),
});
export type AdvocateResult = z.infer<typeof AdvocateSchema>;

// ---------------------------------------------------------------------------
// Adversary
// ---------------------------------------------------------------------------

export const ObjectionSchema = z.object({
  category: z.enum(["timing", "market", "competition", "execution"]),
  claim: z.string(),
  counter: z.string(),
  severity: z.enum(["fatal", "high", "medium"]),
  evidence: z.string(),
});

export const AdversarySchema = z.object({
  idea_title: z.string(),
  valid_objection: z.boolean(),
  objections: z.array(ObjectionSchema),
  fatal_objection: z.string().nullable(),
  overall_assessment: z.string(),
});
export type AdversaryResult = z.infer<typeof AdversarySchema>;

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

export const ProductReportSchema = z.object({
  product_name: z.string(),
  one_liner: z.string(),
  problem: z.string(),
  target_user: z.string(),
  value_proposition: z.string(),
  mvp_scope: z.object({
    must: z.array(z.string()),
    should: z.array(z.string()),
    wont: z.array(z.string()),
  }),
  first_5_features: z.array(z.object({
    title: z.string(),
    description: z.string(),
  })),
  beachhead: z.string(),
  success_metrics: z.array(z.string()),
  key_risks: z.array(z.string()),
});
export type ProductReport = z.infer<typeof ProductReportSchema>;

export const JudgeSchema = z.object({
  decision: z.enum(["pass", "modify", "deadlock"]),
  reasoning: z.string(),
  winning_arguments: z.array(z.string()).optional(),
  acknowledged_risks: z.array(z.string()).optional(),
  product_report: ProductReportSchema.optional(),
  modification: z.object({
    what_changes: z.string(),
    why: z.string(),
    modified_idea: z.string(),
  }).optional(),
  scout_constraints: z.object({
    avoid: z.array(z.string()),
    focus_on: z.array(z.string()),
    note: z.string(),
  }).optional(),
});
export type JudgeResult = z.infer<typeof JudgeSchema>;

// ---------------------------------------------------------------------------
// ProductManager
// ---------------------------------------------------------------------------

export const FeatureItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  acceptance_criteria: z.array(z.string()),
  priority: z.enum(["must", "should", "wont"]),
});

export const ProductManagerSchema = z.object({
  product_name: z.string(),
  one_liner: z.string(),
  tech_stack: z.string(),
  features: z.array(FeatureItemSchema),
  first_5_features: z.array(z.number().int()),
  prd_markdown: z.string(),
});
export type ProductManagerResult = z.infer<typeof ProductManagerSchema>;

// ---------------------------------------------------------------------------
// Scaffolder
// ---------------------------------------------------------------------------

export const ScaffolderFeatureJobSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  order: z.number().int(),
});

export const ScaffolderSchema = z.object({
  scaffold_completed: z.boolean(),
  files_created: z.array(z.string()),
  scaffold_notes: z.string(),
  feature_jobs: z.array(ScaffolderFeatureJobSchema),
});
export type ScaffolderResult = z.infer<typeof ScaffolderSchema>;
