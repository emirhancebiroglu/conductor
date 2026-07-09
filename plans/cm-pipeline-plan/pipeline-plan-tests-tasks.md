# CM Pipeline — Test Tasks

Tasks A–Z covering unit, integration, DB/migration, and e2e (Playwright) so the implementation in
`pipeline-plan-tasks.md` is proven correct before any PR. Test stack: **vitest** (unit/integration),
**Supabase live** (DB/migration tests, like `migration-005.test.ts`), **Playwright** (dashboard e2e).

Gate: `pnpm lint && pnpm tsc && pnpm test` green; e2e green; no PR until stakeholder OK.

---

## Part U — Unit tests

- **U1 — Fix-plan schema** (`packages/cm-core/src/__tests__/types.test.ts`): `CmFixPlanItemSchema` accepts all 5 strategies; rejects unknown strategy; `category` enum enforced; `falsePositive` defaults false; `confidence` bounds [0,1]; `mitigationKind` optional; round-trip parse of a full plan object.
- **U2 — Planner parsing** (`apps/cm-worker/src/__tests__/planner.test.ts`, new): stub runner returns valid extended JSON → `runPlanner` parses, persists `fix_notes`, sorts by priority desc; malformed JSON → fallback plan covers every finding; `mitigate`/`needs-human`/`skip(falsePositive)` route correctly; `skip` without `falsePositive` is NOT persisted as skipped.
- **U3 — SCA stage** (`apps/cm-worker/src/__tests__/sca.test.ts`, extend): `upgrade` edits manifest version; `skip-minor` policy skips MINOR; `mitigate` path invoked with `mitigationKind`; agent-failure → finding `failed` + clean tree (no partial edits asserted via git-diff mock).
- **U4 — SAST stage** (`apps/cm-worker/src/__tests__/sast.test.ts`, extend): `code-fix` dispatches with file+taint context; `skip`(falsePositive) not dispatched; success→`fixed`, failure→`failed`.
- **U5 — Verifier strict pass** (`apps/cm-worker/src/__tests__/verifier.test.ts`, new): `PASS:`→passed true; `FAIL:`→false; empty string→false; non-prefixed text→false (regression guard for the loosened check).
- **U6 — git-ops** (`packages/cm-adapters/src/__tests__/git-ops.test.ts`, extend): `commitAll` stages+commits; `pushBranch` pushes; no-op when nothing changed.
- **U7 — Dispatch** (`apps/cm-worker/src/__tests__/` dispatch coverage): runs/usage_log rows written with `changed` from git-diff; cost calc per provider rate unchanged.
- **U8 — Report builder** (`apps/cm-worker/src/__tests__/report.test.ts`, new): given findings + plan, produces a file at `report_dir`, sets `report_path`, includes `needs_human` items + severity table; no secrets in output.
- **U9 — Batch scans API** (dashboard route unit): `repo_ids:[a,b]` → 2 inserts, priority order; single `repo_id` still works; empty/invalid → 400.

## Part I — Integration tests

- **I1 — Full chain (stub runner)** (`apps/cm-worker/src/__tests__/pipeline-e2e.test.ts`, extend): scan_done→QUEUE_FIX→planner→sca/sast→verifier PASS→commit→rescan(no CRITICAL/HIGH)→push-pr→report. Assert state transitions and that PR base=`branch_scanned`, no auto-merge.
- **I2 — Rescan retry loop**: first verifier/rescan leaves residual CRITICAL/HIGH → re-route bounded by `max_fix_attempts` → exhaustion sets `needs_human` + `current_step`.
- **I3 — Kill-switch**: pipeline `enabled=false` → fix job skipped, scan does not chain; re-enable resumes.
- **I4 — Scan→fix handoff**: dashboard-only `cm_scan` insert (no pg-boss enqueue) → poller picks `scan_done` → fix chains.
- **I5 — Real runner smoke (gated)**: behind `CM_AGENT_RUNNER=claude` env (skipped in CI). Dispatch planner against a fixture scan; assert JSON parses to extended schema and `--allowedTools` built from `allowed_tools`.

## Part B — DB / migration tests (Supabase live)

- **B1 — Migration `011` applies** (`*/migration-011.test.ts`, pattern of `migration-005.test.ts`): after apply, `agent_config` has 4 cm-% rows with new `system_prompt` (non-placeholder, length > 200), `provider='claude'`, correct `model` per agent, correct `allowed_tools` arrays.
- **B2 — Idempotency**: re-applying `011` is safe (UPDATE-based, no dupes; row count unchanged).
- **B3 — allowed_tools column intact**: `agent_config.allowed_tools` text[] NOT NULL default `{}` still holds.
- **B4 — No secrets in migration**: grep the SQL files for token/key patterns → none present.
- **B5 — cm_pipeline fields**: `enabled`, `cron`, `fix_branch`, `report_dir`, `max_fix_attempts`, `sca_test_policy`, `severity_threshold` all present (auto-mode + chain depend on them).

## Part E — e2e (Playwright, dashboard)

- **E1 — Agents UI**: open each of the 4 CM agents; assert system_prompt textarea shows the new prompt; Allowed Tools chips reflect seeded tools; edit+save persists.
- **E2 — Multi-select repos**: Repos tab → select 2 checkboxes → "Run Selected (2)" enabled → click → 2 scans appear queued in Runs. Single ▶ still works. a11y: checkboxes labelled, keyboard-operable, focus visible.
- **E3 — Runs detail**: a chained scan shows steps (scan→fix→verify→rescan→pr), findings grouped SAST/SCA with severity badges + fix_status, PR link, report path. Realtime status updates as worker progresses (or polled fallback).
- **E4 — Pipeline form / auto-mode**: Settings tab shows `enabled` + `cron`; toggling persists; copy makes clear auto-mode is off by default.
- **E5 — Kill-switch UX**: disabling pipeline reflects worker `paused_manual` status in UI.

## Part R — Regression / gate

- **R1** Existing 367 tests stay green (no contract drift from schema/prompt changes).
- **R2** `pnpm lint` clean (exclude pre-broken `apps/worker`); `pnpm tsc` clean.
- **R3** Manual smoke checklist (browser) recorded before PR: single-repo full chain produces a real PR + report; app boots after fixes (compile+runtime) per verifier; no CRITICAL/HIGH after rescan.

---

## Suggested order
U1–U2 (schema/planner) → U3–U8 → B1–B5 → I1–I4 → E1–E5 → I5/R3 (gated real-runner + browser smoke) → R1–R2 final gate.
