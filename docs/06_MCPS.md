# 06 — MCPs (Model Context Protocol sunucuları)

> MCP = agent'a "el" veren araçlar (GitHub'a PR aç, tarayıcı sür, güncel doküman çek, web ara). Az ve gerekli olanla başla; her MCP bir bakım yüküdür. Aşamalı ekle.

## Faz bazlı kullanım

| MCP | Ne yapar | Hangi agent | Faz |
|-----|----------|-------------|-----|
| **GitHub** | repo/branch/PR/issue işlemleri | orchestrator, tester | 0-2 |
| **Filesystem** | repo dosyalarını oku/yaz | tüm kod agent'ları | 0 (çoğu agent'ta yerleşik) |
| **Playwright** | tarayıcıyı sürerek E2E test | tester | 3 |
| **Context7** | güncel kütüphane dokümanı (2026 API'leri) | frontend, backend | 3 |
| **Web search** (Tavily) | pazar/teknik araştırma | product-owner, tüm agent'lar | 0 ✅ |
| **Supabase** | DB şema/veri okuma (opsiyonel) | architect, backend | 4 |
| **Product Hunt / Reddit** | fikir & pain araştırması | research | 5 |
| **Sentry/observability** (ops.) | hata trace okuma | tester, reviewer | 6+ |

> **2026 notu — neden Context7:** modeller eski kütüphane API'lerini "hatırlar" ve uydurabilir. Context7 güncel dokümanı bağlama enjekte eder; "2026 standardı kod" hedefin için kritik.

> **Sosyal MCP'ler (TikTok/X/IG vb.):** bu projede **yok**. Marketing fazına kadar bekle ve orada bile "üret + onay kuyruğu" — otomatik post için değil.

---

## Kurulum mantığı
- **Worker'daki agent'lar için:** MCP'ler OpenCode (`opencode.json`) ve Claude Code (`.mcp.json` / `claude mcp add`) config'lerinde tanımlanır.
- **Minimum yetki:** her MCP'ye sadece gereken izni ver (GitHub: contents + PR; admin yok).
- **Sırlar env'den:** MCP config'lerine token gömme; env değişkeni referansla.

### Örnek: Claude Code `.mcp.json` (worker)
```json
{
  "mcpServers": {
    "tavily":     { "command": "npx", "args": ["-y", "tavily-mcp"],
                    "env": { "TAVILY_API_KEY": "${TAVILY_API_KEY}" } },
    "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } },
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] },
    "context7":   { "command": "npx", "args": ["-y", "@upstash/context7-mcp@latest"] }
  }
}
```
> Paket adları/sürümler 2026'da değişebilir — kurmadan önce `npm` üzerinde güncel adı doğrula, sürümü pinle.

### Örnek: OpenCode `opencode.json` (ucuz şerit, ilgili kısım)
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tavily":     { "type": "local", "command": ["npx","-y","tavily-mcp"],
                    "env": { "TAVILY_API_KEY": "${TAVILY_API_KEY}" } },
    "github":     { "type": "local", "command": ["npx","-y","@modelcontextprotocol/server-github"] },
    "playwright": { "type": "local", "command": ["npx","-y","@playwright/mcp@latest"] }
  }
}
```

---

## MCP seçim kuralı
1. Bir işi MCP olmadan (basit shell/git) yapabiliyorsan, MCP **ekleme**.
2. Bir MCP eklemeden önce: "bunu kim, hangi fazda kullanacak?" — cevabı yoksa backlog'a at.
3. Her eklenen MCP `04_CONTEXT_TRACKER.md` karar günlüğüne yazılır (sürüm + neden).
4. Çalışmayan/az kullanılan MCP'yi **kaldır**; yüzey alanı = bakım + güvenlik riski.
