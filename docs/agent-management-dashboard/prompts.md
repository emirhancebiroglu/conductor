# Agent Management Dashboard — Antigravity Prompts

Each prompt below is designed to be given to Antigravity (a senior-capable model) for implementation. Prompts provide context, scope, and constraints — but leave architectural and implementation decisions to the model.

---

## Prompt 0.1 — Database Migration

```
You are working on the Conductor project — a monorepo with a Next.js 15 dashboard app and a Node.js worker that orchestrates an 8-agent AI pipeline. The project uses Supabase for Postgres, with existing tables for projects, jobs, runs, usage_log, approvals, and worker_status.

CONTEXT:
The project currently has hardcoded agent configuration scattered across the worker codebase. We need to externalize this into a database-driven configuration system. The full implementation plan is in docs/agent-management-dashboard/plan.md.

TASK:
Create the Supabase migration file at apps/dashboard/supabase/migrations/005_agent_management.sql that:

1. Creates an `agent_config` table with fields for: id, agent_name (unique, constrained to 8 valid agent names), display_name, role, provider, model, system_prompt, skill_path, enabled (boolean), lane_override (nullable enum), order (int), created_at, updated_at. Include an updated_at trigger.

2. Creates a `provider_models` table with fields for: id, provider, model_id, display_name, capabilities (jsonb), available (boolean), created_at. Unique constraint on (provider, model_id).

3. Adds `current_agent` (text, nullable) and `current_step_message` (text, nullable) columns to the existing `jobs` table.

4. Enables RLS on both new tables with service_role full access policies.

5. Seeds provider_models with 6 rows: 4 Claude models (Sonnet 4.6, Sonnet 4.5, Opus 4.5, Haiku 3.5) and 2 OpenCode models (DeepSeek V4 Flash, Qwen 3.6 Plus).

6. Seeds agent_config with 8 rows — one for each agent (product-owner, codebase-analyst, tech-lead, backend-dev, frontend-dev, security-reviewer, code-reviewer, qa-engineer) — populated with their current hardcoded defaults from the worker source code.

CONSTRAINTS:
- Follow the existing migration style in apps/dashboard/supabase/migrations/ (see 001_initial_schema.sql for patterns)
- The system_prompt seed values should match the current inline SYSTEM_PROMPT constants from each agent file in apps/worker/src/agents/
- Use the project's naming conventions (snake_case for DB columns)
- The migration must be idempotent where possible

FILES TO READ:
- apps/dashboard/supabase/migrations/001_initial_schema.sql (style reference)
- apps/dashboard/supabase/migrations/004_worker_status.sql (style reference)
- apps/worker/src/agents/productOwner.ts (system prompt source)
- apps/worker/src/agents/codebaseAnalyst.ts (system prompt source)
- apps/worker/src/agents/techLead.ts (system prompt source)
- apps/worker/src/agents/backend.ts (system prompt source)
- apps/worker/src/agents/frontend.ts (system prompt source)
- apps/worker/src/agents/securityReviewer.ts (system prompt source)
- apps/worker/src/agents/codeReviewer.ts (system prompt source)
- apps/worker/src/agents/tester.ts (system prompt source)
- packages/core/src/types.ts (AgentNameSchema for valid agent names)

OUTPUT:
Create the migration file. Do not run it — that will be done separately.
```

---

## Prompt 0.2 — Core Types & Database Types

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
We just created the database migration for agent_config and provider_models tables. Now we need the TypeScript types and Zod schemas that map to these tables.

TASK:

1. Update packages/core/src/types.ts to add:
   - AgentConfigSchema (Zod) with camelCase fields mapping to the agent_config table columns
   - ProviderModelSchema (Zod) with camelCase fields mapping to the provider_models table columns
   - Corresponding TypeScript types via z.infer
   - Also add snake_case RowSchema variants for direct DB operations
   - Update JobSchema and JobRowSchema to include currentAgent/currentStepMessage and current_agent/current_step_message fields respectively

