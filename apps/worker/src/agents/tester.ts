import { TestResultSchema, type TestResult } from "@conductor/core";
import { access } from "node:fs/promises";
import { createConnection } from "node:net";
import * as path from "node:path";
import { runAgentForJSON, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";
import type { AgentConfig } from "../agentConfig.js";
import { getAgentConfig, loadAgentConfig } from "../agentConfig.js";

// ---------------------------------------------------------------------------
// waitForPort: poll TCP port until open or timeout
// ---------------------------------------------------------------------------

export async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const intervalMs = 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("error", () => { sock.destroy(); resolve(false); });
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`waitForPort: port ${port} not open after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Detect test env file
// ---------------------------------------------------------------------------

async function hasTestEnv(repoDir: string): Promise<boolean> {
  for (const name of [".env.test", ".env.local"]) {
    try {
      await access(path.join(repoDir, name));
      return true;
    } catch { /* not found */ }
  }
  return false;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = `---
name: qa-engineer
description: Unit testler + edge case + logging/exception kontrolü yazar ve çalıştırır; ortam varsa E2E da çalıştırır.
---

# QA Engineer

## Test Stratejisi

### 1. Unit Testler (her zaman çalıştır)
- Vitest + gerekli mock'larla unit testleri yaz.
- DB katmanını mock'la (vi.mock ile).
- API handler'ları doğrudan import edip test et.
- \`pnpm test\` çalıştır, sonuçları al.
- Unit FAIL → passed: false, E2E'ye geçme.

### 2. E2E (ortam bilgisi aşağıda belirtilir)
- E2E MEVCUT ise:
  a. \`pnpm install\` (gerekirse)
  b. Uygulamayı arka planda başlat (\`pnpm dev &\`)
  c. Port açılana kadar bekle (max 30sn)
  d. Playwright testlerini çalıştır
  e. Uygulamayı kapat
- E2E ATLANACAK ise: e2e.scenarios=0, e2e.passing=0 yaz.

### Passed mantığı
- Unit PASS + E2E pass → passed: true
- Unit PASS + E2E atlandı → passed: true
- Unit FAIL → passed: false

## KRİTİK KURALLAR
- **git commit YAPMA** — orchestrator yapar.
- **PR AÇMA** — orchestrator açar.
- **MAIN'E MERGE ETME** — insan kapısı.
- Testi geçirmek için kabul kriterini gevşetme — kriter karşılanmıyorsa passed: false.

## Çıktı (sadece JSON)
{
  "passed": true,
  "needs_human": false,
  "unit": {"added": 5, "passing": 5},
  "e2e": {"scenarios": 3, "passing": 3},
  "failures": [],
  "commit_message": "feat: ..."
}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type TesterOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  commitMessage: string;
  failures?: string[];
  iteration: number;
  usageState?: UsageState;
  agentConfig?: AgentConfig;
};

export async function runTester(options: TesterOptions): Promise<TestResult> {
  const { commitMessage, failures, repoDir, iteration, usageState, agentConfig, ...rest } = options;

  const isDebugMode = failures && failures.length > 0;
  const mode = isDebugMode ? "debug" : "analyze";
  const route = resolveRoute("qa-engineer", mode, usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  let config = agentConfig;
  if (!config && rest.supabase) {
    config = getAgentConfig("qa-engineer") ?? undefined;
    if (!config) {
      await loadAgentConfig(rest.supabase);
      config = getAgentConfig("qa-engineer") ?? undefined;
    }
  }

  const e2eAvailable = await hasTestEnv(repoDir);
  const e2eSection = e2eAvailable
    ? "E2E ORTAMI: MEVCUT — unit pass olursa E2E testlerini de çalıştır."
    : 'E2E ORTAMI: YOK — E2E atla, e2e.scenarios=0 ve e2e.passing=0 yaz. failures listesine "E2E atlandı: test ortamı bulunamadı (.env.test yok)" ekle.';

  const failureLines = isDebugMode
    ? failures.map((f) => `- ${f}`).join("\n")
    : "";
  const failureSection = isDebugMode
    ? `\nÖNCEKİ TUR HATALARI (düzelt, tekrar test et):\n${failureLines}\n`
    : "";

  const userPrompt = `${failureSection}Repo'daki feature testlerini çalıştır ve sonucu raporla (tur ${iteration}/3).\n\n${e2eSection}\n\nÖnerilen commit mesajı: "${commitMessage}"\n\nÖNEMLİ:\n- git commit YAPMA\n- PR AÇMA\n- main'e MERGE ETME`;

  return runAgentForJSON({
    ...rest,
    repoDir,
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt,
    agentName: "qa-engineer",
    lane: route.lane,
    model: config?.model ?? route.model,
    schema: TestResultSchema,
  });
}
