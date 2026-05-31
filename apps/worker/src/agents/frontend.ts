import type { Plan, Spec, ReviewIssue, SecurityIssue } from "@conductor/core";
import { readFile } from "node:fs/promises";
import { runAgentFreeText, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";
import type { AgentConfig } from "../agentConfig.js";
import { getAgentConfig, loadAgentConfig } from "../agentConfig.js";

const DEFAULT_SYSTEM_PROMPT = `---
name: frontend-dev
description: Bir feature'ın FE tarafını 2026 UI/UX ve erişilebilirlik standardında implemente eder. API kontratına göre çalışır.
---

# Frontend Dev

## Standartlar (2026)
- Erişilebilirlik (a11y) zorunlu: semantik HTML, klavye navigasyonu, ARIA gerektiğinde, kontrast.
- Responsive; loading/empty/error durumları her zaman ele alınır.
- Tip güvenliği: api_contract.shared_types'tan üret/türet — elle senkron tutma.
- Backend hazır değilse kontrata göre mock'la başla.

## Adımlar
1. api_contract'ı oku; tipleri ondan türet.
2. Komponentleri kur; loading/empty/error/success durumlarını ele al.
3. Kabul kriterlerini UI'da karşıladığını kontrol et.
4. git commit yapma (orchestrator yapacak).

## Yapma
- Kontrat dışına çıkma.
- a11y'i "sonra eklerim" deme — baştan.
- Gereksiz bağımlılık ekleme; mevcut stack'i kullan.`;

export type FrontendOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  spec: Spec;
  plan: Plan;
  contextPath: string;
  fixIssues?: Array<ReviewIssue | SecurityIssue>;
  fixFailures?: string[];
  usageState?: UsageState;
  agentConfig?: AgentConfig;
};

export async function runFrontend(options: FrontendOptions): Promise<string> {
  const { spec, plan, contextPath, fixIssues, fixFailures, repoDir, usageState, agentConfig, ...rest } = options;

  let config = agentConfig;
  if (!config && rest.supabase) {
    config = getAgentConfig("frontend-dev") ?? undefined;
    if (!config) {
      await loadAgentConfig(rest.supabase);
      config = getAgentConfig("frontend-dev") ?? undefined;
    }
  }

  let contextContent = "";
  try {
    contextContent = await readFile(contextPath, "utf8");
  } catch {
    contextContent = "(context.md okunamadı)";
  }

  const isFixMode = (fixIssues && fixIssues.length > 0) || (fixFailures && fixFailures.length > 0);
  const mode = isFixMode ? "fix" : "implement";
  const route = resolveRoute("frontend-dev", mode, usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  const feTasks = plan.tasks
    .filter((t) => t.area === "frontend" || t.area === "shared")
    .map((t) => `- [${t.id}] ${t.desc} | Acceptance: ${t.acceptance}`)
    .join("\n");

  const basePrompt = `FEATURE: ${spec.summary}

PLAN APPROACH: ${plan.approach}

API CONTRACT:
${JSON.stringify(plan.api_contract, null, 2)}

FE TASKS:
${feTasks}

KABUL KRİTERLERİ:
${spec.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

CODEBASE CONTEXT:
${contextContent}`;

  let userPrompt: string;
  if (isFixMode) {
    const issueLines = fixIssues
      ? fixIssues.map((i) => {
          const loc = "file" in i ? `${i.file}:${i.line ?? "?"}` : "";
          return `- ${loc} — ${i.problem}\n  Fix: ${i.fix}`;
        }).join("\n")
      : "";
    const failureLines = fixFailures ? fixFailures.map((f) => `- ${f}`).join("\n") : "";
    userPrompt = `DÜZELTME MODU — Aşağıdaki sorunları gider:\n\n${issueLines}\n${failureLines}\n\n${basePrompt}`;
  } else {
    userPrompt = basePrompt;
  }

  return runAgentFreeText({
    ...rest,
    repoDir,
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt,
    agentName: "frontend-dev",
    lane: route.lane,
    model: config?.model ?? route.model,
  });
}