2. Update apps/dashboard/lib/supabase/types.ts to add:
   - agent_config table entry with Row, Insert, Update types
   - provider_models table entry with Row, Insert, Update types
   - Update the jobs table types to include the new columns

CONSTRAINTS:
- Follow the existing pattern in types.ts (camelCase for app types, snake_case for Row types)
- Follow the existing pattern in supabase/types.ts (Database type structure)
- Use the AgentNameSchema from types.ts for the agentName field
- TypeScript strict mode — no `any` unless absolutely necessary with a `// why:` comment
- The types must be compatible with Supabase's generated types structure

FILES TO READ:
- packages/core/src/types.ts (current schemas and patterns)
- apps/dashboard/lib/supabase/types.ts (current Database type)

OUTPUT:
Update both files. No new files needed.
```

---

## Prompt 1.1 — API: GET /api/agents

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The database now has agent_config and provider_models tables with seed data. We need API endpoints for the dashboard to consume.

TASK:
Create the API route at apps/dashboard/app/api/agents/route.ts that handles GET requests.

The endpoint should:
- Fetch all agent configs from the agent_config table, ordered by the order column
- Fetch currently running jobs (jobs where current_agent is not null and status is 'running')
- Return a combined response with agents array and runningJobs array

CONSTRAINTS:
- Use the server-side Supabase client (apps/dashboard/lib/supabase/server.ts)
- Use the Database type from apps/dashboard/lib/supabase/types.ts
- Use Zod schemas from @conductor/core for response validation
- Follow the existing API route patterns in the project (see apps/dashboard/app/api/jobs/route.ts for reference)
- Force dynamic rendering (export const dynamic = "force-dynamic")
- Handle errors gracefully with appropriate HTTP status codes

FILES TO READ:
- apps/dashboard/app/api/jobs/route.ts (pattern reference)
- apps/dashboard/lib/supabase/server.ts (client setup)
- apps/dashboard/lib/supabase/types.ts (Database type)
- packages/core/src/types.ts (Zod schemas)

OUTPUT:
Create the route file.
```

---

## Prompt 1.2 — API: PUT /api/agents/[name] and PATCH toggle

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
We need to be able to update agent configuration from the dashboard UI.

TASK:
Create the API route at apps/dashboard/app/api/agents/[name]/route.ts that handles:

1. PUT requests — update agent configuration
   - Accept a JSON body with optional fields: displayName, role, provider, model, systemPrompt, skillPath, laneOverride, order
   - Validate the [name] parameter against the AgentName enum
   - Validate the request body with Zod
   - Update the agent_config record where agent_name matches
   - Return the updated config

2. PATCH requests — toggle agent enabled/disabled
   - Flip the enabled boolean for the specified agent
   - Guard: reject with 400 if this would disable the last enabled agent
   - Return the updated config

CONSTRAINTS:
- Use the server-side Supabase client
- Validate all inputs with Zod
- Return appropriate HTTP status codes (200 on success, 400 on validation error, 404 if agent not found)
- Follow existing API patterns in the project
- The response should be JSON with a consistent envelope

FILES TO READ:
- apps/dashboard/app/api/jobs/route.ts (pattern reference)
- apps/dashboard/app/api/projects/[id]/route.ts (DELETE pattern reference)
- packages/core/src/types.ts (AgentNameSchema, AgentConfigSchema)

OUTPUT:
Create the route file.
```

---

## Prompt 1.3 — API: GET /api/agents/providers

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The dashboard needs to know which providers and models are available for selection.

TASK:
Create the API route at apps/dashboard/app/api/agents/providers/route.ts that handles GET requests.

The endpoint should:
- Fetch all records from the provider_models table
- Group them by provider
- Only include models where available = true
- Return a structured response with providers array, each containing name, displayName, and models array

CONSTRAINTS:
- Use the server-side Supabase client
- Follow existing API patterns
- Force dynamic rendering
- Handle errors gracefully

FILES TO READ:
- apps/dashboard/app/api/agents/route.ts (sibling route for patterns)
- packages/core/src/types.ts (ProviderModelSchema)

OUTPUT:
Create the route file.
```

