// ---------------------------------------------------------------------------
// Backtest dataset — 25 curated test cases for the idea evaluation pipeline
//
// Design principles (2026):
// - Input is a SEED description (2-3 sentences with embedded pain evidence).
//   Scout does its own web research from this seed and generates fresh ideas.
//   Labels describe the expected outcome of running the full pipeline.
// - NO_GO_INCUMBENT_CLONE category REMOVED: Scout generates ideas from pain,
//   not from seeds. It never produces a blunt clone — it finds wedges.
//   Incumbent clone testing lives in per-agent-evals.ts (unit tests), not here.
// - WEDGE_ON_INCUMBENT = narrow vertical wedge against an incumbent.
//   Can legitimately pass (vertical AI wins in 2026).
// - difficulty tiers help surface per-tier accuracy regressions.
// - expectedKillReason enables kill-reason accuracy grading.
// ---------------------------------------------------------------------------

export type TestCaseCategory =
  | "NO_GO_INCUMBENT"        // Kept for per-agent-evals compat only — not used in dataset
  | "NO_GO_GRAVEYARD"
  | "NO_GO_NO_MARKET"
  | "NO_GO_UNIT_ECONOMICS"   // Kill reason = margins/CAC>LTV
  | "GO_CLEAR"
  | "WEDGE_ON_INCUMBENT"     // Narrow vertical wedge — NOT in hard veto
  | "AMBIGUOUS";

export type KillReason =
  | "incumbent"
  | "graveyard"
  | "no_market"
  | "unit_economics"
  | "distribution";

export type Difficulty = "easy" | "medium" | "hard";

export interface TestCase {
  id: string;
  input: string;                              // Seed description (Turkish, 2-3 sentences)
  category: TestCaseCategory;
  expectedVerdict: "pass" | "deadlock" | null;
  tolerateAnyVerdict: boolean;
  difficulty: Difficulty;
  expectedKillReason?: KillReason;            // For NO_GO cases — graded by scorer
  incumbents?: string[];                      // Named competitors (for per-agent-evals)
  graveyardRef?: string;                      // Historical failure reference
  notes: string;                              // Rationale — human-readable, not fed to judge
}

