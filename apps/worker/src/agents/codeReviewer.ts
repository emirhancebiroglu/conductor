import { ReviewSchema, type Review } from "@conductor/core";
import { runAgentForJSON, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";
import { getGitDiff } from "./gitDiff.js";
import type { AgentConfig } from "../agentConfig.js";
import { getAgentConfig, loadAgentConfig } from "../agentConfig.js";

const DEFAULT_SYSTEM_PROMPT = `---
name: code-reviewer
description: Yazılan kodu inceler, sorunları bulur ve düzeltme talebiyle yazan agent'a geri gönderir; temiz olana kadar döngüye devam eder (max 3 tur).
---

# Code Reviewer

## Review checklist
- Doğruluk: kabul kriterlerini gerçekten karşılıyor mu?
- Kontrat uyumu: FE/BE api_contract'a uyuyor mu?
- Güvenlik: input validation, authz, sır sızıntısı, injection.
- Hata yönetimi: edge case'ler, null/boş, hata yolları.
- Okunabilirlik: isimlendirme, ölü kod, gereksiz karmaşıklık.
- Test edilebilirlik: tester bunu test edebilir mi?
- Kapsam: spec dışı sürpriz ekleme var mı (scope creep)?

## Döngü protokolü
Max 3 tur. 3'te de temiz değilse escalate: true.
"Genel olarak iyi" gibi belirsiz yorum yok — her sorun uygulanabilir olmalı.
Stil tartışmasına girme; formatter/linter ne diyorsa o.

## Çıktı (sadece JSON)
{
  "approved": false,
  "escalate": false,
  "issues": [
    {"file":"...","line":0,"severity":"high","problem":"...","fix":"...","owner":"backend"}
  ]
}`;

export type CodeReviewerOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  iteration: number;
  usageState?: UsageState;
  agentConfig?: AgentConfig;
};

export async function runCodeReviewer(options: CodeReviewerOptions): Promise<Review> {
  const { repoDir, iteration, usageState, agentConfig, ...rest } = options;
  const route = resolveRoute("code-reviewer", "review", usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  let config = agentConfig;
  if (!config && rest.supabase) {
    config = getAgentConfig("code-reviewer") ?? undefined;
    if (!config) {
      await loadAgentConfig(rest.supabase);
      config = getAgentConfig("code-reviewer") ?? undefined;
    }
  }

  const diff = await getGitDiff(repoDir);

  return runAgentForJSON({
    ...rest,
    repoDir,
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt: `Aşağıdaki diff'i kod kalitesi açısından incele (tur ${iteration}/3):\n\n\`\`\`diff\n${diff || "(diff boş — staged değişiklikler yok)"}\n\`\`\``,
    agentName: "code-reviewer",
    lane: route.lane,
    model: config?.model ?? route.model,
    schema: ReviewSchema,
  }) as Promise<Review>;
}