---

## Prompt 2.1 — Sidebar Update

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
We need to add a new "Agents" navigation item to the dashboard sidebar.

TASK:
Update apps/dashboard/components/sidebar.tsx to add a new nav item:
- Label: "Agents"
- Href: "/dashboard/agents"
- Icon: an SVG icon in the existing Conductor style (inline SVG, 14x14, stroke-based, matching the aesthetic of existing icons)

CONSTRAINTS:
- Follow the exact pattern of existing nav items in the NAV array
- The icon should match the Conductor design language (no external icon libraries, inline SVG)
- Keep the file structure and styling identical to existing items

FILES TO READ:
- apps/dashboard/components/sidebar.tsx (current sidebar code)

OUTPUT:
Update the sidebar file.
```

---

## Prompt 2.2 — Agents Server Page

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
We need the server component for the /dashboard/agents page that fetches initial data.

TASK:
Create apps/dashboard/app/dashboard/agents/page.tsx as a Next.js server component that:
- Fetches all agent configs from the API (or directly via Supabase server client)
- Fetches the provider list with models
- Fetches currently running jobs
- Passes all this data as props to the client component (agents-client.tsx)

CONSTRAINTS:
- Use the server-side Supabase client for data fetching
- Force dynamic rendering
- Follow the pattern of existing dashboard pages (see apps/dashboard/app/dashboard/jobs/page.tsx)
- The component should be async and handle loading/error states gracefully

FILES TO READ:
- apps/dashboard/app/dashboard/jobs/page.tsx (pattern reference)
- apps/dashboard/app/dashboard/costs/page.tsx (pattern reference)
- apps/dashboard/lib/supabase/server.ts (client setup)
- packages/core/src/types.ts (schemas)

OUTPUT:
Create the page file.
```

---

## Prompt 2.3 — Agents Client Component

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
This is the main client component for the agents management page. It needs to handle state, real-time updates, and orchestrate the sub-components.

TASK:
Create apps/dashboard/app/dashboard/agents/agents-client.tsx — a "use client" component that:

- Receives initial data as props (agents, providers, runningJobs)
- Manages state for: selected agent, dirty/unsaved changes, live agent configs, live running jobs
- Sets up 3 Supabase Realtime channel subscriptions:
  1. agent_config table → UPDATE events update the agent configs list
  2. jobs table → UPDATE events on current_agent column update running jobs
  3. runs table → INSERT/UPDATE events update last run info
- Renders a two-column layout: left panel with agent list, right panel with detail
- Renders a header with page title and agent counts
- Properly cleans up Realtime channels on unmount

CONSTRAINTS:
- Use the browser Supabase client (apps/dashboard/lib/supabase/client.ts)
- Follow the Realtime subscription pattern from apps/dashboard/app/dashboard/jobs/jobs-client.tsx
- Use the Conductor design tokens (CSS variables from globals.css)
- The layout should be responsive and match the dark-mode-only aesthetic
- Keep the component focused on orchestration — delegate rendering to sub-components

FILES TO READ:
- apps/dashboard/app/dashboard/jobs/jobs-client.tsx (Realtime pattern reference)
- apps/dashboard/lib/supabase/client.ts (browser client)
- apps/dashboard/app/globals.css (design tokens)
- apps/dashboard/app/dashboard/layout.tsx (layout context)

OUTPUT:
Create the client component file.
```

---

## Prompt 2.4 — Agent Card Component

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
Each agent in the list needs a card component that shows its status, model, and click-to-select behavior.

TASK:
Create apps/dashboard/app/dashboard/agents/components/agent-card.tsx.

The component should display:
- A status indicator dot (color and animation based on agent state: running=idle green, running=amber pulse, error=red, disabled=gray dashed)
- The agent's display name
- A badge showing current provider and model
- If the agent is currently running a job, show the job title with a pulse indicator
- If disabled, show a visually distinct disabled state
- Click handler to select the agent (opens detail panel)
- Hover effect matching Conductor's surface-raised pattern

CONSTRAINTS:
- Use the Conductor design tokens from globals.css
- Follow the styling patterns from the existing job cards in jobs-client.tsx
- The component should accept props for: agent config, running status, selected state, onClick handler
- Use CSS-in-JS (inline styles with CSS variables) matching the project's existing pattern
- Include the pulse keyframe animation (already defined in globals.css)

FILES TO READ:
- apps/dashboard/app/dashboard/jobs/jobs-client.tsx (card styling reference)
- apps/dashboard/app/globals.css (design tokens, animations)
- packages/core/src/types.ts (AgentConfig type)

OUTPUT:
Create the component file.
```

