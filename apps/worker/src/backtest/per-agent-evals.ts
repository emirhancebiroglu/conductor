import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { runAdversary } from "../agents/idea/adversary.js";
import { runExecutioner } from "../agents/idea/executioner.js";
import { runJudge } from "../agents/idea/judge.js";
import { runScout } from "../agents/idea/scout.js";
import { invalidateConfigCache, setAgentConfig } from "../agentConfig.js";
import { defaultIdeaAgentConfigs } from "./defaults.js";
import { WEDGE_TEST_CASES } from "./datasets/ideas.js";
import type { AdvocateResult, AdversaryResult, IdeaItem } from "@conductor/core";

// Hardcoded clone ideas for per-agent unit tests.
// These are NOT in the E2E dataset (Scout can't produce them from seeds),
// but Executioner + Judge must reject them when given directly.
const CLONE_IDEAS: Array<{ id: string; input: string; incumbents: string[] }> = [
  { id: "clone-notion", input: "Notion'un tüm özelliklerini kopyalayan genel wiki ve not alma platformu — blok editör, veritabanı, şablonlar, aynı hedef kitle", incumbents: ["Notion"] },
  { id: "clone-stripe", input: "Stripe'ın tüm özelliklerini sunan genel amaçlı ödeme API'si — abonelik, webhook, PCI uyumluluğu, aynı segment", incumbents: ["Stripe"] },
  { id: "clone-copilot", input: "GitHub Copilot ile aynı olan genel AI kod tamamlama asistanı — tüm diller, tüm IDE'ler, farklılaşma yok", incumbents: ["GitHub Copilot", "Cursor"] },
  { id: "clone-linear", input: "Linear'ın yaptığı şeyin aynısı: yazılım ekipleri için genel issue tracker, sprint planlama, roadmap — aynı iş akışı, aynı segment", incumbents: ["Linear", "Jira"] },
  { id: "clone-crayon", input: "Crayon/Klue ile aynı olan genel rekabet istihbaratı dashboard'u — aynı veri kaynakları, aynı segment, battlecard üretimi", incumbents: ["Crayon", "Klue"] },
];

export interface AgentEvalResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AgentEvalSummary {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  results: AgentEvalResult[];
}

const EVAL_DIR = join(tmpdir(), "conductor-agent-evals");

function setupConfigs(): void {
  invalidateConfigCache();
  const defaults = defaultIdeaAgentConfigs();
  for (const [name, cfg] of Object.entries(defaults)) {
    setAgentConfig(name, cfg);
  }
}

function makeAdvocateResult(ideaTitle: string, forIncumbent: boolean): AdvocateResult {
  const gapDesc = forIncumbent
    ? "Rakipler bu alanda güçlü ama biz daha iyi UX sunacağız"
    : "Bu alanda belirgin bir rakip yok, büyük bir fırsat var";
  return {
    idea_title: ideaTitle,
    verdict: "GO",
    timing_argument: {
      why_now: "Pazar büyüyor, kullanıcılar daha iyi çözüm bekliyor",
      evidence: ["Pazar araştırması talep olduğunu gösteriyor", "Rakipler yavaş yenilik yapıyor"],
    },
    best_execution: {
      day_90: "MVP çıkışı",
      first_customer_channel: "Product Hunt + dev toplulukları",
      month_6_milestone: "1000 aktif kullanıcı",
    },
    competitive_gap: {
      gap_description: gapDesc,
      gap_durability: "12-18 ay",
      gap_reasoning: "Ekip hızı ve odaklanma avantajı",
    },
    beachhead: {
      segment: "Küçük ve orta ölçekli ekipler",
      size: "$500M TAM",
      access: "Online pazarlama, içerik",
    },
    strongest_argument: "Zamanlama ve rakip açığı",
  };
}

