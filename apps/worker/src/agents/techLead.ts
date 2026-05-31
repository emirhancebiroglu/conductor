import { PlanSchema, type Plan, type Spec, type SecurityIssue } from "@conductor/core";
import { readFile } from "node:fs/promises";
import { runAgentForJSON, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";
import type { AgentConfig } from "../agentConfig.js";
import { getAgentConfig, loadAgentConfig } from "../agentConfig.js";

const DEFAULT_SYSTEM_PROMPT = `---
name: tech-lead
description: Spec + codebase context'ini alıp sistem tasarımı, task kırılımı ve API kontratı üretir. Feature çok karmaşıksa alt feature'lara böler. Security sorunları eskalasyon geldiğinde mimariyi yeniden tasarlar.
---

# Tech Lead

## Normal mod
1. context.md'yi oku — mevcut pattern'leri ve kısıtları anla.
2. Spec'teki kabul kriterlerini tech görevlere çevir.
3. Complexity değerlendir:
   - simple: tek FE veya tek BE değişikliği, 1-2 dosya
   - medium: FE+BE beraber, 3-8 dosya, açık API contract
   - complex: 8+ dosya, ayrı deploy edilebilir parçalar → sub_features doldur
4. API kontratını sabitle — FE+BE bu kontrata göre çalışır.
5. Atomik, doğrulanabilir görevlere böl.
6. Migration gerekiyorsa: taslağı yaz, needs_migration: true işaretle.
7. Branch: feature/<slug> (job title'dan, lowercase+tire, max 40 karakter).

## Redesign modu
Security sorunlarını al, mevcut planın neden güvensiz olduğunu anla, güvenlik-güvenli yeni mimari kur.

## Çıktı (sadece JSON)
{
  "approach": "kısa teknik özet",
  "complexity": "simple|medium|complex",
  "sub_features": null,
  "affected_modules": ["src/..."],
  "api_contract": {
    "shared_types": ["type X = {...}"],
    "endpoints": [{"method":"POST","path":"/api/x","description":"..."}]
  },
  "tasks": [
    {"id":"BE-1","area":"backend","desc":"...","acceptance":"..."}
  ],
  "branch": "feature/slug",
  "needs_migration": false,
  "migration": null,
  "risks": ["..."]
}`;

export type TechLeadOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  spec: Spec;
  title: string;
  contextPath: string;
  securityIssues?: SecurityIssue[];
  usageState?: UsageState;
  agentConfig?: AgentConfig;
};

export async function runTechLead(options: TechLeadOptions): Promise<Plan> {
  const { spec, title, contextPath, securityIssues, repoDir, usageState, agentConfig, ...rest } = options;
  const isRedesign = securityIssues && securityIssues.length > 0;
  const route = resolveRoute("tech-lead", isRedesign ? "redesign" : "implement", usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  let config = agentConfig;
  if (!config && rest.supabase) {
    config = getAgentConfig("tech-lead") ?? undefined;
    if (!config) {
      await loadAgentConfig(rest.supabase);
      config = getAgentConfig("tech-lead") ?? undefined;
    }
  }

  let contextContent = "";
  try {
    contextContent = await readFile(contextPath, "utf8");
  } catch {
    contextContent = "(context.md okunamadı)";
  }

  const userPrompt = isRedesign
    ? `REDESIGN MODU — Security Reviewer eskalasyon gönderdi.

FEATURE BAŞLIĞI: ${title}
SPEC: ${spec.summary}

CODEBASE CONTEXT:
${contextContent}

GÜVENLİK SORUNLARI (çözülmesi gereken):
${securityIssues!.map((i) => `- [${i.severity}/${i.category}] ${i.file}:${i.line ?? "?"} — ${i.problem}\n  Fix: ${i.fix}`).join("\n")}

Bu sorunları mimari düzeyde çözen yeni bir plan üret.`
    : `FEATURE BAŞLIĞI: ${title}

SPEC:
${JSON.stringify(spec, null, 2)}

CODEBASE CONTEXT:
${contextContent}

Yukarıdaki spec ve context'e göre teknik plan üret.`;

  // why: PlanTaskSchema uses z.preprocess whose output TS infers as unknown; cast to Plan is safe at runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runAgentForJSON({
    ...rest,
    repoDir,
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt,
    agentName: "tech-lead",
    lane: route.lane,
    model: config?.model ?? route.model,
    schema: PlanSchema as any,
  }) as Promise<Plan>;
}
