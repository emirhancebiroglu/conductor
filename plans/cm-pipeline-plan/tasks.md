# CM-Pipeline — Task Breakdown (A → Z)

> Companion to [plan.md](./plan.md). Each task is **atomic, independently testable, green-before-next**.
> Convention: `id` · area · description · **Test** (how we prove it) · **Done when**.
> Branch: `feature/cm-pipeline`. Commit per task (Conventional Commits). Lint+typecheck must pass on every commit.

Legend — area: `core` `db` `adapters` `worker` `api` `ui` `infra` `docs`.

---

## P0 — Foundations

### T-001 · infra · cm-worker package skeleton
Create `apps/cm-worker` (package.json, tsconfig extends `packages/tsconfig`, `src/index.ts` no-op boot, vitest config). Add to pnpm workspace. Add `cm-core`, `cm-adapters` empty packages.
- **Test:** `pnpm --filter cm-worker typecheck` + `pnpm --filter cm-worker test` (one trivial passing test) green.
- **Done when:** all three packages resolve via `@conductor/cm-core` etc.; root `pnpm -r typecheck` green.

### T-002 · db · cm_* migration
Write `apps/dashboard/supabase/migrations/008_cm_pipeline.sql` (+ mirror `supabase/migrations/20260603_cm_pipeline.sql`): `cm_pipeline`, `cm_repo`, `cm_scan`, `cm_finding`, `cm_report` per plan §4; RLS service-role policies; `updated_at` triggers; drop `agent_config.agent_name` CHECK; add `runs.scan_id uuid` (nullable) + make `runs.job_id` nullable; seed `cm_sca_agent` + `cm_sast_agent` rows in `agent_config`.
- **Test:** apply to a local/branch Supabase (`supabase db reset` or `db push` on a throwaway), then a SQL smoke test inserts one pipeline+repo+scan+finding and selects them back; assert FKs + defaults + unique constraints.
- **Done when:** migration applies idempotently (re-run = no error); seed agents visible; existing tables unaffected (run existing dashboard tests).

### T-003 · core · cm-core types + zod schemas
In `packages/cm-core/src/types.ts`: `CmPipeline(Row)`, `CmRepo(Row)`, `CmScan(Row)`, `CmFinding(Row)`, `CmReport(Row)` zod schemas + camel/snake mappers, mirroring `packages/core/src/types.ts` style.
- **Test:** unit — parse valid + invalid rows; mapper round-trips snake↔camel.
- **Done when:** schemas exported from index; `pnpm --filter cm-core test` green.

### T-004 · core · scan + finding state machines
`packages/cm-core/src/scan-states.ts`: `CM_SCAN_STATUS`, `CM_FIX_STATUS`, `TRANSITIONS`, `canTransition`, `isTerminal` per plan §5.
- **Test:** unit — table-driven: assert each legal transition true, a sample of illegal ones false; terminal set correct.
- **Done when:** full transition matrix covered by tests; green.

### T-005 · core · finding fingerprint
`packages/cm-core/src/fingerprint.ts`: stable `fingerprint(finding)` — SCA: hash(source+package+rule); SAST: hash(source+rule+file+normalized-line-context). Used to dedup across rescans.
- **Test:** unit — same logical finding (even if line shifts by whitespace) → same fingerprint; different finding → different.
- **Done when:** stability test passes for the rescan case.

### T-006 · core · Checkmarx result fixtures
Add `packages/cm-core/src/__fixtures__/`: realistic `checkmarx-sca.json`, `checkmarx-sast.json` (json-v2 shape per research), and a `clean-rescan.json`. Add a `parseCheckmarxResults(json)` → `CmFinding[]` mapper.
- **Test:** unit — parser maps fixtures to N findings with correct severity/source/package/file/line; clean fixture → 0 actionable.
- **Done when:** parser handles both SCA + SAST shapes; green.

---

## P1 — Adapters

### T-010 · adapters · ScanProvider interface + MockScanProvider
`packages/cm-adapters/src/scan-provider.ts` (`scan(repo, branch) → {externalScanId}`, `fetchResults(externalScanId) → CmFinding[]`). `mock-scan-provider.ts` returns fixture findings deterministically, supports a "now clean" mode for rescans.
- **Test:** unit — mock returns expected findings, then clean on second call (rescan simulation).
- **Done when:** interface stable; mock covered.