function makeAdvocateForWedge(ideaTitle: string, wedgeDescription: string): AdvocateResult {
  return {
    idea_title: ideaTitle,
    verdict: "GO",
    timing_argument: {
      why_now: "AI maliyetleri düştü, bu dar iş akışını otomatize etmek artık mümkün",
      evidence: ["Benzer vertical wedge startuplar 2024-26'da $40k+ MRR'a ulaştı", "Incumbent bu spesifik modülü ihmal ediyor"],
    },
    best_execution: {
      day_90: "10 pilot müşteri — direkt satış",
      first_customer_channel: "Sektör topluluğu + LinkedIn direkt mesaj",
      month_6_milestone: "50 ödeme yapan müşteri, $20k MRR",
    },
    competitive_gap: {
      gap_description: wedgeDescription,
      gap_durability: "permanent",
      gap_reasoning: "Domain expertise ve düzenleyici entegrasyon moat oluşturuyor — büyük oyuncu kopyalayamaz",
    },
    beachhead: {
      segment: "Belirli sektördeki küçük-orta ölçekli işletmeler",
      size: "$15M TAM — bottom-up hesaplanmış",
      access: "Sektör birlikleri ve konferanslar",
    },
    strongest_argument: "Dar iş akışı + domain expertise + düzenleyici entegrasyon = defensible moat",
  };
}

function makeAdversaryWithIncumbentObjection(ideaTitle: string, incumbentName: string): AdversaryResult {
  return {
    idea_title: ideaTitle,
    valid_objection: true,
    objections: [
      {
        category: "competition",
        claim: `${incumbentName} bu alanda dominant, yeni oyuncuya yer yok`,
        counter: "Niş bir segmentte farklılaşılabilir",
        severity: "fatal",
        evidence: `${incumbentName} pazarın %80'ine sahip, güçlü ağ etkisi var ve aynı hedef kitleye hitap ediyor — wedge yok`,
      },
    ],
    fatal_objection: `${incumbentName} karşısında ayırt edici wedge yok — aynı geniş segment, aynı ürün kategorisi`,
    overall_assessment: "Fikir güçlü bir incumbent'ın tam aynı segmentine yatay klon olarak giriyor — hayatta kalma şansı çok düşük",
  };
}

function makeAdversaryNoFatalObjection(ideaTitle: string): AdversaryResult {
  return {
    idea_title: ideaTitle,
    valid_objection: true,
    objections: [
      {
        category: "market",
        claim: "Pazar büyüklüğü belirsiz",
        counter: "Bottom-up analiz $15M+ TAM gösteriyor",
        severity: "medium",
        evidence: "Sektördeki işletme sayısı × aylık fiyat",
      },
      {
        category: "competition",
        claim: "Büyük oyuncu bu modülü ekleyebilir",
        counter: "Domain expertise ve regulatory entegrasyon moat yaratıyor",
        severity: "medium",
        evidence: "Benzer dikey startuplar 2024-26'da dominant incumbents'a rağmen büyüdü",
      },
    ],
    fatal_objection: null,
    overall_assessment: "Fikrin potansiyeli var; itirazlar medium seviyede ve wedge savunulabilir",
  };
}

// ── Evals ───────────────────────────────────────────────────────────────────

async function evalAdversaryFlagsClones(): Promise<AgentEvalResult> {
  const jobId = `eval-adv-clone-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `adv-clone-${Date.now()}`);

  for (const cloneIdea of CLONE_IDEAS) {
    const idea: IdeaItem = {
      rank: 1,
      title: cloneIdea.id,
      one_liner: cloneIdea.input,
      pain_evidence: [{ quote: "Mevcut çözümler yetersiz", source: "User survey" }],
      scores: { pain_severity: 8, market_size: 8, competition_gap: 2, buildability: 6, distribution: 5, opportunity_score: 40 },
      top_competitors: cloneIdea.incumbents,
      competitor_gap: "Minor UX improvement — same category as incumbent",
    };
    const advocate = makeAdvocateResult(cloneIdea.id, true);

    mkdirSync(repoDir, { recursive: true });
    try {
      const result = await runAdversary(idea, advocate, jobId, repoDir);
      if (result.valid_objection !== true) {
        return {
          name: "adversary-flags-clones",
          passed: false,
          detail: `${cloneIdea.id}: valid_objection expected true (clone vs ${cloneIdea.incumbents.join(", ")}), got false`,
        };
      }
      if (result.fatal_objection === null) {
        return {
          name: "adversary-flags-clones",
          passed: false,
          detail: `${cloneIdea.id}: fatal_objection should not be null for horizontal clone`,
        };
      }
    } catch (err) {
      return {
        name: "adversary-flags-clones",
        passed: false,
        detail: `${cloneIdea.id}: exception — ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
    }
  }

  return {
    name: "adversary-flags-clones",
    passed: true,
    detail: `All ${CLONE_IDEAS.length} clone ideas correctly flagged with valid_objection + fatal_objection`,
  };
}

