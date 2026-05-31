"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CostsPayload } from "@/app/api/costs/route";

// ---------------------------------------------------------------------------
// Bar colour logic  (mirrors docs/08_COST_AND_LIMITS.md)
// ---------------------------------------------------------------------------

function barColor(used: number, soft: number, hard: number): string {
  if (used >= hard * 0.8) return "#f87171"; // > 80% hard → red
  if (used >= soft) return "#fb923c";        // > soft → orange
  if (used >= soft * 0.6) return "#fbbf24";  // 60-100% soft → yellow
  return "#34d399";                           // < 60% soft → green
}

function barWidth(used: number, hard: number): number {
  return Math.min((used / hard) * 100, 100);
}

// ---------------------------------------------------------------------------
// Status colours
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--text-dim)",
  running: "var(--amber)",
  decomposed: "#f59e0b",
  review_loop: "#60a5fa",
  test_loop: "#a78bfa",
  pr_opened: "#34d399",
  merged: "#818cf8",
  failed: "#f87171",
  needs_human: "#fb923c",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAgent(name: string): string {
  const MAP: Record<string, string> = {
    "product-owner": "product-owner",
    "codebase-analyst": "codebase-analyst",
    "tech-lead": "tech-lead",
    "backend-dev": "backend-dev",
    "frontend-dev": "frontend-dev",
    "security-reviewer": "security-reviewer",
    "code-reviewer": "code-reviewer",
    "qa-engineer": "qa-engineer",
  };
  return MAP[name] ?? name;
}

// ---------------------------------------------------------------------------
// Limit bar
// ---------------------------------------------------------------------------