### T-011 · adapters · CheckmarxCliProvider (real)
`checkmarx-cli.ts` using `execa`: builds `cx scan create ... --report-format json` + `cx results show`, parses output via `parseCheckmarxResults`, maps exit codes (completed / failed / threshold). Auth from `CX_BASE_URI/CX_TENANT/CX_APIKEY` env. **No live calls in tests.**
- **Test:** unit with `execa` mocked — assert correct CLI args, JSON parsing, error mapping (system-fail vs scan-fail); secret never appears in built args log.
- **Done when:** arg-builder + parser unit-tested; real path guarded behind env presence.

### T-012 · adapters · AgentRunner interface + StubRunner
`agent-runner.ts`: `run(agentConfig, task) → {edits, summary, usage}`. `stub-runner.ts`: deterministic edit (e.g. bump version in package.json / apply a known patch) for tests.
- **Test:** unit — stub honors contract, returns usage tokens, applies a known edit to a temp file.
- **Done when:** contract + stub green.

### T-013 · adapters · Claude/OpenCode runner (real, dynamic)
`claude-runner.ts`: given an `agent_config` row (provider+model+system_prompt), invoke `claude -p` (premium) or OpenCode (cheap) headless in the temp worktree; capture edits + token usage → `usage_log`. Provider/model chosen **from agent_config**, not hardcoded.
- **Test:** unit with child-process mocked — asserts correct provider/model/prompt wiring from a fake agent_config; usage parsed.
- **Done when:** real runner builds correct invocation per agent_config; mock-tested.

### T-014 · adapters · git-ops
`git-ops.ts` (`simple-git`/execa): `cloneToTemp(repo) → dir`, `createBranch`, `commitAll(msg)`, `push(branch)`, `cleanup(dir)`. Temp dir owned by worker; cleanup removes only it.
- **Test:** unit against a **local bare repo**: clone→branch→commit→push→assert ref on bare; cleanup deletes temp dir and nothing else.
- **Done when:** full local round-trip green; cleanup path safe.

### T-015 · adapters · git discovery (extend @conductor/github)
Add `listRepos(octokit, owner)` + `fileExists(octokit, owner, repo, path)` to `packages/github`; `discoverRepos(filter)` applies prefix + config-path rule.
- **Test:** unit with Octokit mocked — filter matches `ms*` with config file, rejects others; configurable prefix/path respected.
- **Done when:** discovery returns correct repo set from mocked GitHub.

### T-016 · adapters · docx reporter
`reporter.ts` using `docx` lib: `generateReport(scan, findings, fixes) → buffer`; sections: repo name, scan summary, findings table (severity/source/fix_status), fixes & tests applied, final status. Save via worker to `report_dir/{repo}-cm-{ts}.docx`.
- **Test:** unit — generate buffer, re-open with `mammoth`/unzip assert it contains repo name + a findings table + status; redact check (no secrets in doc).
- **Done when:** valid .docx produced + content assertions green.

---

## P2 — Worker happy path (mock provider)

### T-020 · worker · pg-boss boot + config + adapter selection
`apps/cm-worker/src/index.ts`: start pg-boss on Supabase Postgres conn; `config.ts` selects real vs mock adapters by env (`CM_SCAN_PROVIDER=mock|checkmarx`, `CM_AGENT_RUNNER=stub|claude`); graceful shutdown; supabase service-role client in `db.ts`.
- **Test:** integration — boot worker against test DB, assert pg-boss schema created, healthy, shuts down cleanly; mock adapters selected under test env.
- **Done when:** worker boots+stops clean in CI; adapter wiring asserted.

### T-021 · worker · scan handler (persist findings)
`handlers/scan.ts`: consume `cm.scan` job → set `scanning` → `ScanProvider.scan/fetchResults` → upsert `cm_finding` (fingerprint dedup) → counts → `scan_done` or `scan_failed`; **idempotent** (re-run same scan_id = same rows).
- **Test:** integration with mock provider — enqueue→handler→assert findings rows, counts, status transitions; run twice → identical state (idempotency).
- **Done when:** findings persisted, idempotent, transitions valid; green.

### T-022 · worker · scheduler + priority queue + cron
`handlers/scheduler.ts`: on cron (from `cm_pipeline.cron`) build priority-ordered queue of enabled repos → enqueue `cm.scan` sequentially; manual trigger enqueues one. Register pg-boss cron from DB config.
- **Test:** integration — seed 3 repos w/ priorities, trigger scheduler, assert scan jobs enqueued in priority order; disabled repos skipped; manual trigger enqueues exactly one.
- **Done when:** ordering + enable filter + manual path green.

