import { z } from "zod";
import { runAgentForJSON } from "../runner.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ReasoningScoreSchema = z.object({
  score: z.number().min(1).max(5),
  explanation: z.string(),
});

// Reference-free / blind rubric: the judge never sees the expected label or category notes.
// It grades only on internal coherence, specificity, and evidence quality.
const SYSTEM_PROMPT = `Sen bir muhakeme kalitesi değerlendiricisisin.
Görevin: bir ürün fikri değerlendirme pipeline'ının ürettiği kararı ve gerekçesini,
aşağıdaki rubriğe göre 1-5 arası puanlamak.

KURAL: Gerekçede sadece "rekabet güçlü" veya "pazar küçük" gibi genel ifadeler geçiyorsa
en fazla 3 puan verebilirsin — spesifik rakip adı, sayı veya somut kanıt olmadan üst puan yasak.

RUBRİK:
5 = Gerekçe, fikrin temel riskini doğrudan ve spesifik kanıtla adres ediyor.
    Örn: "Notion bu pazarda dominant; ağ etkisi ve 30M+ kullanıcı tabanı farklılaşmayı imkansız kılıyor"
4 = Doğru risk kategorisini tanımlıyor, ancak spesifik detay eksik.
    Örn: "Rekabet çok güçlü" der ama hangi rakip ve ne kadar güçlü olduğunu söylemez.
3 = Genel ve yüzeysel ama yön olarak mantıklı ve tutarlı.
2 = Karar belki doğru ama gerekçe alakasız, yanlış veya iç tutarsız.
1 = Gerekçe anlamsız, çelişkili veya temel kanıtları tamamen görmezden geliyor.

Sadece JSON döndür:
{
  "score": <1-5>,
  "explanation": "neden bu puan — tek cümle"
}`;

export interface ReasoningScore {
  score: number;
  explanation: string;
}

const REASONING_DIR = join(tmpdir(), "conductor-reasoning");

export async function scoreReasoning(
  input: string,
  judgeDecision: string,
  judgeReasoning: string,
  // labelCategory and labelNotes intentionally removed — blind grading only
): Promise<ReasoningScore> {
  const userPrompt =
    `Değerlendirilecek fikir: ${input}

Pipeline'ın kararı: ${judgeDecision}
Pipeline'ın gerekçesi: ${judgeReasoning}

Rubriğe göre gerekçeyi puanla (1-5). Sadece JSON döndür.`;

  mkdirSync(REASONING_DIR, { recursive: true });

  const result = await runAgentForJSON({
    repoDir: REASONING_DIR,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    jobId: `reasoning-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentName: "reasoning-evaluator",
    lane: "cheap",
    schema: ReasoningScoreSchema,
  });

  return result;
}

export function formatReasoningScore(score: ReasoningScore, maxScore = 5): string {
  const bar = "█".repeat(score.score) + "░".repeat(maxScore - score.score);
  return `[${bar}] ${score.score}/${maxScore} — ${score.explanation.slice(0, 100)}`;
}