function LimitBar({
  label,
  used,
  soft,
  hard,
  delay,
}: {
  label: string;
  used: number;
  soft: number;
  hard: number;
  delay: number;
}) {
  const color = barColor(used, soft, hard);
  const softPct = (soft / hard) * 100;
  const widthPct = barWidth(used, hard);
  const isOver = used >= soft;

  return (
    <div
      className="opacity-0 animate-fade-up"
      style={{ animationFillMode: "forwards", animationDelay: `${delay}ms` }}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <span
          style={{
            fontSize: "10px",
            fontFamily: "JetBrains Mono, monospace",
            letterSpacing: "0.08em",
            color: "var(--text-secondary)",
          }}
        >
          {label}
        </span>
        <div className="flex items-baseline gap-2">
          <span
            style={{
              fontSize: "14px",
              fontFamily: "JetBrains Mono, monospace",
              color: isOver ? color : "var(--text-primary)",
              fontWeight: 600,
            }}
          >
            ${used.toFixed(2)}
          </span>
          <span style={{ fontSize: "9px", color: "var(--text-dim)", fontFamily: "JetBrains Mono, monospace" }}>
            / ${soft} soft · ${hard} hard
          </span>
        </div>
      </div>

      {/* Track */}
      <div
        style={{
          position: "relative",
          height: 6,
          backgroundColor: "rgba(255,255,255,0.04)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        {/* Soft limit marker */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${softPct}%`,
            width: 1,
            backgroundColor: "rgba(255,255,255,0.15)",
            zIndex: 2,
          }}
        />
        {/* Fill */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: `${widthPct}%`,
            backgroundColor: color,
            transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
            boxShadow: `0 0 8px ${color}66`,
          }}
        />
      </div>

      {isOver && (
        <p
          style={{
            fontSize: "9px",
            color,
            fontFamily: "JetBrains Mono, monospace",
            marginTop: 4,
            letterSpacing: "0.08em",
          }}
        >
          ⚠ soft limit aşıldı — router ucuz modele düşürüldü
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  color,
  delay,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  delay: number;
}) {
  return (
    <div
      className="opacity-0 animate-fade-up"
      style={{
        animationFillMode: "forwards",
        animationDelay: `${delay}ms`,
        padding: "16px",
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
      }}
    >
      <p
        style={{
          fontSize: "9px",
          letterSpacing: "0.14em",
          color: "var(--text-dim)",
          fontFamily: "JetBrains Mono, monospace",
          marginBottom: 6,
          textTransform: "uppercase",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: "22px",
          fontFamily: "Syne, sans-serif",
          fontWeight: 700,
          color: color ?? "var(--text-primary)",
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        {value}
      </p>
      {sub && (
        <p
          style={{
            fontSize: "10px",
            color: "var(--text-dim)",
            fontFamily: "JetBrains Mono, monospace",
            marginTop: 4,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

export function CostsClient() {
  const [data, setData] = useState<CostsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/costs");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as CostsPayload;
      setData(json);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div
        className="flex items-center justify-between mb-8 opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards" }}
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              style={{
                fontSize: "10px",
                letterSpacing: "0.12em",
                color: "var(--text-dim)",
                fontFamily: "JetBrains Mono, monospace",
                textTransform: "uppercase",
              }}
            >
              T-405
            </span>
            <span style={{ color: "var(--text-dim)", fontSize: "10px" }}>·</span>
            <span
              style={{
                fontSize: "10px",
                letterSpacing: "0.12em",
                color: "var(--text-dim)",
                fontFamily: "JetBrains Mono, monospace",
                textTransform: "uppercase",
              }}
            >
              LIMIT TRACKER
            </span>
          </div>
          <h1
            style={{
              fontFamily: "Syne, sans-serif",
              fontSize: "24px",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            Maliyet & Limitler
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span
              style={{
                fontSize: "9px",
                color: "var(--text-dim)",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {lastRefreshed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              border: "1px solid var(--border)",
              backgroundColor: loading ? "var(--surface-raised)" : "transparent",
              color: loading ? "var(--text-dim)" : "var(--text-secondary)",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "10px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.borderColor = "var(--amber)";
                e.currentTarget.style.color = "var(--amber)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              style={{ animation: loading ? "spin 1s linear infinite" : "none" }}
            >
              <path
                d="M9 5A4 4 0 1 1 5 1M5 1L7 3M5 1L3 3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="square"
              />
            </svg>
            Yenile
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-6 px-4 py-3 border"
          style={{ borderColor: "#7f1d1d", backgroundColor: "rgba(248,113,113,0.06)" }}
        >
          <p style={{ fontSize: "11px", color: "#fca5a5", fontFamily: "JetBrains Mono, monospace" }}>
            ✕ {error}
          </p>
        </div>
      )}

      {/* Skeleton */}
      {loading && !data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[80, 56, 56].map((h, i) => (
            <div
              key={i}
              style={{
                height: h,
                backgroundColor: "var(--surface-raised)",
                border: "1px solid var(--border)",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* ── CARD 1: OpenCode Go limits ─────────────────────────────────── */}
          <section
            className="mb-6 opacity-0 animate-fade-up"
            style={{
              animationFillMode: "forwards",
              animationDelay: "80ms",
              border: "1px solid var(--border)",
              backgroundColor: "var(--surface-raised)",
              padding: "20px 24px",
            }}
          >
            <div className="flex items-center gap-2 mb-5">
              <div
                style={{
                  width: 4,
                  height: 16,
                  backgroundColor: "var(--amber)",
                  flexShrink: 0,
                }}
              />
              <p
                style={{
                  fontSize: "11px",
                  fontFamily: "Syne, sans-serif",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                OpenCode Go — Kullanım Limitleri
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <LimitBar
                label="5 Saatlik"
                used={data.limits.last5h.used}
                soft={data.limits.last5h.soft}
                hard={data.limits.last5h.hard}
                delay={120}
              />
              <LimitBar
                label="Haftalık"
                used={data.limits.last7d.used}
                soft={data.limits.last7d.soft}
                hard={data.limits.last7d.hard}
                delay={160}
              />
              <LimitBar
                label="Aylık"
                used={data.limits.thisMonth.used}
                soft={data.limits.thisMonth.soft}
                hard={data.limits.thisMonth.hard}
                delay={200}
              />
            </div>

            {/* Legend */}
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 mt-5 pt-4"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {[
                { color: "#34d399", label: "< 60% soft" },
                { color: "#fbbf24", label: "60–100% soft" },
                { color: "#fb923c", label: "> soft limit" },
                { color: "#f87171", label: "> 80% hard" },
              ].map((l) => (
                <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, backgroundColor: l.color, flexShrink: 0 }} />
                  <span
                    style={{
                      fontSize: "9px",
                      color: "var(--text-dim)",
                      fontFamily: "JetBrains Mono, monospace",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {l.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ── CARD 2: Bu haftanın özeti ─────────────────────────────────── */}
          <section className="mb-6">
            <div
              className="flex items-center gap-2 mb-3 opacity-0 animate-fade-up"
              style={{ animationFillMode: "forwards", animationDelay: "240ms" }}
            >
              <div style={{ width: 4, height: 16, backgroundColor: "#60a5fa", flexShrink: 0 }} />
              <p
                style={{
                  fontSize: "11px",
                  fontFamily: "Syne, sans-serif",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Bu Haftanın Özeti
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <StatTile
                label="Toplam Job"
                value={String(data.weekSummary.totalJobs)}
                delay={260}
              />
              <StatTile
                label="Başarılı PR"
                value={String(data.weekSummary.successfulPRs)}
                color="#34d399"
                delay={280}
              />
              <StatTile
                label="İnsan Kapısı"
                value={String(data.weekSummary.needsHuman)}
                color={data.weekSummary.needsHuman > 0 ? "#fb923c" : "var(--text-primary)"}
                delay={300}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <StatTile
                label="Toplam Maliyet"
                value={`$${data.weekSummary.totalCostUsd.toFixed(2)}`}
                color="var(--amber)"
                delay={320}
              />
              <StatTile
                label="Ortalama / Job"
                value={`$${data.weekSummary.avgJobCostUsd.toFixed(2)}`}
                delay={340}
              />
              <StatTile
                label="En Pahalı Agent"
                value={data.weekSummary.topAgent ? `$${data.weekSummary.topAgent.costUsd.toFixed(2)}` : "—"}
                {...(data.weekSummary.topAgent ? { sub: formatAgent(data.weekSummary.topAgent.name) } : {})}
                color={data.weekSummary.topAgent ? "#f87171" : "var(--text-dim)"}
                delay={360}
              />
            </div>
          </section>

          {/* ── CARD 3: Son 20 job ────────────────────────────────────────── */}
          <section
            className="opacity-0 animate-fade-up"
            style={{ animationFillMode: "forwards", animationDelay: "400ms" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div style={{ width: 4, height: 16, backgroundColor: "#a78bfa", flexShrink: 0 }} />
              <p
                style={{
                  fontSize: "11px",
                  fontFamily: "Syne, sans-serif",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Son Job Maliyetleri
              </p>
            </div>

            <div style={{ border: "1px solid var(--border)" }}>
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 140px 60px 80px 100px",
                  padding: "8px 16px",
                  borderBottom: "1px solid var(--border)",
                  backgroundColor: "var(--surface-raised)",
                  gap: 8,
                }}
              >
                {["JOB", "TARİH", "AGENT", "MALİYET", "DURUM"].map((h) => (
                  <span
                    key={h}
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.12em",
                      color: "var(--text-dim)",
                      fontFamily: "JetBrains Mono, monospace",
                      textTransform: "uppercase",
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              {data.recentJobs.length === 0 && (
                <div style={{ padding: "24px 16px", textAlign: "center" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                    Henüz job yok.
                  </span>
                </div>
              )}

              {data.recentJobs.map((job, i) => {
                const statusColor = STATUS_COLORS[job.status] ?? "var(--text-dim)";
                return (
                  <Link
                    key={job.id}
                    href={`/dashboard/jobs/${job.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 140px 60px 80px 100px",
                      padding: "10px 16px",
                      borderBottom:
                        i < data.recentJobs.length - 1 ? "1px solid var(--border)" : "none",
                      gap: 8,
                      textDecoration: "none",
                      transition: "background 0.12s",
                      backgroundColor: "transparent",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "var(--surface-raised)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    {/* Title */}
                    <div style={{ overflow: "hidden" }}>
                      <p
                        style={{
                          fontSize: "11px",
                          fontFamily: "JetBrains Mono, monospace",
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {job.title}
                      </p>
                      <p style={{ fontSize: "9px", color: "var(--text-dim)", marginTop: 1 }}>
                        {job.id.split("-")[0]}
                      </p>
                    </div>

                    {/* Date */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: "9px",
                          color: "var(--text-dim)",
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {formatDate(job.createdAt)}
                      </span>
                    </div>

                    {/* Agent count */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          color: job.agentCount > 0 ? "var(--text-secondary)" : "var(--text-dim)",
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {job.agentCount > 0 ? job.agentCount : "—"}
                      </span>
                    </div>

                    {/* Cost */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "JetBrains Mono, monospace",
                          color: job.costUsd > 0 ? "#34d399" : "var(--text-dim)",
                          fontWeight: job.costUsd > 0 ? 500 : 400,
                        }}
                      >
                        {job.costUsd > 0 ? `$${job.costUsd.toFixed(3)}` : "—"}
                      </span>
                    </div>

                    {/* Status */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: "9px",
                          fontFamily: "JetBrains Mono, monospace",
                          color: statusColor,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        {job.status.replace("_", " ")}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes animate-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-up {
          animation: animate-fade-up 0.3s ease forwards;
        }
      `}</style>
    </div>
  );
}
