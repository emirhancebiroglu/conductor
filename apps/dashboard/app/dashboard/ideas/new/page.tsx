"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewIdeaPage() {
  const router = useRouter();
  const [theme, setTheme] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 20) {
      setError("Fikir açıklaması en az 20 karakter olmalı.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: theme.trim() || undefined,
          description: description.trim(),
          target_audience: audience.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({})) as { job?: { id: string }; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Bir hata oluştu.");
      if (!data.job?.id) throw new Error("Job ID alınamadı.");

      router.push(`/dashboard/jobs/${data.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      {/* Back */}
      <div className="mb-8">
        <Link
          href="/dashboard/jobs"
          className="inline-flex items-center gap-2 transition-colors"
          style={{ color: "var(--text-dim)", fontSize: "10px", textDecoration: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-dim)")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M7 1L3 5l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
          </svg>
          <span className="uppercase tracking-widest" style={{ letterSpacing: "0.12em" }}>Jobs</span>
        </Link>
      </div>

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <span
            className="flex items-center justify-center w-8 h-8 text-lg flex-shrink-0"
            style={{ border: "1px solid rgba(56,189,248,0.4)", backgroundColor: "rgba(56,189,248,0.06)" }}
          >
            💡
          </span>
          <div>
            <p
              className="uppercase tracking-widest"
              style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.16em", marginBottom: 4 }}
            >
              Idea Pipeline
            </p>
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: "Syne, sans-serif", color: "var(--text-primary)", letterSpacing: "-0.02em" }}
            >
              Yeni Ürün Fikri
            </h1>
          </div>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: "11px", lineHeight: 1.7, maxWidth: 480 }}>
          Bir cümlelik fikrinden araştırma → doğrulama → PRD → MVP kapsamı → repo iskeleti üretiriz.
          Sen sadece ne çözmek istediğini söyle.
        </p>
      </div>

      {/* Process steps */}
      <div
        className="mb-8 p-4 border"
        style={{ borderColor: "rgba(56,189,248,0.15)", backgroundColor: "rgba(56,189,248,0.03)" }}
      >
        <div className="flex gap-0">
          {[
            { icon: "🔍", label: "Araştırma" },
            { icon: "⚡", label: "Kill Test" },
            { icon: "⚖️", label: "Tartışma" },
            { icon: "📋", label: "PRD" },
            { icon: "🏗️", label: "Scaffold" },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center gap-1 px-3">
                <span style={{ fontSize: "14px" }}>{step.icon}</span>
                <span style={{ fontSize: "8px", color: "var(--text-dim)", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                  {step.label.toUpperCase()}
                </span>
              </div>
              {i < arr.length - 1 && (
                <span style={{ color: "rgba(56,189,248,0.3)", fontSize: "10px" }}>→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Theme */}
        <div>
          <label
            htmlFor="theme"
            className="block uppercase tracking-widest mb-2"
            style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.14em" }}
          >
            Tema <span style={{ opacity: 0.5 }}>(opsiyonel)</span>
          </label>
          <input
            id="theme"
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="ör: developer tools, B2B SaaS, tüketici uygulaması..."
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "12px",
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--text-primary)",
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border)",
              outline: "none",
              opacity: loading ? 0.6 : 1,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(56,189,248,0.5)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <p style={{ marginTop: 4, fontSize: "9px", color: "var(--text-dim)" }}>
            Odaklanılacak alan — boş bırakırsan sistem seçer
          </p>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="description"
            className="block uppercase tracking-widest mb-2"
            style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.14em" }}
          >
            Fikir / Problem <span style={{ color: "#f87171" }}>*</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ne çözmek istiyorsun? Hangi acıyı hissediyorsun? Rakipler neden yetersiz?..."
            rows={5}
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "12px",
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--text-primary)",
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border)",
              outline: "none",
              resize: "vertical",
              lineHeight: 1.7,
              opacity: loading ? 0.6 : 1,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(56,189,248,0.5)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <div className="flex justify-between mt-1">
            <p style={{ fontSize: "9px", color: "var(--text-dim)" }}>Min. 20 karakter</p>
            <p style={{ fontSize: "9px", color: description.length < 20 ? "var(--text-dim)" : "#34d399" }}>
              {description.length} karakter
            </p>
          </div>
        </div>

        {/* Audience */}
        <div>
          <label
            htmlFor="audience"
            className="block uppercase tracking-widest mb-2"
            style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.14em" }}
          >
            Hedef Kitle <span style={{ opacity: 0.5 }}>(opsiyonel)</span>
          </label>
          <input
            id="audience"
            type="text"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="ör: solo developer'lar, küçük işletmeler, içerik üreticileri..."
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "12px",
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--text-primary)",
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border)",
              outline: "none",
              opacity: loading ? 0.6 : 1,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(56,189,248,0.5)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <p style={{ marginTop: 4, fontSize: "9px", color: "var(--text-dim)" }}>Kimler kullanacak?</p>
        </div>

        {/* Error */}
        {error && (
          <div
            className="px-4 py-3 border"
            style={{ borderColor: "rgba(248,113,113,0.3)", backgroundColor: "rgba(248,113,113,0.05)" }}
          >
            <p style={{ fontSize: "11px", color: "#fca5a5", fontFamily: "JetBrains Mono, monospace" }}>{error}</p>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={loading || description.trim().length < 20}
            style={{
              padding: "10px 24px",
              fontSize: "10px",
              fontFamily: "Syne, sans-serif",
              letterSpacing: "0.12em",
              color: loading || description.trim().length < 20 ? "var(--text-dim)" : "#0c1524",
              backgroundColor: loading || description.trim().length < 20
                ? "rgba(56,189,248,0.1)"
                : "#38bdf8",
              border: `1px solid ${loading || description.trim().length < 20 ? "rgba(56,189,248,0.2)" : "#38bdf8"}`,
              cursor: loading || description.trim().length < 20 ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              textTransform: "uppercase",
            }}
            onMouseEnter={(e) => {
              if (!loading && description.trim().length >= 20) {
                e.currentTarget.style.backgroundColor = "#7dd3fc";
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && description.trim().length >= 20) {
                e.currentTarget.style.backgroundColor = "#38bdf8";
              }
            }}
          >
            {loading ? "Başlatılıyor…" : "🔍 Araştırmayı Başlat"}
          </button>
          {loading && (
            <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
              Job oluşturuluyor, yönlendiriliyorsunuz…
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