---

## Prompt 2.5 — Agent Detail Panel

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
This is the main edit panel for an agent. It needs to be comprehensive but clean, allowing full configuration of an agent's properties.

TASK:
Create apps/dashboard/app/dashboard/agents/components/agent-detail.tsx.

The component should have these sections:

1. Header: agent name (read-only), back button, save/reset buttons
2. Identity: display name input, role input, pipeline order input
3. Model Selection: provider dropdown, model dropdown (cascading), lane override selector
4. System Prompt: monospace textarea with character count
5. Skill File: text input for skill_path with clear button
6. Toggle: enabled/disabled switch with label
7. Current Run Info: shows active job or last run details

State management:
- Track original config vs current (dirty state)
- Save button disabled when no changes
- On save: PUT to /api/agents/[name], show success/error
- On reset: revert to original config
- Unsaved changes warning

CONSTRAINTS:
- Use shadcn/ui components (Select, Switch, Textarea, Button, Input, Label, Separator)
- Follow Conductor's dark mode design
- Use inline styles with CSS variables matching the project pattern
- The component should be self-contained with its own state management
- Handle loading states during save

FILES TO READ:
- apps/dashboard/app/dashboard/jobs/new/page.tsx (form pattern reference)
- apps/dashboard/app/globals.css (design tokens)
- apps/dashboard/components/ui/button.tsx (shadcn button pattern)
- packages/core/src/types.ts (AgentConfig type)

OUTPUT:
Create the component file.
```

---

## Prompt 2.6 — Model Selector Component

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The agent detail panel needs a cascading provider → model selector.

TASK:
Create apps/dashboard/app/dashboard/agents/components/model-selector.tsx.

The component should:
- Accept props: current provider, current model, available providers list, onChange callback
- Render a provider select dropdown
- Render a model select dropdown that filters based on selected provider
- Each model option should show its display name and tier (premium/cheap)
- When provider changes, auto-select the first available model for that provider
- Show a visual indicator for the model's tier (premium vs cheap)

CONSTRAINTS:
- Use shadcn/ui Select component
- Follow Conductor's dark mode design
- The component should be reusable and self-contained

FILES TO READ:
- apps/dashboard/app/globals.css (design tokens)
- apps/dashboard/components/ui/ (existing shadcn components)

OUTPUT:
Create the component file.
```

---

## Prompt 2.7 — Prompt Editor Component

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The agent detail panel needs a system prompt editor.

TASK:
Create apps/dashboard/app/dashboard/agents/components/prompt-editor.tsx.

The component should:
- Render a monospace textarea for editing system prompts
- Show character count and optionally word count
- Auto-resize or have a fixed height with scroll
- Accept props: value, onChange, placeholder, character limit
- Show a warning if the prompt is very short

CONSTRAINTS:
- Use shadcn/ui Textarea component
- Use JetBrains Mono font (already loaded in the project)
- Follow Conductor's dark mode design
- Keep it simple — no syntax highlighting needed

FILES TO READ:
- apps/dashboard/app/globals.css (design tokens, font setup)