export const TEST_DATASET: TestCase[] = [

  // ── GO_CLEAR (7) — strong vertical/dev-tool plays ─────────────────────────
  {
    id: "go-01",
    input: "Geliştiriciler için OpenAPI ve GraphQL şemalarından otomatik API dokümantasyonu üreten araç. Versiyon diff'i gösteriyor, özelleştirilebilir tema destekliyor, CI/CD pipeline'ına entegre oluyor. Reddit r/webdev'de 'dökümantasyon bakımı en büyük acımız' yorumları çok.",
    category: "GO_CLEAR",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "easy",
    notes: "Gerçek ve yaygın problem. Hızlı MVP mümkün. Swagger/OpenAPI ekosistemine oturuyor. Dev araçları pazarında dağıtım kanalı açık (Product Hunt, HN, GitHub).",
  },
  {
    id: "go-02",
    input: "Küçük e-ticaret satıcıları için AI ürün fotoğrafı düzenleme aracı: background kaldırma, beyond-white arka plan oluşturma, boyutlandırma ve toplu işleme. Trendyol/Hepsiburada satıcıları fotoğraf düzenlemeye haftada 3-4 saat harcıyor.",
    category: "GO_CLEAR",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "easy",
    notes: "E-ticaret satıcıları için somut acı. Photoshop pahalı, ucuz alternatifler yetersiz. AI API'leri ile hızlı çözüm. Freemium → abonelik modeli işliyor.",
  },
  {
    id: "go-03",
    input: "Küçük işletmeler için AI sözleşme analiz aracı — kiradan tedarikçi sözleşmesine, gizlilik maddelerini ve risk maddelerini düz Türkçe özetliyor. Avukat saati 1500+ TL, KOBİ'lerin çoğu hiç avukata gitmiyor.",
    category: "GO_CLEAR",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "easy",
    notes: "KOBİ'ler için yaygın acı. Türkçe NLP farklılaşma sağlıyor. Aylık abonelik modeli uygun. Muhasebeciler üzerinden kanal var.",
  },
  {
    id: "go-04",
    input: "SaaS şirketleri için müşteri destek biletlerini analiz eden ve ürün ekibine aksiyon raporları sunan araç. 'Bu ay 300 bilet tekrar eden bir bug hakkında — öncelik ver' gibi çıktılar üretiyor. Support ekipleri bu analizi elle yapıyor.",
    category: "GO_CLEAR",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "medium",
    notes: "Gerçek B2B acı, ölçülebilir ROI. SaaS şirketleri bu tür araçlara budget ayırıyor. Zendesk/Intercom entegrasyonu ile hızlı dağıtım.",
  },
  {
    id: "go-05",
    input: "Türkiye'deki muhasebeciler ve mali müşavirler için AI destekli beyanname hazırlık aracı. GİB portal adımlarını otomatize ediyor, eksik belge uyarısı yapıyor. Muhasebeciler beyanname döneminde 60-80 saat fazla mesai yapıyor.",
    category: "GO_CLEAR",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "medium",
    notes: "Lokalize niş. Türk muhasebe mevzuatı uzmanlık gerektiriyor. Hedef kitle ödeme yapıyor. GİB entegrasyonu farklılaşma sağlıyor. B2B abonelik.",
  },
  {
    id: "go-06",
    input: "Yazılım ajansları ve freelance geliştiriciler için proje teklif ve scope of work otomasyonu. Müşterinin proje açıklamasından otomatik teknik kapsam, zaman tahmini ve fiyat aralığı üretiyor. Her ajans bu dokümanları elle hazırlıyor, genellikle 2-4 saat sürüyor.",
    category: "GO_CLEAR",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "medium",
    notes: "Ajans ve freelancer pazarı büyük ve ödeme yapıyor. Acı somut ve ölçülebilir. Toptal/Upwork topluluklarında dağıtım kanalı var.",
  },
  {
    id: "go-07",
    input: "Veteriner klinikleri için AI destekli SOAP notu otomasyonu: muayene sırasında konuşulanları kaydedip otomatik veteriner notu oluşturuyor. Veterinerler randevu başına 8-12 dakika not yazıyor, günlük 4-6 saat gidiyor buna.",
    category: "GO_CLEAR",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "medium",
    notes: "Veteriner yazılımı $2.1B büyüyen pazar. AI SOAP notu human-medicine'den vertical'a taşıma. Hayvan farmakopejası domain expertise = moat. Solo veteriner practice dağıtım kanalı.",
  },

  // ── WEDGE_ON_INCUMBENT (4) — narrow vertical, NOT in hard veto ───────────
  // These teach the system that a narrow wedge against a big player can pass.
  {
    id: "wedge-01",
    input: "Fizik tedavi klinikleri için sigorta ön onay (prior authorization) sürecini otomatize eden araç. Doğru CPT kodlarını, sigorta kurallarını ve belgeleri otomatik hazırlıyor. Klinikler şu an bu işi elle yapıyor ve her başvuru 45-90 dakika alıyor.",
    category: "WEDGE_ON_INCUMBENT",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "hard",
    incumbents: ["Epic", "Kareo"],
    notes: "Gerçek dünya örneği: $41k MRR'a ulaşmış solo founder. Epic/Kareo bu spesifik iş akışını iyi yapmıyor. Domain expertise (CPT kodları, sigorta kuralları) moat oluşturuyor.",
  },
  {
    id: "wedge-02",
    input: "Ticari gayrimenkul portföy yöneticileri için kira sözleşmesi analiz aracı. Sözleşmelerden 47 spesifik veri noktasını çıkarıyor, standart dışı maddeleri işaretliyor, Yardi/MRI entegrasyonu sunuyor. Portföy yöneticileri her sözleşmeyi elle 2-4 saat analiz ediyor.",
    category: "WEDGE_ON_INCUMBENT",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "hard",
    incumbents: ["Yardi", "MRI Software"],
    notes: "Genel sözleşme AI araçları (Ironclad, ContractPodAi) CRE'ye özel değil. Yardi/MRI bu analizi yapmıyor. Dikey uzmanlık + entegrasyon = güçlü moat.",
  },
  {
    id: "wedge-03",
    input: "Türkiye'deki çok şubeli restoranlar için Türk gıda mevzuatına uygun denetim ve raporlama aracı. HACCP kayıtlarını dijitalleştiriyor, Tarım Bakanlığı formatında rapor üretiyor, zincir genelinde uyumsuzlukları uyarıyor. Şu an kağıt veya Excel ile yapılıyor.",
    category: "WEDGE_ON_INCUMBENT",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "hard",
    incumbents: ["SAP", "Oracle Hospitality"],
    notes: "SAP/Oracle Türk mevzuatını doğru kapsamıyor. Lokalize uzmanlık + düzenleyici entegrasyon = moat. Zincir restoranlar ödeme yapıyor. Doğrudan bölge müdürleri üzerinden satış kanalı var.",
  },
  {
    id: "wedge-04",
    input: "İnşaat firmalarının beton dökme süreçlerini optimize eden pre-construction AI aracı. Hava durumu, zemin verileri ve beton karışım parametrelerini birleştirerek en uygun dökme zamanlamasını ve yöntemini öneriyor. Proje başına tahminen 100k+ TL tasarruf sağlıyor.",
    category: "WEDGE_ON_INCUMBENT",
    expectedVerdict: "pass",
    tolerateAnyVerdict: false,
    difficulty: "hard",
    incumbents: ["Procore", "Autodesk Construction Cloud"],
    notes: "Procore/Autodesk genel inşaat yönetimi; bu spesifik pre-construction optimizasyon modülünü yapmıyor. Somut ROI ($50k-100k/proje) ödeme isteğini destekliyor.",
  },

  // ── AMBIGUOUS (3) — genuine trade-offs, either verdict acceptable ─────────
  {
    id: "ambiguous-01",
    input: "Türk SaaS araçlarını birbirine bağlayan no-code entegrasyon platformu. Logo, Luca, Paratic, Prisync gibi yerel araçlar arasında Zapier'in yapmadığı entegrasyonları kuruyor. Türkiye'de 200+ aktif SaaS var.",
    category: "AMBIGUOUS",
    expectedVerdict: null,
    tolerateAnyVerdict: true,
    difficulty: "medium",
    notes: "Potansiyel: yerelleşme avantajı, Zapier'in Türkiye'de zayıf olması. Risk: pazar büyüklüğü belirsiz, Zapier veya Make her an Türk entegrasyonlarını ekleyebilir.",
  },
  {
    id: "ambiguous-02",
    input: "Uzaktan çalışan ekipler için enerji ve ruh hali takibi yapan haftalık check-in botu. Slack/Teams entegrasyonu ile çalışıyor, ekip liderlerine anonymize iyilik endeksi raporu veriyor. Bazı şirketler bunu zaten elle survey ile yapıyor.",
    category: "AMBIGUOUS",
    expectedVerdict: null,
    tolerateAnyVerdict: true,
    difficulty: "medium",
    notes: "Potansiyel: remote çalışma kalıcı, psikolojik güvenlik önem kazanıyor. Risk: gizlilik endişeleri, Slack/Notion/Lark bu feature'ı absorbe edebilir, benzer araçlar kapandı.",
  },
  {
    id: "ambiguous-03",
    input: "Küçük perakende mağazaları için AI destekli stok yönetim ve sipariş otomasyonu. Satış geçmişine bakarak ne zaman ne kadar sipariş vereceğini söylüyor, tedarikçiye otomatik e-posta atıyor. ERP çok pahalı bulan butik mağaza sahiplerine hitap ediyor.",
    category: "AMBIGUOUS",
    expectedVerdict: null,
    tolerateAnyVerdict: true,
    difficulty: "medium",
    notes: "Potansiyel: küçük perakende ERP'siz, acı gerçek. Risk: Shopify, Square ve Toast bu feature'ı ekliyor; B2SMB satış uzun ve maliyetli; retention düşük olabilir.",
  },
];

// ── Filtered exports ─────────────────────────────────────────────────────────
export const GRAVEYARD_TEST_CASES = TEST_DATASET.filter((tc) => tc.category === "NO_GO_GRAVEYARD");
export const NO_MARKET_TEST_CASES = TEST_DATASET.filter((tc) => tc.category === "NO_GO_NO_MARKET");
export const UNIT_ECONOMICS_TEST_CASES = TEST_DATASET.filter((tc) => tc.category === "NO_GO_UNIT_ECONOMICS");
export const GO_TEST_CASES = TEST_DATASET.filter((tc) => tc.category === "GO_CLEAR");
export const WEDGE_TEST_CASES = TEST_DATASET.filter((tc) => tc.category === "WEDGE_ON_INCUMBENT");
export const AMBIGUOUS_TEST_CASES = TEST_DATASET.filter((tc) => tc.category === "AMBIGUOUS");

// Per-agent-evals.ts uses these — kept as empty arrays since clone testing moved there
export const INCUMBENT_TEST_CASES: typeof TEST_DATASET = [];
export const CLONE_TEST_CASES: typeof TEST_DATASET = [];
