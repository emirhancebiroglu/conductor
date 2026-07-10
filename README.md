# Conductor

<p align="center">
  <img alt="Conductor" src="https://img.shields.io/badge/Conductor-AI%20Orchestration%20Platform-0f172a?style=for-the-badge" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth%20%2B%20Realtime-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-Workspace-F69220?style=for-the-badge&logo=pnpm&logoColor=white" />
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-Unit%20Testing-6E9F18?style=flat-square&logo=vitest&logoColor=white" />
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-E2E%20Testing-2EAD33?style=flat-square&logo=playwright&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-111827?style=flat-square" />
</p>

> AI-assisted delivery for GitHub repositories: plan a feature, coordinate the right agents, test the result, and open a PR for human review. The same platform also powers an automated Checkmarx scan-and-fix workflow.

## What Is In This Repo

Conductor is a monorepo for two related automation systems:

1. Feature pipeline
   - A user selects a GitHub repository, writes a feature request, and the system turns that request into a structured job.
   - An agent team can then plan, implement, review, and test the change.
   - The pipeline stops at a pull request. A human always performs the final merge.

2. CM pipeline
   - A Checkmarx-driven scan-and-fix workflow for critical and high-severity findings.
   - The pipeline can scan, plan fixes, apply changes, rescan, and produce reports.
   - It does not auto-open PRs or auto-merge code. Human review remains the final gate.

3. Shared platform pieces
   - Dashboard, worker services, shared packages, database migrations, skills, and operational docs.

## At A Glance

```text
Feature request -> spec -> plan -> implement -> review -> test -> PR
Security finding -> scan -> plan -> fix -> rescan -> report
```

| Area | Purpose | Location |
| --- | --- | --- |
| Dashboard | GitHub connection, job creation, live status, approvals, and operator UI | `apps/dashboard` |
| Main worker | Feature orchestration, agent execution, branch creation, and PR opening | `apps/worker` |
| CM worker | Checkmarx scan, fix, verify, and reporting pipeline | `apps/cm-worker` |
| Shared packages | Core types, agent routing, GitHub helpers, and adapters | `packages/*` |
| Docs and guardrails | Architecture, stack, plans, risks, and operating rules | `docs/`, `CLAUDE.md` |

## Why This Exists

The goal is to reduce the time from "idea" to "reviewable code" while keeping a strict human gate at merge time. In practice, that means:

- less repetitive setup work
- faster feedback loops
- structured agent handoffs
- better visibility into cost, logs, and job state
- safer automation for sensitive tasks such as migrations and security remediation

## Architecture

Conductor follows a two-plane model:

- Control plane: the Next.js dashboard and Supabase-backed state.
- Execution plane: long-running workers that orchestrate agents, tools, git operations, and PR creation.

The design assumes that some tasks need a real machine with a persistent filesystem and shell access, so the worker side is intentionally not serverless.

For the full architecture, see [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md).

## Tech Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript, strict mode |
| Dashboard | Next.js 15 with App Router |
| UI | Tailwind CSS, shadcn/ui, Radix UI |
| Database, auth, realtime | Supabase |
| Main worker runtime | Node.js 22+ |
| Testing | Vitest, Playwright |
| GitHub integration | Octokit / GitHub App flows |
| Validation | Zod |
| Package management | pnpm workspaces |

See [`docs/02_TECH_STACK.md`](docs/02_TECH_STACK.md) for the reasoning behind each choice.

## Repository Layout

```text
conductor/
|-- apps/
|   |-- dashboard/      # Operator UI and API routes
|   |-- worker/         # Feature pipeline execution worker
|   `-- cm-worker/      # Checkmarx scan-and-fix worker
|-- packages/
|   |-- core/           # Shared types, schemas, and state machines
|   |-- agents/         # Agent orchestration helpers
|   |-- github/         # GitHub helpers and Octokit wrapper
|   |-- cm-core/        # CM pipeline types and state machines
|   `-- cm-adapters/    # CM pipeline runners and adapters
|-- docs/               # Architecture, planning, and guardrails
|-- skills/             # Agent skills used by the workers
|-- supabase/           # Database migrations and schema assets
`-- CLAUDE.md           # Root operating rules for agents
```

## Requirements

- Node.js 22 or newer
- pnpm 9 or newer
- A Supabase project
- A GitHub token or GitHub App setup with repository access
- Optional, depending on what you run:
  - OpenCode Go credentials
  - Claude Code access
  - Checkmarx One credentials

## Quick Start

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create local environment files:

   - Root example: `./.env.local.example`
   - Dashboard example: `apps/dashboard/.env.local.example`
   - CM worker example: `apps/cm-worker/.env.local.example`

   Copy the relevant example files to `.env.local` in each app you want to run, then fill in the values.

3. Push the Supabase schema:

   ```bash
   pnpm db:push
   ```

4. Start the dashboard:

   ```bash
   pnpm dev
   ```

5. Start the execution worker in a second terminal when you want end-to-end feature runs:

   ```bash
   pnpm --filter worker dev
   ```

6. Start the CM worker in a third terminal if you are working on the Checkmarx pipeline:

   ```bash
   pnpm --filter cm-worker dev
   ```

7. Open the dashboard at `http://localhost:3000`.