OUTPUT:
Create the component file.
```

---

## Prompt 2.8 — Agent Status Badge Component

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
We need a reusable status badge component for showing agent states.

TASK:
Create apps/dashboard/app/dashboard/agents/components/agent-status-badge.tsx.

The component should:
- Accept props: status (running | idle | error | disabled), optional job title, optional job link
- Render a dot with appropriate color and animation
- Render status text
- If job title is provided and status is running, render as a clickable link to the job detail page

CONSTRAINTS:
- Use the pulse animation from globals.css
- Match the badge styling from jobs-client.tsx StatusBadge component
- Keep it small and inline

FILES TO READ:
- apps/dashboard/app/dashboard/jobs/jobs-client.tsx (StatusBadge reference)
- apps/dashboard/app/globals.css (animations)

OUTPUT:
Create the component file.
```

---

## Prompt 2.9 — shadcn/ui Components Installation

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The agents dashboard needs several shadcn/ui components that may not be installed yet.

TASK:
Install the following shadcn/ui components in the dashboard app:
- select
- switch
- textarea
- badge
- input
- label
- separator
- toast (or sonner)
- sheet (or dialog)

Use the project's existing shadcn setup (see apps/dashboard/components.json).

CONSTRAINTS:
- Work within the existing shadcn configuration
- Do not modify the components.json file
- Install into apps/dashboard/components/ui/

FILES TO READ:
- apps/dashboard/components.json (shadcn config)
- apps/dashboard/components/ui/button.tsx (existing component for reference)

OUTPUT:
Run the installation commands. Verify each component was installed correctly.
```

---

## Prompt 2.10 — Provider Management UI

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
Users need to be able to manage providers and their models — add new providers, add/remove models, toggle availability.

TASK:
Create a provider management interface. This can be:
- A separate page at /dashboard/agents/providers, OR
- A Sheet/Dialog accessible from the agents page

The interface should:
- List all providers with their models
- Allow adding a new provider
- Allow adding a model to a provider (provider, model_id, display_name, capabilities)
- Allow removing a model
- Allow toggling a model's availability
- Allow editing a model's display name and capabilities

CONSTRAINTS:
- Use the existing API patterns (create new API routes if needed)
- Follow Conductor's dark mode design
- Use shadcn/ui components
- Validate inputs with Zod

FILES TO READ:
- apps/dashboard/app/api/agents/providers/route.ts (existing providers API)
- apps/dashboard/app/dashboard/agents/page.tsx (parent page)
- apps/dashboard/app/globals.css (design tokens)

OUTPUT:
Create the necessary files (page/component + any new API routes).
```

---

## Prompt 3.1 — Agent Config Loader (Worker)

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The worker (apps/worker/src/) currently has hardcoded agent configuration. We need a module that loads agent config from the database.

TASK:
Create apps/worker/src/agentConfig.ts.

The module should:
- Define an AgentConfig interface matching the database schema
- Implement a loadAgentConfig(supabase) function that fetches all configs from the agent_config table
- Cache the loaded configs in memory (Map<string, AgentConfig>)
- Provide a getAgentConfig(agentName) function to retrieve a single config
- Provide an invalidateConfigCache() function to clear the cache
- Handle errors gracefully (log warning, return defaults or null)

CONSTRAINTS:
- The cache should be module-level (not global)
- The supabase client is passed in (not created internally)
- Error handling should never throw — always return gracefully
- TypeScript strict mode

FILES TO READ:
- apps/worker/src/runner.ts (how supabase client is passed around)
- apps/worker/src/processJob.ts (where cache invalidation will be called)
- apps/worker/src/orchestrator.ts (where configs will be used)
- packages/core/src/types.ts (AgentConfigSchema)

OUTPUT:
Create the config loader module.
```

---

## Prompt 3.2 — Refactor Agent Files to Use Config

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
Each agent file in apps/worker/src/agents/ has a hardcoded SYSTEM_PROMPT constant. These need to be replaced with config-driven prompts.

TASK:
Update all 8 agent files:
- productOwner.ts
- codebaseAnalyst.ts
- techLead.ts
- backend.ts
- frontend.ts
- securityReviewer.ts
- codeReviewer.ts
- tester.ts

For each file:
- Remove the hardcoded SYSTEM_PROMPT constant
- Modify the run function to accept an agentConfig parameter (or load from the config loader)
- Use agentConfig.systemPrompt as the system prompt
- Use agentConfig.model for model override
- Maintain backward compatibility (if no config provided, fall back to existing behavior)

CONSTRAINTS:
- Do not change the public API signature in a breaking way — add optional config parameter
- Each agent should still work if called without a config (backward compatible)
- Keep the existing user prompt construction logic intact
- The lane resolution should still go through the router

FILES TO READ:
- apps/worker/src/agentConfig.ts (config loader)
- apps/worker/src/runner.ts (how agents call the runner)
- apps/worker/src/router.ts (lane resolution)
- Each of the 8 agent files

OUTPUT:
Update all 8 agent files.
```

