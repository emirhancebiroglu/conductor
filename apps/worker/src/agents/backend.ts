import type { Plan, Spec, ReviewIssue, SecurityIssue } from "@conductor/core";
import { readFile } from "node:fs/promises";
import { runAgentFreeText, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";

const SYSTEM_PROMPT = `---
name: backend-dev
description: Bir feature'ın BE tarafını implemente eder. API kontratına göre çalışır.
---

# Backend Dev

## Standartlar
- Input validation: her endpoint girişinde zod (veya proje standardı).
- Hata yönetimi: beklenen hatalar tipli; beklenmeyenler yakalanır, loglanır, kullanıcıya sızdırılmaz.
- Loglama: yapılandırılmış log (request id, süre, sonuç). Sır loglama yok.
- Güvenlik: authz kontrolü, SQL injection/erişim sınırları.
- Kontrattaki response/hata şekillerine birebir uy.

## Adımlar
1. api_contract'ı oku; endpoint'leri ve hata durumlarını çıkar.
2. Validation + iş mantığı + veri erişimini implemente et.
3. Migration gerekiyorsa: architect onu onaya işaretledi mi? Onaysız uygulama.
4. Her endpoint için temel log + hata yolu.
5. git commit yapma (orchestrator yapacak).

## Yapma
- Kontrat dışı response döndürme.
- Sır/anahtar loglama veya hata mesajında sızdırma.
- Yıkıcı DB işlemini onaysız çalıştırma.`;

export type BackendOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  spec: Spec;
  plan: Plan;
  contextPath: string;
  fixIssues?: Array<ReviewIssue | SecurityIssue>;
  fixFailures?: string[];
  usageState?: UsageState;
};

export async function runBackend(options: BackendOptions): Promise<string> {
  const { spec, plan, contextPath, fixIssues, fixFailures, repoDir, usageState, ...rest } = options;

  let contextContent = "";
  try {
    contextContent = await readFile(contextPath, "utf8");
  } catch {
    contextContent = "(context.md okunamadı)";
  }

  const isFixMode = (fixIssues && fixIssues.length > 0) || (fixFailures && fixFailures.length > 0);
  const mode = isFixMode ? "fix" : "implement";
  const route = resolveRoute("backend-dev", mode, usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  const beTasks = plan.tasks
    .filter((t) => t.area === "backend" || t.area === "shared")
    .map((t) => `- [${t.id}] ${t.desc} | Acceptance: ${t.acceptance}`)
    .join("\n");

  const basePrompt = `FEATURE: ${spec.summary}

PLAN APPROACH: ${plan.approach}

API CONTRACT:
${JSON.stringify(plan.api_contract, null, 2)}

BE TASKS:
${beTasks}

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
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentName: "backend-dev",
    lane: route.lane,
    model: route.model,
  });
}