## Environment Variables

The exact variable set depends on the app you are running. The example files in the repo are the source of truth, but the following are the main ones:

### Dashboard

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for the browser and server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anonymous Supabase key for the dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin access for privileged operations |
| `GITHUB_TOKEN` | GitHub PAT used by server-side routes |

### Main worker

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `OPENCODE_GO_KEY` | OpenCode Go or related runner credentials |
| `MAX_REVIEW_LOOPS` | Upper bound for review iterations |
| `MAX_TEST_LOOPS` | Upper bound for test iterations |
| `TAVILY_API_KEY` | Web search provider for research steps |

### CM worker

| Variable | Purpose |
| --- | --- |
| `CM_DATABASE_URL` | Postgres connection string used by the queue and worker |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GITHUB_TOKEN` | GitHub token for PR and branch operations |
| `CM_SCAN_PROVIDER` | `mock` in development, `checkmarx` in production |
| `CM_AGENT_RUNNER` | `stub` in development, `claude` in production |
| `CX_BASE_URI` | Checkmarx base URL, when using the real provider |
| `CX_TENANT` | Checkmarx tenant, when using the real provider |
| `CX_APIKEY` | Checkmarx API key, when using the real provider |

If you are only using the feature pipeline, you do not need the Checkmarx-specific variables.

## Useful Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the dashboard |
| `pnpm --filter worker dev` | Starts the main feature worker |
| `pnpm --filter cm-worker dev` | Starts the CM pipeline worker |
| `pnpm build` | Builds the dashboard workspace target |
| `pnpm test` | Runs the full unit test suite across packages |
| `pnpm test:e2e` | Runs Playwright E2E tests for the dashboard |
| `pnpm lint` | Runs linting across the monorepo |
| `pnpm typecheck` | Runs TypeScript checks across the monorepo |
| `pnpm db:push` | Pushes Supabase migrations for the dashboard schema |

## Operating Principles

- No automatic merge to `main`. The system opens a PR and stops.
- Secrets stay in environment files or secret managers, never in git.
- Destructive database changes require explicit human approval.
- Jobs should stay narrow and traceable. One request, one outcome.
- Logs, costs, and state transitions should remain structured and observable.
- Agent outputs should be validated before they are trusted.

These rules are enforced in code and documented further in [`CLAUDE.md`](CLAUDE.md).

## Documentation

- [`docs/00_MASTER_PLAN.md`](docs/00_MASTER_PLAN.md) - roadmap and milestones
- [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) - system design and data flow
- [`docs/02_TECH_STACK.md`](docs/02_TECH_STACK.md) - stack choices and setup order
- [`docs/03_TASK_TRACKER.md`](docs/03_TASK_TRACKER.md) - task breakdown and progress
- [`docs/04_CONTEXT_TRACKER.md`](docs/04_CONTEXT_TRACKER.md) - live decisions and glossary
- [`docs/05_AGENT_TEAM.md`](docs/05_AGENT_TEAM.md) - agent roles and handoff protocol
- [`docs/06_MCPS.md`](docs/06_MCPS.md) - MCP services and config
- [`docs/07_SKILLS.md`](docs/07_SKILLS.md) - project skills
- [`docs/08_COST_AND_LIMITS.md`](docs/08_COST_AND_LIMITS.md) - budget and lane routing
- [`docs/09_PRODUCT_IDEA_TO_MVP.md`](docs/09_PRODUCT_IDEA_TO_MVP.md) - idea-to-MVP flow
- [`docs/10_RISKS_AND_GUARDRAILS.md`](docs/10_RISKS_AND_GUARDRAILS.md) - risk controls and kill switches

## License

MIT. See [`LICENSE`](LICENSE).