---

## Prompt 3.3 — Update Runner for Config Support

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The runner (runner.ts) spawns agent processes. It needs to accept and use agent configuration.

TASK:
Update apps/worker/src/runner.ts to:

- Add agentConfig as an optional field in AgentRunOptions
- When spawning an agent process, use agentConfig.model if provided (override lane default)
- Use agentConfig.systemPrompt as the system prompt
- The lane should come from agentConfig.laneOverride if set, otherwise from the router's resolveRoute

CONSTRAINTS:
- Maintain backward compatibility — agentConfig is optional
- If no config provided, use existing hardcoded behavior
- The model override should work for both premium and cheap lanes

FILES TO READ:
- apps/worker/src/runner.ts (current code)
- apps/worker/src/agentConfig.ts (config interface)
- apps/worker/src/router.ts (lane resolution)

OUTPUT:
Update the runner file.
```

---

## Prompt 3.4 — Update Router for Lane Override

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The router (router.ts) determines which lane (cheap/premium) an agent runs on. It needs to support lane overrides from agent config.

TASK:
Update apps/worker/src/router.ts:

- Modify resolveRoute() to accept an optional agentConfig parameter
- If agentConfig.laneOverride is set, use it directly (bypass BASE_POLICY table)
- If no override, use the existing BASE_POLICY logic
- The returned model should match the lane (premium model for premium lane, cheap model for cheap lane)

CONSTRAINTS:
- Maintain backward compatibility — agentConfig is optional
- The existing BASE_POLICY behavior should be unchanged when no override is provided
- Cost limit checks (soft/hard) should still apply even with lane override

FILES TO READ:
- apps/worker/src/router.ts (current code)
- apps/worker/src/agentConfig.ts (AgentConfig interface)

OUTPUT:
Update the router file.
```

---

## Prompt 3.5 — Update Orchestrator for Config-Driven Pipeline

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The orchestrator (orchestrator.ts) runs the full 8-agent pipeline. It needs to:
1. Use agent config for each step
2. Skip disabled agents
3. Update current_agent and current_step_message on the job

TASK:
Update apps/worker/src/orchestrator.ts:

For each agent step in the pipeline:
1. Load the agent config from the config loader
2. If the agent is disabled (enabled = false), skip it with a warning log and implement appropriate fallback behavior
3. Before running the agent, update the job's current_agent and current_step_message fields
4. Pass the agent config to the agent runner
5. After the agent completes, the next step proceeds normally

Skip logic for disabled agents:
- product-owner: use job description as a minimal spec summary
- codebase-analyst: create an empty context.md with a note
- tech-lead: create a minimal plan from the spec
- backend-dev/frontend-dev: skip implementation step
- security-reviewer: skip security check (log warning)
- code-reviewer: skip code review (log warning)
- qa-engineer: skip testing, proceed to commit/PR

CONSTRAINTS:
- The pipeline should still complete (degraded) if agents are disabled
- Log warnings for each skipped agent
- The current_agent field should be cleared when the pipeline finishes
- Maintain the existing pipeline structure and error handling

FILES TO READ:
- apps/worker/src/orchestrator.ts (current pipeline code)
- apps/worker/src/agentConfig.ts (config loader)
- apps/worker/src/agents/index.ts (agent exports)
- apps/worker/src/runner.ts (updated runner interface)

