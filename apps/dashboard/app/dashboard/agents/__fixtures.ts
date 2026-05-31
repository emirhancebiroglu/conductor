import type { AgentConfig, AgentCategory, ProviderModel, RunningJob } from "@conductor/core";

const NOW = new Date().toISOString();

// ---------------------------------------------------------------------------
// 4 default categories
// ---------------------------------------------------------------------------

export const FIXTURE_CATEGORIES: AgentCategory[] = [
  { id: "10000000-0000-0000-0000-000000000001", name: "Planning",     slug: "planning",     color: "#818cf8", description: "Spec, analysis, and architecture agents", order: 1, createdAt: NOW },
  { id: "10000000-0000-0000-0000-000000000002", name: "Development",  slug: "development",  color: "#34d399", description: "Backend and frontend implementation agents", order: 2, createdAt: NOW },
  { id: "10000000-0000-0000-0000-000000000003", name: "Quality",      slug: "quality",      color: "#f59e0b", description: "Code review, testing, and validation agents", order: 3, createdAt: NOW },
  { id: "10000000-0000-0000-0000-000000000004", name: "Security",     slug: "security",     color: "#f87171", description: "Security audit and hardening agents", order: 4, createdAt: NOW },
];

// ---------------------------------------------------------------------------
// 8 Agent configs matching the seed data
// ---------------------------------------------------------------------------

export const FIXTURE_AGENTS: AgentConfig[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    agentName: "product-owner",
    displayName: "Product Owner",
    role: "Gathers requirements, creates spec, defines acceptance criteria",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a Product Owner agent. Analyze the feature request and produce a detailed spec.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000001",
    enabled: true,
    laneOverride: null,
    order: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    agentName: "codebase-analyst",
    displayName: "Codebase Analyst",
    role: "Analyzes existing codebase for context and architecture",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a Codebase Analyst. Examine the codebase and produce a context document.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000001",
    enabled: true,
    laneOverride: null,
    order: 2,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440003",
    agentName: "tech-lead",
    displayName: "Tech Lead",
    role: "Creates technical implementation plan",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a Tech Lead. Create a detailed implementation plan from the spec.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000001",
    enabled: true,
    laneOverride: null,
    order: 3,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440004",
    agentName: "backend-dev",
    displayName: "Backend Developer",
    role: "Implements backend changes",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a Backend Developer. Implement the backend changes according to the plan.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000002",
    enabled: true,
    laneOverride: null,
    order: 4,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440005",
    agentName: "frontend-dev",
    displayName: "Frontend Developer",
    role: "Implements frontend changes",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a Frontend Developer. Implement the frontend changes according to the plan.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000002",
    enabled: true,
    laneOverride: null,
    order: 5,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440006",
    agentName: "security-reviewer",
    displayName: "Security Reviewer",
    role: "Reviews code for security vulnerabilities",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a Security Reviewer. Review the implementation for security issues.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000004",
    enabled: true,
    laneOverride: null,
    order: 6,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440007",
    agentName: "code-reviewer",
    displayName: "Code Reviewer",
    role: "Reviews code quality and best practices",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a Code Reviewer. Review the code for quality, patterns, and best practices.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000003",
    enabled: true,
    laneOverride: null,
    order: 7,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440008",
    agentName: "qa-engineer",
    displayName: "QA Engineer",
    role: "Writes and runs tests",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a QA Engineer. Write and run tests to verify the implementation.",
    skillContent: null,
    categoryId: "10000000-0000-0000-0000-000000000003",
    enabled: true,
    laneOverride: null,
    order: 8,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

// ---------------------------------------------------------------------------
// Provider models (6 models across 2 providers)
// ---------------------------------------------------------------------------

export const FIXTURE_PROVIDER_MODELS: ProviderModel[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440010",
    provider: "claude",
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    capabilities: { context_window: 200000, tier: "premium" },
    available: true,
    createdAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440011",
    provider: "claude",
    modelId: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    capabilities: { context_window: 200000, tier: "premium" },
    available: true,
    createdAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440012",
    provider: "claude",
    modelId: "claude-haiku-4-6",
    displayName: "Claude Haiku 4.6",
    capabilities: { context_window: 200000, tier: "cheap" },
    available: true,
    createdAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440013",
    provider: "opencode",
    modelId: "opencode-go/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash (OpenCode Go)",
    capabilities: { context_window: 128000, tier: "cheap" },
    available: true,
    createdAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440014",
    provider: "opencode",
    modelId: "opencode-go/deepseek-v4",
    displayName: "DeepSeek V4 (OpenCode Go)",
    capabilities: { context_window: 128000, tier: "cheap" },
    available: true,
    createdAt: NOW,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440015",
    provider: "opencode",
    modelId: "opencode-go/qwen3.6-plus",
    displayName: "Qwen 3.6 Plus (OpenCode Go)",
    capabilities: { context_window: 128000, tier: "cheap" },
    available: true,
    createdAt: NOW,
  },
];

// ---------------------------------------------------------------------------
// Running jobs (empty for default, populated for "with_running" variant)
// ---------------------------------------------------------------------------

export const FIXTURE_RUNNING_JOBS: RunningJob[] = [];

export const FIXTURE_RUNNING_JOBS_WITH_RUNNING: RunningJob[] = [
  {
    jobId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    jobTitle: "Add user authentication",
    agentName: "backend-dev",
    startedAt: NOW,
    stepMessage: "Implementing backend changes",
  },
  {
    jobId: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    jobTitle: "Add login page",
    agentName: "frontend-dev",
    startedAt: NOW,
    stepMessage: "Implementing frontend changes",
  },
];