async function evalJudgeNeverPassesWithValidFatalObjection(): Promise<AgentEvalResult> {
  const jobId = `eval-judge-obj-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `judge-obj-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const idea: IdeaItem = {
    rank: 1,
    title: "test-notion-clone",
    one_liner: "Notion gibi geniş kapsamlı not alma ve wiki platformu — aynı segment, aynı kategori",
    pain_evidence: [{ quote: "Mevcut çözümler yetersiz", source: "User survey" }],
    scores: { pain_severity: 7, market_size: 9, competition_gap: 2, buildability: 5, distribution: 4, opportunity_score: 35 },
    top_competitors: ["Notion"],
    competitor_gap: "Minor gap",
  };
  const advocate = makeAdvocateResult("test-notion-clone", true);
  const adversary = makeAdversaryWithIncumbentObjection("test-notion-clone", "Notion");

  try {
    const result = await runJudge(idea, advocate, adversary, jobId, repoDir);
    if (result.decision === "pass") {
      return {
        name: "judge-never-passes-with-fatal-objection",
        passed: false,
        detail: `Judge passed horizontal clone despite valid fatal_objection from adversary. Decision: ${result.decision}`,
      };
    }
    return {
      name: "judge-never-passes-with-fatal-objection",
      passed: true,
      detail: `Judge correctly returned "${result.decision}" for clone with fatal objection`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

async function evalExecutionerKillsClones(): Promise<AgentEvalResult> {
  const jobId = `eval-exec-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `exec-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const ideas: IdeaItem[] = CLONE_IDEAS.slice(0, 3).map((c, i) => ({
    rank: i + 1,
    title: c.id,
    one_liner: c.input,
    pain_evidence: [{ quote: "Mevcut çözümler yetersiz", source: "User survey" }],
    scores: { pain_severity: 8, market_size: 8, competition_gap: 2, buildability: 6, distribution: 5, opportunity_score: 40 },
    top_competitors: c.incumbents,
    competitor_gap: "Minor gap — same category as incumbent",
  }));

  try {
    const result = await runExecutioner(ideas, jobId, repoDir);
    if (result.killed.length === 0) {
      return {
        name: "executioner-kills-clones",
        passed: false,
        detail: `Executioner failed to kill any of ${ideas.length} horizontal clone ideas`,
      };
    }
    return {
      name: "executioner-kills-clones",
      passed: true,
      detail: `Executioner killed ${result.killed.length}/${ideas.length} clone ideas`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

async function evalScoutProducesMinIdeas(): Promise<AgentEvalResult> {
  const jobId = `eval-scout-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `scout-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  try {
    const result = await runScout("Geliştiriciler için bir araç", null, jobId, repoDir);
    const count = result.ideas.length;
    const top5Count = result.top_5_ids.length;

    if (count < 5) {
      return {
        name: "scout-produces-min-ideas",
        passed: false,
        detail: `Scout produced only ${count} ideas (minimum 5 required)`,
      };
    }
    if (top5Count < 5) {
      return {
        name: "scout-produces-min-ideas",
        passed: false,
        detail: `Scout produced only ${top5Count} top_5_ids (expected 5)`,
      };
    }

    const invalidScores = result.ideas.filter(
      (i) =>
        i.scores.pain_severity < 1 ||
        i.scores.market_size < 1 ||
        i.scores.opportunity_score < 1 ||
        i.scores.opportunity_score > 100,
    );
    if (invalidScores.length > 0) {
      return {
        name: "scout-produces-min-ideas",
        passed: false,
        detail: `${invalidScores.length} ideas have invalid score ranges`,
      };
    }

    return {
      name: "scout-produces-min-ideas",
      passed: true,
      detail: `Scout produced ${count} ideas with ${top5Count} top_5_ids, all valid scores`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

async function evalJudgePassesWedgeWithNoFatalObjection(): Promise<AgentEvalResult> {
  // Vertical wedge + no fatal objection from Adversary → Judge should PASS (not reflexively deadlock)
  const jobId = `eval-judge-wedge-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `judge-wedge-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const wedgeCase = WEDGE_TEST_CASES[0];
  if (!wedgeCase) {
    return { name: "judge-passes-wedge", passed: false, detail: "No wedge test cases found in dataset" };
  }

  const idea: IdeaItem = {
    rank: 1,
    title: wedgeCase.id,
    one_liner: wedgeCase.input,
    pain_evidence: [{ quote: "Mevcut süreç elle yapılıyor, 45-90 dakika sürüyor", source: "Industry survey" }],
    scores: { pain_severity: 9, market_size: 7, competition_gap: 8, buildability: 7, distribution: 6, opportunity_score: 78 },
    top_competitors: wedgeCase.incumbents ?? [],
    competitor_gap: "Incumbent bu spesifik iş akışını kapsam dışı bırakıyor — domain expertise gerekiyor",
  };

  const wedgeDescription = "Incumbent genel amaçlı, bu spesifik iş akışını tam kapsamıyor — domain expertise + regulatory entegrasyon moat";
  const advocate = makeAdvocateForWedge(wedgeCase.id, wedgeDescription);
  const adversary = makeAdversaryNoFatalObjection(wedgeCase.id);

  try {
    const result = await runJudge(idea, advocate, adversary, jobId, repoDir);
    if (result.decision === "deadlock") {
      return {
        name: "judge-passes-wedge",
        passed: false,
        detail: `Judge deadlocked on wedge case with no fatal objection. Expected pass or modify, got deadlock. Reasoning: ${result.reasoning.slice(0, 120)}`,
      };
    }
    return {
      name: "judge-passes-wedge",
      passed: true,
      detail: `Judge correctly returned "${result.decision}" for wedge case with only medium-severity objections`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

async function evalJudgeHandlesAmbiguous(): Promise<AgentEvalResult> {
  const jobId = `eval-judge-amb-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `judge-amb-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const idea: IdeaItem = {
    rank: 1,
    title: "ambiguous-turkish-saas",
    one_liner: "Türk SaaS araçlarını birbirine bağlayan no-code entegrasyon platformu",
    pain_evidence: [{ quote: "Farklı araçlar arasında veri paylaşımı zor", source: "SMB survey" }],
    scores: { pain_severity: 7, market_size: 5, competition_gap: 6, buildability: 7, distribution: 5, opportunity_score: 55 },
    top_competitors: ["Zapier", "Make"],
    competitor_gap: "Türk yazılımlarına özel entegrasyon",
  };

  const advocate: AdvocateResult = {
    idea_title: "ambiguous-turkish-saas",
    verdict: "GO",
    timing_argument: {
      why_now: "Türk SaaS ekosistemi büyüyor, Zapier Türkiye'de zayıf",
      evidence: ["Türkiye'de 200+ SaaS var", "Zapier Türkçe desteği zayıf"],
    },
    best_execution: {
      day_90: "En popüler 5 Türk SaaS entegrasyonu",
      first_customer_channel: "Türk girişim toplulukları",
      month_6_milestone: "50 müşteri",
    },
    competitive_gap: {
      gap_description: "Yerelleşme avantajı",
      gap_durability: "12 ay",
      gap_reasoning: "Türkçe destek ve yerel entegrasyonlar",
    },
    beachhead: { segment: "Türk KOBİ'ler", size: "$50M TAM", access: "Online" },
    strongest_argument: "Yerelleşme",
  };

  const adversary: AdversaryResult = {
    idea_title: "ambiguous-turkish-saas",
    valid_objection: true,
    objections: [
      {
        category: "market",
        claim: "Türk SaaS pazarı henüz çok küçük",
        counter: "Büyüme trendi var",
        severity: "high",
        evidence: "Türkiye SaaS pazarı $100M",
      },
      {
        category: "competition",
        claim: "Zapier her an Türkiye'ye girebilir",
        counter: "Yerelleşme avantajımız var",
        severity: "medium",
        evidence: "Zapier global platform",
      },
    ],
    fatal_objection: null,
    overall_assessment: "Fikrin potansiyeli var ama riskler de var",
  };

  try {
    const result = await runJudge(idea, advocate, adversary, jobId, repoDir);
    // On ambiguous case: any decision is acceptable, but reasoning must be substantive
    const forcedShallowPass = result.decision === "pass" && result.reasoning.length < 50;
    if (forcedShallowPass) {
      return {
        name: "judge-ambiguous-handling",
        passed: false,
        detail: "Judge forced a pass on ambiguous case with shallow reasoning (< 50 chars)",
      };
    }
    return {
      name: "judge-ambiguous-handling",
      passed: true,
      detail: `Judge returned "${result.decision}" on ambiguous case with ${result.reasoning.length} chars reasoning`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

// Hardcoded NO_GO ideas for per-agent unit tests.
// These test kill-reason discrimination: Executioner must kill graveyard/no-market/unit-eco ideas
// when given directly. E2E dataset removed these categories — Scout never generates them from seeds.
const GRAVEYARD_IDEAS: Array<{ id: string; input: string; expectedKillReason: string }> = [
  {
    id: "grave-social-travel",
    input: "Sosyal grup seyahat planlama uygulaması — kullanıcılar rota paylaşıyor, birlikte plan yapıyor. Wander/Juyyo gibi.",
    expectedKillReason: "graveyard",
  },
  {
    id: "grave-home-cleaning",
    input: "Ev temizlik hizmetleri pazar yeri — müşteri ile temizlikçiyi eşleştiriyor. Homejoy/Handy gibi.",
    expectedKillReason: "graveyard",
  },
  {
    id: "grave-personal-finance",
    input: "Kişisel finans takip uygulaması — banka hesabına bağlanıyor, harcamaları kategorize ediyor, tasarruf önerileri yapıyor. Mint gibi.",
    expectedKillReason: "graveyard",
  },
];

const NO_MARKET_IDEAS: Array<{ id: string; input: string; expectedKillReason: string }> = [
  {
    id: "nomarket-detective-crm",
    input: "Türkiye'deki bağımsız özel dedektifler için özel CRM ve vaka takip platformu. Hedef kitle birkaç yüz kişi.",
    expectedKillReason: "no_market",
  },
  {
    id: "nomarket-dota2-coaching",
    input: "Sadece amatör Dota 2 oyuncuları için özel koçluk platformu. Discord + YouTube ücretsiz alternatif. Dota 2 oyuncu tabanı küçülüyor.",
    expectedKillReason: "no_market",
  },
];

const UNIT_ECO_IDEAS: Array<{ id: string; input: string; expectedKillReason: string }> = [
  {
    id: "uniteco-meal-delivery",
    input: "Küçük şehirlerde günlük taze yemek abonelik hizmeti. Müşteri sabah sipariş veriyor, öğlen eve teslim. Aylık 400 TL abonelik. Son kilometre + soğuk zincir + mutfak hazırlığı maliyeti yüksek.",
    expectedKillReason: "unit_economics",
  },
  {
    id: "uniteco-furnished-rental",
    input: "Türkiye'de mobilyalı kiralık daire hizmeti — iç tasarım, bakım, temizlik dahil. Fiziksel varlık yönetimi sermaye yoğun, kira geliri operasyonel maliyeti karşılamıyor.",
    expectedKillReason: "unit_economics",
  },
];

async function evalExecutionerKillsGraveyard(): Promise<AgentEvalResult> {
  const jobId = `eval-exec-grave-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `exec-grave-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const ideas: IdeaItem[] = GRAVEYARD_IDEAS.map((g, i) => ({
    rank: i + 1,
    title: g.id,
    one_liner: g.input,
    pain_evidence: [{ quote: "Kullanıcılar bu sorunu yaşıyor", source: "Survey" }],
    scores: { pain_severity: 6, market_size: 5, competition_gap: 3, buildability: 7, distribution: 4, opportunity_score: 35 },
    top_competitors: [],
    competitor_gap: "Genel kategori — önceki girişimler aynı alanda başarısız oldu",
  }));

  try {
    const result = await runExecutioner(ideas, jobId, repoDir);
    if (result.killed.length === 0) {
      return {
        name: "executioner-kills-graveyard",
        passed: false,
        detail: `Executioner failed to kill any of ${ideas.length} graveyard-category ideas`,
      };
    }
    return {
      name: "executioner-kills-graveyard",
      passed: true,
      detail: `Executioner killed ${result.killed.length}/${ideas.length} graveyard ideas`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

async function evalExecutionerKillsNoMarket(): Promise<AgentEvalResult> {
  const jobId = `eval-exec-nomarket-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `exec-nomarket-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const ideas: IdeaItem[] = NO_MARKET_IDEAS.map((g, i) => ({
    rank: i + 1,
    title: g.id,
    one_liner: g.input,
    pain_evidence: [{ quote: "Kullanıcılar bu sorunu yaşıyor", source: "Survey" }],
    scores: { pain_severity: 5, market_size: 2, competition_gap: 7, buildability: 8, distribution: 3, opportunity_score: 20 },
    top_competitors: [],
    competitor_gap: "Pazar çok küçük — potansiyel müşteri sayısı yüzlerle sınırlı",
  }));

  try {
    const result = await runExecutioner(ideas, jobId, repoDir);
    if (result.killed.length === 0) {
      return {
        name: "executioner-kills-no-market",
        passed: false,
        detail: `Executioner failed to kill any of ${ideas.length} no-market ideas`,
      };
    }
    return {
      name: "executioner-kills-no-market",
      passed: true,
      detail: `Executioner killed ${result.killed.length}/${ideas.length} no-market ideas`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

async function evalExecutionerKillsUnitEco(): Promise<AgentEvalResult> {
  const jobId = `eval-exec-uniteco-${Date.now()}`;
  const repoDir = join(EVAL_DIR, `exec-uniteco-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });

  const ideas: IdeaItem[] = UNIT_ECO_IDEAS.map((g, i) => ({
    rank: i + 1,
    title: g.id,
    one_liner: g.input,
    pain_evidence: [{ quote: "Kullanıcılar bu sorunu yaşıyor", source: "Survey" }],
    scores: { pain_severity: 7, market_size: 6, competition_gap: 5, buildability: 5, distribution: 5, opportunity_score: 30 },
    top_competitors: [],
    competitor_gap: "Birim ekonomiği kırık — son kilometre + sermaye yoğun operasyon marjları sıfırlıyor",
  }));

  try {
    const result = await runExecutioner(ideas, jobId, repoDir);
    if (result.killed.length === 0) {
      return {
        name: "executioner-kills-unit-eco",
        passed: false,
        detail: `Executioner failed to kill any of ${ideas.length} unit-economics ideas`,
      };
    }
    return {
      name: "executioner-kills-unit-eco",
      passed: true,
      detail: `Executioner killed ${result.killed.length}/${ideas.length} unit-economics ideas`,
    };
  } finally {
    try { await import("node:fs").then((fs) => fs.promises.rm(repoDir, { recursive: true, force: true })); } catch { /* ignore */ }
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────

export async function runAllAgentEvals(): Promise<AgentEvalSummary> {
  setupConfigs();

  const allEvals: (() => Promise<AgentEvalResult>)[] = [
    evalAdversaryFlagsClones,
    evalJudgeNeverPassesWithValidFatalObjection,
    evalExecutionerKillsClones,
    evalExecutionerKillsGraveyard,
    evalExecutionerKillsNoMarket,
    evalExecutionerKillsUnitEco,
    evalScoutProducesMinIdeas,
    evalJudgePassesWedgeWithNoFatalObjection,
    evalJudgeHandlesAmbiguous,
  ];

  const results: AgentEvalResult[] = [];

  for (const evalFn of allEvals) {
    try {
      const result = await evalFn();
      results.push(result);
    } catch (err) {
      results.push({
        name: evalFn.name ?? "unnamed",
        passed: false,
        detail: `Exception: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return {
    timestamp: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    results,
  };
}
