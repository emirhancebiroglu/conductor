import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { Spec } from "@conductor/core";
import { runAgentFreeText, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";

const SYSTEM_PROMPT = `---
name: codebase-analyst
description: Bir feature implement edilmeden önce repoyu derinlemesine analiz eder ve tüm diğer agentların okuyacağı context.md dokümanını üretir.
---

# Codebase Analyst

## Adımlar
1. Repo kök yapısını tara (klasör yapısı, ana dosyalar).
2. package.json / pyproject.toml / go.mod — bağımlılıklar, script'ler.
3. Mevcut kod pattern'lerini çıkar: naming convention, dosya organizasyonu, abstraction katmanları.
4. Spec'teki acceptance_criteria ve summary'yi oku — bu feature hangi dosyaları etkiler? Listele.
5. Mevcut test dosyalarını incele — bu repoda testler nasıl yazılıyor? (framework, pattern, coverage alışkanlıkları)
6. Teknik borç veya dikkat noktaları var mı? (deprecated kod, bilinen sorunlar, TODO yoğunluğu)
7. Anti-pattern'leri tespit et — bu repoda hangi yaklaşımlar aktif olarak kaçınılıyor?

## Çıktı
context.md dosyasını repo kökünde oluştur. Sadece bu dosyayı oluştur, başka değişiklik yapma.

Şu başlıkları içermeli:
# Codebase Context — [feature başlığı]
## Mimari & Pattern'ler
## Naming & Dosya Convention'ları
## Mevcut Abstraction'lar
## Test Convention'ları
## Bu Feature ile İlgili Dosyalar
## Teknik Borç & Dikkat Noktaları
## Anti-Pattern'ler (yapma listesi)

Her bölüm max 5-7 madde. Başka dosya değiştirme.`;

export type CodebaseAnalystOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  spec: Spec;
  title: string;
  usageState?: UsageState;
};

/** Returns the path to the written context.md file. */
export async function runCodebaseAnalyst(options: CodebaseAnalystOptions): Promise<string> {
  const { spec, title, repoDir, usageState, ...rest } = options;
  const route = resolveRoute("codebase-analyst", "analyze", usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  const userPrompt = `FEATURE BAŞLIĞI: ${title}

SPEC ÖZETİ: ${spec.summary}

KABUL KRİTERLERİ:
${spec.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Repo kökünde context.md dosyasını oluştur. Yalnızca o dosyayı yaz, başka değişiklik yapma.`;

  const output = await runAgentFreeText({
    ...rest,
    repoDir,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentName: "codebase-analyst",
    lane: route.lane,
    model: route.model,
  });

  // Agent writes context.md itself; if it only printed to stdout, persist it.
  const contextPath = path.join(repoDir, "context.md");
  // Only write from stdout if the agent didn't create the file itself
  // (agent has file-write access — this is a fallback for stdout-only output)
  try {
    const { access } = await import("node:fs/promises");
    await access(contextPath);
  } catch {
    await writeFile(contextPath, output, "utf8");
  }

  return contextPath;
}