### T-023 · worker · retry + cooldown + dead-letter
System-fail scans (`scan_failed`) re-queued after `retry_cooldown_seconds` (pg-boss retry/backoff); exhausted → `failed` + dead-letter; scan-fail (Checkmarx says fail) does NOT infinite-loop.
- **Test:** integration — force provider to throw twice then succeed → assert retried after cooldown then `scan_done`; force permanent fail → `failed` + dead-letter row; assert no thundering-herd (jitter).
- **Done when:** retry/cooldown/dead-letter behave per plan; green.

---

## P3 — Fix + agents

### T-030 · worker · clone + run-gate
`handlers/fix.ts` part 1: clone repo to temp, attempt project start from `cm_repo.run_config`; success → continue; missing/fail → scan `run_blocked` + UI message + await user run-config (don't block other repos).
- **Test:** integration — run_config present+valid → proceeds; absent → `run_blocked` set, job parked; supplying config resumes.
- **Done when:** both branches green; worker not globally blocked.

### T-031 · worker · fetch actionable findings + route by source
Filter findings to `severity_threshold`; route `sca`→SCA path, `sast`→SAST path (diagram: deps vs code).
- **Test:** unit — mixed findings split correctly; below-threshold dropped.
- **Done when:** routing + filtering green.

### T-032 · pipeline · SCA logic (upgrade impact + policy)
`pipeline/sca.ts`: for each SCA finding pick target version, label impact (MINOR/MID/MAJOR via semver), apply upgrade (AgentRunner), then **test policy**: skip-minor → no test for MINOR; MID/MAJOR → run tests. Record `fix_status`.
- **Test:** unit — version 0.5.5→0.5.7 = MINOR (skipped), →0.8.6 = MID (tested), →1.1.3 = MAJOR (tested); failing test on MAJOR → `failed`.
- **Done when:** impact labels + policy + test gating match plan; green.

### T-033 · pipeline · SAST logic (fix + before/after)
`pipeline/sast.ts`: capture before-behavior (run relevant tests/responses), apply code fix (AgentRunner), capture after-behavior, **regression = reject fix** (behavior must match); else `fixed`.
- **Test:** unit — fix that preserves behavior → `fixed`; fix that changes behavior → rejected/`failed`; SQLi/XSS sample fixtures.
- **Done when:** before/after gate enforced; green.

### T-034 · worker · agent dispatch via agent_config + runs/usage
Fix handlers load `agent_config` for `cm-sca-agent`/`cm-sast-agent` (dynamic model), run via AgentRunner, write a `runs` row (scan_id) + `usage_log` per step.
- **Test:** integration — assert `runs` + `usage_log` rows created with the model from agent_config; changing the agent's model in DB changes the recorded model.
- **Done when:** dynamic model honored + cost recorded; green.

### T-035 · worker · rescan + verify loop
`handlers/rescan.ts`: after fixes, rescan via ScanProvider; resolved findings → `verified`; remaining → another fix attempt up to `max_fix_attempts`; exhausted → `needs_human`.
- **Test:** integration — mock provider returns clean on rescan → `verified`→`pr_opening`; returns still-dirty twice → `needs_human` after max attempts.
- **Done when:** bounded loop + verify green.

---

## P4 — PR + report + cleanup

### T-040 · worker · push branch + open PR
On `verified`: commit fixes, push `cm_pipeline.fix_branch` (`checkmarx-auto`), open PR via `@conductor/github` (mock in test, real in prod) → store `pr_url`, scan `pr_opened`. **Never merge.**
- **Test:** integration — assert branch pushed (local bare) + `createPR` called with correct head/base/body; `pr_url` persisted; no merge call anywhere (grep guard test).
- **Done when:** PR opened, human-gate intact; green.

### T-041 · worker · report + cleanup
`handlers/report.ts`: generate docx, save to `report_dir`, insert `cm_report`, set scan `done`, remove temp worktree.
- **Test:** integration — file written to a temp report dir, `cm_report` row created, temp clone removed; status `done`.
- **Done when:** artifact + cleanup + terminal status green.

### T-042 · worker · full pipeline integration (mocked externals)
End-to-end: scheduler → scan(1 SCA + 1 SAST) → fix → rescan(clean) → PR(mock) → report → `done`. Asserts every transition + DB rows.
- **Test:** one integration spec drives the whole flow with mock ScanProvider + StubRunner; assert final `done`, `verified` findings, `pr_url`, `cm_report`, idempotency on replay.
- **Done when:** green — this is the P0–P4 acceptance gate.

---

## P5 — Dashboard UI

### T-050 · api · cm pipeline + repo CRUD
`app/api/cm/pipeline` (GET/PATCH), `app/api/cm/repos` (GET/POST/DELETE/PATCH), workspace-scoped, zod-validated (reuse cm-core schemas).
- **Test:** unit — auth 401, workspace scoping, zod 400s, happy CRUD; mirrors existing jobs route tests.
- **Done when:** routes covered; green.

### T-051 · api · discover + run-now triggers
`app/api/cm/discover` (POST → runs `discoverRepos`, upserts `cm_repo`), `app/api/cm/scans` (POST → enqueue manual scan; GET list), `app/api/cm/scans/[id]` (detail w/ findings + runs).
- **Test:** unit — discover upserts matched repos; run-now enqueues; detail returns findings+steps; auth/scope enforced.
- **Done when:** triggers + detail green.

### T-052 · ui · /dashboard/cm shell + sidebar
Add “Checkmarx” sidebar item; `/dashboard/cm` layout with Pipelines / Repos / Runs / Reports tabs (shadcn/ui, workspace-scoped).
- **Test:** Playwright — nav renders, tabs switch, workspace-scoped; fixture-auth bypass like existing E2E.
- **Done when:** shell renders + nav E2E green.

### T-053 · ui · pipeline settings form
Form over `cm_pipeline`: enable, cron (human-readable preview + validate), severity multiselect, SCA policy, discovery filter, branch, report dir, cooldown, max attempts. Dirty-state + save (reuse agents-dirty-state pattern).
- **Test:** Playwright — edit cron → invalid shows error, valid saves + persists after reload; toggle enable persists.
- **Done when:** save/persist/validate E2E green.

### T-054 · ui · repos tab
List discovered+manual repos; “Discover now”; add/remove manual; priority edit; enable toggle; run_config editor.
- **Test:** Playwright — discover populates list; add manual repo; toggle persists; “Run now” fires (stubbed enqueue) and shows feedback.
- **Done when:** repo management E2E green.

### T-055 · ui · runs tab + Realtime detail
Live runs list (Supabase Realtime), drill-in: findings table, agent steps (runs), cost (usage_log), PR link, report download.
- **Test:** Playwright — seed a scan → appears in list; detail shows findings + steps + PR link + report link; status updates live (or polled fallback asserted).
- **Done when:** runs UI + detail E2E green.

### T-056 · ui · CM agents in Agents page
Verify `cm-sca-agent`/`cm-sast-agent` appear in existing Agents dashboard, model-selectable, save persists (mostly free via seed; add category + ordering).
- **Test:** Playwright (extend existing agents E2E) — CM agents render, model change persists.
- **Done when:** CM agents manageable in existing UI; green.

---

## P6 — Real wiring + hardening

### T-060 · infra · real Checkmarx + real runner behind env
Flip prod env to `CM_SCAN_PROVIDER=checkmarx`, `CM_AGENT_RUNNER=claude`; document `CX_*` + Claude/OpenCode setup in `.env.example`; smoke-doc steps. CI stays on mock/stub.
- **Test:** manual smoke (documented) on one real `ms*` repo; CI unaffected (still green on mocks).
- **Done when:** real adapters load under prod env; CI green; smoke documented.

### T-061 · worker · observability + kill switch
Structured logs (redacted), per-scan timing, error surfacing to UI; global pipeline enable acts as kill switch; worker `worker_status` heartbeat (reuse existing).
- **Test:** integration — disabling pipeline stops new enqueues mid-flight; logs contain no secrets (assertion); heartbeat row updates.
- **Done when:** kill switch + redaction + heartbeat green.

### T-062 · docs · update docs + dogfood retro
Update `docs/` (architecture entry for cm-worker, env, runbook); 1 real-repo dogfood; record breakages in `docs/04`/`docs/10`.
- **Test:** docs reviewed; dogfood produces a real PR on `checkmarx-auto` + a .docx report.
- **Done when:** real PR opened by pipeline on a real repo; retro written.

### T-063 · release · final DoD gate
`pnpm lint && pnpm test && pnpm test:e2e` green; PR description (what/why/how-tested/screenshots) per template; open PR, **stop** (human merge).
- **Test:** full suite green in CI.
- **Done when:** PR opened for human review; pipeline self-hosted end-to-end demonstrated.

---

## Dependency order (critical path)
```
T-001 → T-002 → T-003 → T-004,T-005,T-006        (P0)
      → T-010..T-016                              (P1, parallel after P0)
      → T-020 → T-021 → T-022 → T-023             (P2)
      → T-030 → T-031 → T-032,T-033 → T-034 → T-035 (P3)
      → T-040 → T-041 → T-042                     (P4 gate)
      → T-050,T-051 → T-052..T-056                (P5)
      → T-060 → T-061 → T-062 → T-063             (P6)
```
Each task: implement → its test green → lint/typecheck green → commit. No task starts until its dependency is green.
