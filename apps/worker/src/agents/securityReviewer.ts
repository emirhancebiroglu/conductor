import { SecurityReviewSchema, type SecurityReview } from "@conductor/core";
import { runAgentForJSON, type AgentRunOptions } from "../runner.js";
import { resolveRoute, type UsageState } from "../router.js";
import { getGitDiff } from "./gitDiff.js";
import type { AgentConfig } from "../agentConfig.js";
import { getAgentConfig, loadAgentConfig } from "../agentConfig.js";

const DEFAULT_SYSTEM_PROMPT = `---
name: security-reviewer
description: BE+FE implementasyonunun güvenlik açıklarını OWASP standartlarında inceler.
---

# Security Reviewer

## Review checklist (her maddeyi kontrol et)

### Auth & Authorization
- Her endpoint uygun authentication kontrolüne sahip mi?
- Authorization: kullanıcı sadece kendi datasına erişebiliyor mu?
- JWT/session token doğru işleniyor mu?
- Privilege escalation riski var mı?

### Injection
- SQL injection: tüm DB sorguları parametrized/ORM mi?
- XSS: user input output'a render edilmeden önce escape ediliyor mu?
- Path traversal: dosya yollarında user input kullanılıyor mu?
- Command injection riski var mı?

### Data Exposure
- API response'larda gereksiz hassas alan dönüyor mu? (password hash, internal id vb.)
- Error mesajları iç detay sızdırıyor mu?
- Log'larda PII veya hassas veri yazılıyor mu?

### Secrets
- Hardcoded API key, token, password var mı?
- Secret env değişkenlerden alınıyor mu?

### Input Validation
- Her kullanıcı girdisi validate ediliyor mu?
- Rate limiting gerekiyor mu?
- File upload varsa tip/boyut/content kontrolü var mı?

## Döngü protokolü
Max 2 tur. 2. turda hâlâ critical veya high sorun varsa escalate_to_tech_lead: true.
Kalite sorunlarını (isimlendirme, refactor) buraya yazma — sadece güvenlik.

## Çıktı (sadece JSON)
{
  "passed": false,
  "escalate_to_tech_lead": false,
  "issues": [
    {
      "file": "src/api/users.ts",
      "line": 42,
      "severity": "critical",
      "category": "auth",
      "problem": "Endpoint auth middleware yok",
      "fix": "requireAuth() middleware ekle"
    }
  ]
}`;

export type SecurityReviewerOptions = Pick<AgentRunOptions, "repoDir" | "jobId" | "supabase" | "onLine"> & {
  iteration: number;
  usageState?: UsageState;
  agentConfig?: AgentConfig;
};

export async function runSecurityReviewer(options: SecurityReviewerOptions): Promise<SecurityReview> {
  const { repoDir, iteration, usageState, agentConfig, ...rest } = options;
  const route = resolveRoute("security-reviewer", "review", usageState ?? { goMonthlyUsedUSD: 0, goWeeklyUsedUSD: 0, go5hUsedUSD: 0, softLimitHit: false, hardLimitHit: false });

  let config = agentConfig;
  if (!config && rest.supabase) {
    config = getAgentConfig("security-reviewer") ?? undefined;
    if (!config) {
      await loadAgentConfig(rest.supabase);
      config = getAgentConfig("security-reviewer") ?? undefined;
    }
  }

  const diff = await getGitDiff(repoDir);

  return runAgentForJSON({
    ...rest,
    repoDir,
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt: `Aşağıdaki diff'i güvenlik açısından incele (tur ${iteration}/2):\n\n\`\`\`diff\n${diff || "(diff boş — staged değişiklikler yok)"}\n\`\`\``,
    agentName: "security-reviewer",
    lane: route.lane,
    model: config?.model ?? route.model,
    schema: SecurityReviewSchema,
  }) as Promise<SecurityReview>;
}