OUTPUT:
Update the orchestrator file.
```

---

## Prompt 3.6 — Update ProcessJob for Cache Invalidation

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The processJob function is the entry point for each job. It needs to invalidate the agent config cache before running the pipeline.

TASK:
Update apps/worker/src/processJob.ts:

- Call invalidateConfigCache() at the start of processJob (before cloning the repo)
- In the finally block, clear the job's current_agent and current_step_message fields

CONSTRAINTS:
- The cache invalidation should happen before the pipeline starts
- The cleanup of current_agent should happen regardless of success or failure
- Maintain existing error handling

FILES TO READ:
- apps/worker/src/processJob.ts (current code)
- apps/worker/src/agentConfig.ts (invalidateConfigCache function)

OUTPUT:
Update the processJob file.
```

---

## Prompt 4.1 — Real-Time Status Integration

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The agents client component needs proper real-time status tracking. This prompt covers the Realtime subscription setup and status logic.

TASK:
Update or create the real-time status logic in the agents dashboard:

Set up 3 Supabase Realtime channels in the agents client component:

1. agent_config channel:
   - Listen for UPDATE events on agent_config table
   - When an agent config changes, update the local state
   - This reflects model changes, enable/disable toggles, etc.

2. jobs channel:
   - Listen for UPDATE events on jobs table
   - Filter for changes to current_agent column
   - Update the running jobs list in local state
   - When current_agent changes from null to a value, add to running list
   - When current_agent changes from a value to null, remove from running list

3. runs channel:
   - Listen for INSERT and UPDATE events on runs table
   - Use this to update "last run" info for each agent
   - When a run is inserted with status='started', mark that agent as running
   - When a run is updated to 'ok' or 'failed', update last run info

CONSTRAINTS:
- Follow the Realtime pattern from jobs-client.tsx
- Clean up all channels on component unmount
- Handle subscription errors gracefully
- Do not cause unnecessary re-renders

FILES TO READ:
- apps/dashboard/app/dashboard/jobs/jobs-client.tsx (Realtime pattern)
- apps/dashboard/lib/supabase/client.ts (browser client)
- apps/dashboard/app/dashboard/agents/agents-client.tsx (target file)

OUTPUT:
Update the agents client component with proper Realtime subscriptions.
```

---

## Prompt 4.2 — Running Job Link

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
When an agent is running, users should be able to click through to the job detail page.

TASK:
Update the agent card and status badge components so that:
- When an agent is currently running a job, the status indicator is a clickable link
- The link navigates to /dashboard/jobs/[jobId]
- The job title is shown alongside the status
- The link uses the Conductor amber color for hover state

CONSTRAINTS:
- Use Next.js Link component for client-side navigation
- The link should only appear when the agent is actively running
- Follow the existing link patterns in the project

FILES TO READ:
- apps/dashboard/app/dashboard/agents/components/agent-card.tsx
- apps/dashboard/app/dashboard/agents/components/agent-status-badge.tsx
- apps/dashboard/app/dashboard/jobs/jobs-client.tsx (link pattern)

OUTPUT:
Update the relevant components.
```

---

## Prompt 4.3 — Unsaved Changes Warning

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
Users should be warned if they navigate away from the agents page with unsaved changes.

TASK:
Implement unsaved changes detection and warning in the agents dashboard:

- Track dirty state in the agent detail panel (compare current values to last saved)
- Show a visual indicator when there are unsaved changes (e.g., a dot next to the save button)
- Use window.beforeunload to warn if the user tries to close/refresh the tab
- Disable navigation to other dashboard pages until changes are saved or discarded
- Provide a "Discard changes" option to revert

CONSTRAINTS:
- Use React hooks for state tracking
- The warning should be non-intrusive but visible
- Follow the Conductor design language

FILES TO READ:
- apps/dashboard/app/dashboard/agents/agents-client.tsx
- apps/dashboard/app/dashboard/agents/components/agent-detail.tsx
- apps/dashboard/components/sidebar.tsx (navigation)

