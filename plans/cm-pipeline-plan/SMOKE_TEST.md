# CM-Pipeline — Manual Smoke Test Procedure

> Use this to verify the real Checkmarx + Claude/OpenCode integration
> **before** running the full pipeline against a production repo.
>
> CI tests stay on mock/stub — this is a **manual, one-time** verification.

## Prerequisites

1. Checkmarx One CLI installed and authenticated: `cx version`
2. Claude Code CLI (`claude`) or OpenCode CLI installed and on `$PATH`
3. `GITHUB_TOKEN` with `repo` scope (for PR creation)
4. A real `ms*` repo with `.github/checkmarx_scan.yml` (or your own test repo)

## Step 1 — Set env vars in `apps/cm-worker/.env.local`

```bash
cp apps/cm-worker/.env.local.example apps/cm-worker/.env.local
```

Edit and fill:

```ini
CM_DATABASE_URL=postgresql://postgres:****@db.xxxx.supabase.co:6543/postgres
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GITHUB_TOKEN=ghp_...

CM_SCAN_PROVIDER=checkmarx
CM_AGENT_RUNNER=claude

CX_BASE_URI=https://eu.checkmarx.net
CX_TENANT=my-tenant
CX_APIKEY=****-****-****
```

## Step 2 — Verify real adapters load

```bash
cd apps/cm-worker
pnpm dev
```

Expected output:
```
[cm-worker] booting
[cm-worker] scan provider: CheckmarxCliProvider   ← REAL
[cm-worker] agent runner: ClaudeRunner            ← REAL
[cm-worker] pg-boss started
[cm-worker] ready
```

## Step 3 — Trigger a manual scan via API

```bash
curl -X POST http://localhost:3000/api/cm/scans \
  -H "Content-Type: application/json" \
  -d '{"repo_id": "<your-repo-id>"}'
```

Expected: `201 Created` with `{ scan: { id: "...", status: "queued" } }`

## Step 4 — Check scan progress

```bash
curl http://localhost:3000/api/cm/scans/<scan-id>
```

Expected: status transitions `queued → scanning → scan_done` (or `scan_failed`)

## Step 5 — Verify PR created on GitHub

After the pipeline completes, a PR titled `[CM] Auto-fix: Checkmarx findings resolved`
should appear on the repo's `checkmarx-auto` branch.

## Rollback

To go back to mocked externals:

```bash
CM_SCAN_PROVIDER=mock
CM_AGENT_RUNNER=stub
```

No code changes needed — adapters are env-configurable.
