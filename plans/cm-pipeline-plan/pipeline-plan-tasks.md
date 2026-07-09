# CM Pipeline — Implementation Tasks

Tasks A–Z to ship: (1) the 4 CM agent prompts + model bumps, (2) fix-plan schema extension,
(3) full manual chain scan→fix→verify→rescan→PR→report, (4) multi-repo queue + auto-mode scheduler.

**Locked decisions**
- Planner model `claude-opus-4-8`; SCA/SAST/Verifier model `claude-sonnet-4-6`; all provider `claude`.
- SCA no-fix → try mitigations (overrides/resolutions/`dependencyManagement`/alias/replacement), else `needs-human` with evidence. Never silently skip.
- Auto-fix CRITICAL+HIGH only. MEDIUM/LOW triaged + reported.
- v1 multi-repo = full chain per repo, manual-triggered, kill-switch gated. Auto-mode built but defaults off.
- Prompts stored in new migration `011_cm_agent_prompts.sql`, UI-editable. No secrets in SQL.

**Guardrails (CLAUDE.md)**: no auto-merge; agents run `--dangerously-skip-permissions` only in temp worktree; secrets env-only via `.mcp.json`; verify before commit; findings fixed or reported with evidence, never silently dismissed.

---

## Part A — Fix-plan schema extension

- **A1** `packages/cm-core/src/types.ts` — extend `CmFixStrategySchema` to `["upgrade","mitigate","code-fix","skip","needs-human"]`.
- **A2** `CmFixPlanItemSchema` — add `category: z.enum(["frontend","backend","shared","infra"])`.
- **A3** Add `falsePositive: z.boolean().default(false)`; add `mitigationKind: z.enum(["override","resolution","dependency-management","alias","replacement","none"]).optional()`; add `confidence: z.number().min(0).max(1)`. Keep `reachable`/`exploitable`/`priority`/`targetVersion`/`notes`.
- **A4** `apps/cm-worker/src/pipeline/planner.ts` — regenerate the JSON-schema block in the task prompt to match A1–A3; update fallback object + `cm_finding.fix_notes` persistence to carry new fields.
- **A5** Routing in `planner.ts`: `mitigate`→SCA (pass `mitigationKind`); `needs-human`→report list, no agent call; `skip` only when `falsePositive=true` with evidence in `notes`.
- **A6** Update `packages/cm-core/src/__tests__/types.test.ts` for new enum + fields (covered in tests-tasks).

## Part B — Agent prompts (migration `011_cm_agent_prompts.sql`)

- **B1** Create `apps/dashboard/supabase/migrations/011_cm_agent_prompts.sql` + mirror `supabase/migrations/20260614_cm_agent_prompts.sql`. `UPDATE agent_config SET system_prompt=…, model=…, provider='claude', allowed_tools=… WHERE agent_name=…` for all 4. No secrets in SQL.
- **B2** `cm-fix-planner` body — model `claude-opus-4-8`, tools `{tavily,github,context7}`. Architecture-first classification (frontend/backend/shared/infra), reachability+exploitability triage, strategy selection (upgrade/mitigate/code-fix/skip/needs-human), anti-hallucination rules, CRITICAL/HIGH-only auto-fix, strict-JSON output, read-only. (Full text in `pipeline-plan-tasks-prompts.md`.)
- **B3** `cm-sca-agent` body — model `claude-sonnet-4-6`, tools `{tavily,context7,edit,shell}`. upgrade + mitigate paths (overrides/resolutions/dependencyManagement/alias/replacement), semver policy, build/test, revert-on-break, no commit.
- **B4** `cm-sast-agent` body — model `claude-sonnet-4-6`, tools `{context7,edit,shell}`. minimal targeted fix per rule class, taint-aware, category-aware FE/BE idioms, behavior-preserving, no commit.
- **B5** `cm-fix-verifier` body — model `claude-sonnet-4-6`, tools `{edit,shell}`. build+test gate, compile+runtime, trivial behavior-preserving corrections only, never weaken a security fix, `PASS:`/`FAIL:` output, no commit.
- **B6** Apply migration via Supabase MCP `apply_migration`; verify 4 rows updated.

## Part C — Full manual chain

- **C1** `apps/cm-worker/src/handlers/retry.ts` (or new `handlers/fix-queue.ts`) — define `QUEUE_FIX` + `setupFixQueue` mirroring `QUEUE_SCAN` (retry/backoff/dead-letter).
- **C2** `apps/cm-worker/src/handlers/scan.ts` — after `scan_done`, if pipeline `enabled` && `findings_actionable>0`, enqueue `QUEUE_FIX` `{scanId}`. Kill-switch checked per job.
- **C3** `apps/cm-worker/src/index.ts` — register `boss.work(QUEUE_FIX, fixHandler)`; poll `cm_scan` for `scan_done` rows not yet fixed (mirror queued-scan poll) so dashboard-only inserts still chain.
- **C4** `apps/cm-worker/src/pipeline/verifier.ts` — tighten pass-detection: require explicit `PASS:` prefix; anything else (incl. empty) ⇒ fail.
- **C5** `apps/cm-worker/src/handlers/fix.ts` — on verifier PASS → rescan fix branch (`scanProvider.scan` on worktree branch); assert no CRITICAL/HIGH remain.
- **C6** `fix.ts` rescan loop — residual CRITICAL/HIGH → re-route remaining through planner→agents, bounded by `max_fix_attempts`; exhausted → `needs_human` + surface in `current_step`.
- **C7** `packages/cm-adapters/src/git-ops.ts` — ensure `commitAll(dir,msg)` + `pushBranch(dir,branch)` exist (add if missing).
- **C8** `apps/cm-worker/src/handlers/push-pr.ts` — push commits to `fix_branch` before `pulls.create`; PR base = `branch_scanned`. Never auto-merge.
- **C9** New `apps/cm-worker/src/pipeline/report.ts` — generate PDF/DOCX (repo, SCA+SAST table w/ severities, fixes+mitigations applied, `needs_human` items w/ evidence, final pass status). Save to `report_dir`; write `cm_scan.report_path`.
- **C10** `fix.ts` — call `report.ts` after PR; ensure temp worktree cleanup in `finally` (only the temp dir).

## Part D — Multi-repo queue + auto-mode

- **D1** `apps/dashboard/app/api/cm/scans/route.ts` — accept `repo_ids: string[]` (batch); insert one `queued` `cm_scan` per repo, priority-ordered. Keep single `repo_id` path.
- **D2** `apps/dashboard/app/dashboard/cm/cm-repos-tab.tsx` — row checkboxes + "Run Selected (N)" action POSTing batch. Keep single-repo ▶.
- **D3** `apps/cm-worker/src/index.ts` — scheduler tick: when `cm_pipeline.enabled` && `cron` matches, enqueue scans for all enabled repos (batch path) → chain runs. Use existing cron dep or minimal evaluator. Defaults off.
- **D4** `apps/dashboard/app/dashboard/cm/cm-pipeline-form.tsx` — surface auto-mode state (`enabled`+`cron` already exist); label clearly as future-auto, off by default.

## Part E — Gate

- **E1** `pnpm lint` green (exclude pre-broken `apps/worker`).
- **E2** `pnpm tsc` green all packages.
- **E3** `pnpm test` green (see tests-tasks).
- **E4** Do NOT open PR until stakeholder OK + browser verification.

---

## Suggested order
A → B → (C1–C4) → (C5–C6) → (C7–C8) → C9–C10 → D → E. Schema+prompts first so chain work has correct contracts. Each part lint/tsc/test green before next.
