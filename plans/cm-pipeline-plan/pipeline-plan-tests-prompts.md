# CM Pipeline — Test Prompts

Step-by-step prompts to give an implementing/testing agent to execute every task in
`pipeline-plan-tests-tasks.md` and confirm the implementation is correct and ship-ready.
Stack: vitest (unit/integration), Supabase live (DB/migration), Playwright (e2e).

Rule for every prompt: write the test first or alongside, run it, paste the real output. If it fails,
fix the implementation (not the assertion) unless the assertion is genuinely wrong. NEVER weaken a test
to force green. NEVER print secrets.

---

## Prompt U — Unit tests
> Add/extend vitest unit tests for the CM pipeline. Work file-by-file, running each suite after writing it.
> 1. `packages/cm-core/src/__tests__/types.test.ts` — cover the extended `CmFixPlanItemSchema`: all 5 strategies parse; unknown strategy rejected; `category` enum enforced; `falsePositive` defaults false; `confidence` rejected outside [0,1]; `mitigationKind` optional; full-plan round-trip.
> 2. New `apps/cm-worker/src/__tests__/planner.test.ts` — mock the AgentRunner. Valid extended JSON → parsed, `cm_finding.fix_notes` persisted, sorted by priority desc. Malformed JSON → fallback covers every finding. Assert routing: `mitigate`/`needs-human`/`skip(falsePositive=true)`; assert `skip` WITHOUT `falsePositive` is not persisted as skipped.
> 3. Extend `sca.test.ts` / `sast.test.ts` for upgrade vs mitigate vs code-fix vs skip and failure→`failed` with a clean tree (git-diff mock shows no partial edits).
> 4. New `verifier.test.ts` — strict pass: `PASS:`→true; `FAIL:`/empty/non-prefixed→false.
> 5. Extend git-ops test for `commitAll`/`pushBranch` + no-op-when-clean.
> 6. New `report.test.ts` — produces a file at a temp `report_dir`, sets `report_path`, includes severity table + `needs_human` items, contains no secret-like strings.
> 7. Dashboard batch-scan route unit — `repo_ids` → N inserts priority-ordered; single `repo_id` works; invalid → 400.
> Run `pnpm --filter @conductor/cm-core test`, `pnpm --filter @conductor/cm-worker test`, `pnpm --filter @conductor/cm-adapters test`, dashboard tests. Paste results.

## Prompt I — Integration tests
> Extend `apps/cm-worker/src/__tests__/pipeline-e2e.test.ts` to drive the full chain with the STUB runner.
> 1. Seed a scan with 1 SCA + 1 SAST CRITICAL finding + `agent_config` rows for all 4 agents. Run scan_done→QUEUE_FIX→planner→sca/sast→verifier PASS→commit→rescan→push-pr→report. Assert each `cm_scan` status transition, PR base = `branch_scanned`, and that NO auto-merge call is made.
> 2. Rescan retry: make the first rescan return residual CRITICAL → assert re-route bounded by `max_fix_attempts` → exhaustion sets `needs_human` + `current_step`.
> 3. Kill-switch: `cm_pipeline.enabled=false` → fix job skipped, no chaining; flip true → resumes.
> 4. Handoff: insert a `cm_scan` directly (no pg-boss send) → poller picks `scan_done` → chain runs.
> 5. Gated real-runner smoke behind `CM_AGENT_RUNNER=claude` (skip if unset): planner against a fixture; assert extended-schema JSON parses and `--allowedTools` derived from `allowed_tools`.
> Run the suite; paste output. Keep the stub path deterministic for CI.

## Prompt B — DB / migration tests (Supabase live)
> Mirror the `migration-005.test.ts` style for migration `011`. Ensure Supabase is reachable first (the project has been paused before — if DNS/connection fails, STOP and tell the user to resume Supabase; do not mark these as code failures).
> 1. New `migration-011.test.ts`: after the migration is applied, assert the 4 `cm-%` `agent_config` rows have non-placeholder `system_prompt` (length > 200), `provider='claude'`, correct `model` (planner `claude-opus-4-8`; others `claude-sonnet-4-6`), and exact `allowed_tools` arrays.
> 2. Idempotency: applying `011` twice leaves row count + values stable.
> 3. Assert `allowed_tools` column is still `text[] NOT NULL DEFAULT '{}'`.
> 4. Grep both migration SQL files for token/key/secret patterns — assert none.
> 5. Assert `cm_pipeline` has `enabled,cron,fix_branch,report_dir,max_fix_attempts,sca_test_policy,severity_threshold`.
> Run the migration test file; paste output.

## Prompt E — Playwright e2e (dashboard)
> Add/extend Playwright specs under the dashboard `e2e/` (or `tests/`) dir. Boot the app, log in via the existing auth helper.
> 1. Agents: open each CM agent; assert the system_prompt textarea contains the new prompt text and Allowed Tools chips match seeded tools; edit displayName, save, reload, assert persisted.
> 2. Repos multi-select: select 2 repo checkboxes; assert "Run Selected (2)" enables; click; assert 2 queued scans appear in Runs. Verify single ▶ still queues one. a11y: checkboxes have labels, are keyboard-operable, focus ring visible (assert via role/name + keyboard nav).
> 3. Runs detail: open a chained scan; assert step timeline (scan→fix→verify→rescan→pr), SAST/SCA grouping with severity badges + fix_status, PR link, report path. Assert status updates (realtime or polled).
> 4. Pipeline form: Settings tab shows enabled+cron; toggle persists across reload; copy states auto-mode off by default.
> 5. Kill-switch: disable pipeline → worker status shows paused_manual in UI.
> Run `pnpm test:e2e`; paste pass/fail summary. Screenshot key views for the PR.

## Prompt R — Regression & final gate
> 1. Run the FULL suite: `pnpm lint && pnpm tsc && pnpm test` (exclude pre-broken `apps/worker` from lint as established). Confirm the existing 367 tests still pass plus the new ones. Paste totals.
> 2. Manual browser smoke (record results, do NOT open PR): pick one repo with a known CRITICAL/HIGH SCA + SAST; Run; confirm worktree edits, verifier PASS, rescan clears CRITICAL/HIGH, PR opens on `fix_branch` with commits (no auto-merge), report PDF written to `report_dir`, and the app boots/compiles + runs after the fixes.
> 3. Report the final green status and the smoke results to the stakeholder and WAIT for explicit approval before opening any PR.
```

> Note: env vars (CX/GitHub/Tavily/context7/Supabase) are read at runtime from `.mcp.json`/process env. NEVER write their values into tests, fixtures, logs, reports, or output.