OUTPUT:
Update the relevant components with unsaved changes handling.
```

---

## Prompt 4.4 — Toast Notifications

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
Users need feedback when agent config is saved or when errors occur.

TASK:
Add toast notifications to the agents dashboard:

- Success toast when agent config is saved successfully
- Error toast when save fails (with error message)
- Warning toast for validation errors (e.g., empty system prompt)
- Info toast when config changes will take effect on next job

CONSTRAINTS:
- Use shadcn/sonner or the project's existing toast setup
- Toasts should match the dark mode design
- Position toasts appropriately (top-right or top-center)
- Auto-dismiss after 4 seconds for success, 8 seconds for errors

FILES TO READ:
- apps/dashboard/app/dashboard/agents/components/agent-detail.tsx (where save happens)
- apps/dashboard/components/ui/ (check for existing toast component)
- apps/dashboard/package.json (check if sonner is installed)

OUTPUT:
Add toast integration to the save flow.
```

---

## Prompt 4.5 — Last Run Info in Detail Panel

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
The agent detail panel should show the last run information for the selected agent.

TASK:
Update the agent detail panel to display:

- The most recent run for this agent (from the runs table)
- Run status (ok/failed/started)
- Time since the run completed
- The job title that the run was for (as a clickable link)
- If the agent is currently running, show the active job instead

CONSTRAINTS:
- Fetch last run data from Supabase (or from Realtime updates)
- Update in real-time via the runs channel subscription
- Format relative times (e.g., "2m ago")
- Follow the Conductor design language

FILES TO READ:
- apps/dashboard/app/dashboard/agents/components/agent-detail.tsx
- apps/dashboard/app/dashboard/jobs/jobs-client.tsx (formatRelative function)
- packages/core/src/types.ts (RunRowSchema)

OUTPUT:
Update the agent detail component.
```

---

## Prompt 5.1 — Pipeline Validation & Edge Cases

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
We need to handle edge cases and validation for the agent management system.

TASK:
Implement the following validation and edge case handling:

1. API validation — PATCH /api/agents/[name]/toggle:
   - Reject with 400 if disabling the last enabled agent
   - Return a descriptive error message

2. API validation — PUT /api/agents/[name]:
   - Validate systemPrompt is not empty (min length 10 chars)
   - Validate model exists in provider_models table for the selected provider
   - Validate laneOverride is a valid value

3. Worker validation:
   - At pipeline start, check that at least one agent is enabled
   - If no agents are enabled, fail the job with a descriptive error

4. UI validation:
   - Show warning in the agents dashboard if all agents are disabled
   - Show warning if a selected model is no longer available

CONSTRAINTS:
- Validation errors should be user-friendly
- The system should never be left in a broken state
- Log warnings for all validation failures

FILES TO READ:
- apps/dashboard/app/api/agents/[name]/route.ts
- apps/worker/src/orchestrator.ts
- apps/dashboard/app/dashboard/agents/components/agent-detail.tsx

OUTPUT:
Update the relevant files with validation logic.
```

---

## Prompt 5.2 — E2E Tests

```
You are working on the Conductor project. The full implementation plan is in docs/agent-management-dashboard/plan.md.

CONTEXT:
We need Playwright E2E tests for the new agents management page.

TASK:
Create E2E tests for the agents dashboard:

Test scenarios:
1. Navigate to /dashboard/agents and verify all 8 agents are displayed
2. Click on an agent and verify the detail panel opens with correct data
3. Toggle an agent enabled/disabled and verify the change persists
4. Change the model selection and save, verify the change persists
5. Edit the system prompt and save, verify the change persists
6. Verify real-time status updates (simulate a running agent)
7. Verify the provider/model selector works correctly (cascade behavior)

CONSTRAINTS:
- Follow the existing E2E test patterns in the project
- Use Playwright
- Tests should be idempotent (not depend on order)
- Use test fixtures where needed
- Tests should work in CI

FILES TO READ:
- apps/dashboard/tests/ (existing E2E tests)
- apps/dashboard/playwright.config.ts (if exists)
- apps/dashboard/package.json (test scripts)

OUTPUT:
Create the E2E test file(s).
```
