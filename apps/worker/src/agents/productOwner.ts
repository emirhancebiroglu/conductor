import { SpecSchema, type Spec } from "@conductor/core";
import { runAgentForJSON, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";
import type { AgentConfig } from "../agentConfig.js";
import { getAgentConfig, loadAgentConfig } from "../agentConfig.js";

const DEFAULT_SYSTEM_PROMPT = `---
name: product-owner
description: Kısa bir feature açıklamasını, web araştırması eşliğinde detaylı bir spec'e (kabul kriterleri dahil) çevirir. Conductor feature pipeline'ının ilk adımı. Kullanıcı bir özellik tarif ettiğinde, "şunu ekle", "bir feature istiyorum" dediğinde mutlaka tetikle. Belirsizlik varsa varsayım yapma, open_questions'a yaz.
---

# Product Owner

## Ne zaman kullan
Bir feature job'unun ilk adımı. Girdi: kullanıcının kısa, gündelik açıklaması. Senin işin onu **uygulanabilir, test edilebilir** bir spec'e çevirmek.

## Adımlar
1. Açıklamayı oku. Net olmayan her şeyi \`open_questions\`'a yaz — **varsayımla doldurma.**
2. Gerekirse web araştırması yap (2026 güncel): benzer ürünler nasıl çözmüş, standart UX kalıbı ne, dikkat edilecek edge case'ler ne. Her bulguyu kaynakla.
3. Özelliği user story'lere böl.
4. Net, **ölçülebilir kabul kriterleri** yaz (her biri test edilebilir olmalı).
5. Kapsam dışını açıkça belirt (\`out_of_scope\`) — scope creep'i burada kes.

## Çıktı (sadece bu JSON, başka metin yok)
{
  "summary": "1-2 cümle",
  "user_stories": ["... olarak ... istiyorum ki ..."],
  "acceptance_criteria": ["Verildiğinde X, yapıldığında Y, beklenir Z"],
  "out_of_scope": ["..."],
  "open_questions": [],
  "research_notes": [{"claim": "...", "source": "https://..."}]
}

## Yapma / Dikkat
- Belirsizliği "mantıklı varsayımla" kapatma → \`open_questions\`'a yaz; orchestrator insana sorar.
- Teknik çözüm önerme (o architect'in işi) — **ne** istendiğini tanımla, **nasıl**'ı değil.
- Kabul kriterleri "iyi çalışsın" gibi belirsiz olmasın; her biri bir teste dönüşebilmeli.`;

export type ProductOwnerOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  description: string;
  title: string;
  usageState?: UsageState;
  answers?: Record<string, string>;
  agentConfig?: AgentConfig;
};

export async function runProductOwner(options: ProductOwnerOptions): Promise<Spec> {
  const { description, title, usageState, answers, agentConfig, ...rest } = options;
  const route = resolveRoute("product-owner", "implement", usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  let config = agentConfig;
  if (!config && rest.supabase) {
    config = getAgentConfig("product-owner") ?? undefined;
    if (!config) {
      await loadAgentConfig(rest.supabase);
      config = getAgentConfig("product-owner") ?? undefined;
    }
  }

  let userPrompt = `FEATURE BAŞLIĞI: ${title}\n\nKISA AÇIKLAMA:\n${description}`;

  if (answers && Object.keys(answers).length > 0) {
    const answersText = Object.entries(answers)
      .map(([q, a]) => `Soru: ${q}\nCevap: ${a}`)
      .join("\n\n");
    userPrompt += `\n\nKullanıcı şu soruları yanıtladı:\n${answersText}\n\nBu cevapları kullanarak spec'i üret. open_questions'ı boş bırak.`;
  }

  return runAgentForJSON({
    ...rest,
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt,
    agentName: "product-owner",
    lane: route.lane,
    model: config?.model ?? route.model,
    schema: SpecSchema,
  });
}
