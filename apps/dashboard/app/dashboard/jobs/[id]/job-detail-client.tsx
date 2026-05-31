"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { JobRow, RunRow, JobStatus, RunStatus } from "@conductor/core";

interface Props {
  initialJob: JobRow;
  initialRuns: RunRow[];
  /** run_id → est_cost_usd (pre-fetched server-side) */
  costMap: Record<string, number>;
  /** child jobs if decomposed (empty array if none) */
  initialChildJobs: { id: string; title: string; status: JobStatus }[];
}

// ---------------------------------------------------------------------------
// Status metadata
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  JobStatus,
  { label: string; color: string; bg: string; border: string; dot: string; pulse?: boolean }
> = {
  queued: {
    label: "QUEUED",
    color: "var(--text-secondary)",
    bg: "rgba(122,116,104,0.08)",
    border: "var(--text-dim)",
    dot: "var(--text-secondary)",
  },
  running: {
    label: "RUNNING",
    color: "var(--amber)",
    bg: "var(--amber-glow)",
    border: "var(--amber-dim)",
    dot: "var(--amber)",
    pulse: true,
  },
  decomposed: {
    label: "DECOMPOSED",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.25)",
    dot: "#f59e0b",
  },
  review_loop: {
    label: "REVIEW LOOP",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.08)",
    border: "rgba(96,165,250,0.25)",
    dot: "#60a5fa",
    pulse: true,
  },
  test_loop: {
    label: "TEST LOOP",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.25)",
    dot: "#a78bfa",
    pulse: true,
  },
  pr_opened: {
    label: "PR OPENED",
    color: "#34d399",
    bg: "rgba(52,211,153,0.08)",
    border: "#065f46",
    dot: "#34d399",
  },
  merged: {
    label: "MERGED",
    color: "#818cf8",
    bg: "rgba(129,140,248,0.08)",
    border: "#312e81",
    dot: "#818cf8",
  },
  failed: {
    label: "FAILED",
    color: "#f87171",
    bg: "rgba(248,113,113,0.08)",
    border: "#7f1d1d",
    dot: "#f87171",
  },
  needs_human: {
    label: "NEEDS REVIEW",
    color: "#fb923c",
    bg: "rgba(251,146,60,0.08)",
    border: "#7c2d12",
    dot: "#fb923c",
    pulse: true,
  },
  waiting_input: {
    label: "WAITING INPUT",
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.08)",
    border: "rgba(251,191,36,0.3)",
    dot: "#fbbf24",
    pulse: true,
  },
};

const RUN_STATUS_META: Record<RunStatus, { color: string; icon: string }> = {
  started: { color: "var(--amber)", icon: "▷" },
  ok: { color: "#34d399", icon: "✓" },
  retry: { color: "#fb923c", icon: "↺" },
  failed: { color: "#f87171", icon: "✕" },
};

const AGENT_LABELS: Record<string, string> = {
  "product-owner": "Product Owner",
  "codebase-analyst": "Codebase Analyst",
  "tech-lead": "Tech Lead",
  "backend-dev": "Backend Dev",
  "frontend-dev": "Frontend Dev",
  "security-reviewer": "Security Review",
  "code-reviewer": "Code Review",
  "qa-engineer": "QA Engineer",
  architect: "Architect",
  frontend: "Frontend",
  backend: "Backend",
  tester: "Tester",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function jsonPreview(val: unknown): string {
  if (!val) return "";
  try {
    const s = typeof val === "string" ? val : JSON.stringify(val, null, 2);
    return truncate(s, 300);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: JobStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.queued;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs uppercase tracking-widest"
      style={{
        color: meta.color,
        backgroundColor: meta.bg,
        border: `1px solid ${meta.border}`,
        fontSize: "10px",
        letterSpacing: "0.1em",
        fontFamily: "JetBrains Mono, monospace",
        fontWeight: 500,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{
          backgroundColor: meta.dot,
          animation: meta.pulse ? "pulse 1.5s ease-in-out infinite" : "none",
        }}
      />
      {meta.label}
    </span>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <p
      className="uppercase tracking-widest mb-2"
      style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.14em" }}
    >
      {text}
    </p>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="uppercase tracking-widest"
        style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.12em" }}
      >
        {label}
      </span>
      <span
        className="text-xs"
        style={{
          color: "var(--text-secondary)",
          fontFamily: mono ? "JetBrains Mono, monospace" : undefined,
          fontSize: "10px",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function LaneBadge({ lane }: { lane: string | null }) {
  if (!lane) return null;
  const isPremium = lane === "premium";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 5px",
        fontSize: "8px",
        fontFamily: "JetBrains Mono, monospace",
        letterSpacing: "0.08em",
        color: isPremium ? "#c084fc" : "#6ee7b7",
        backgroundColor: isPremium ? "rgba(192,132,252,0.08)" : "rgba(110,231,183,0.08)",
        border: `1px solid ${isPremium ? "rgba(192,132,252,0.25)" : "rgba(110,231,183,0.25)"}`,
      }}
    >
      {isPremium ? "PREMIUM" : "CHEAP"}
    </span>
  );
}

function ModelBadge({ model }: { model: string | null }) {
  if (!model) return null;
  const short = model.split("/").pop() ?? model;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 5px",
        fontSize: "8px",
        fontFamily: "JetBrains Mono, monospace",
        letterSpacing: "0.06em",
        color: "var(--text-dim)",
        backgroundColor: "transparent",
        border: "1px solid var(--border)",
        maxWidth: 140,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {short}
    </span>
  );
}

// Blinking dots for active run
function ActiveDots() {
  return (
    <span
      style={{
        fontFamily: "JetBrains Mono, monospace",
        color: "var(--amber)",
        fontSize: "12px",
        letterSpacing: "0.1em",
        animation: "dots 1.4s steps(4,end) infinite",
      }}
    >
      ···
    </span>
  );
}

// ---------------------------------------------------------------------------
// Waiting Input Form
// ---------------------------------------------------------------------------

function WaitingInputForm({ job }: { job: JobRow }) {
  const spec = job.spec as { open_questions?: string[] } | null;
  const questions = spec?.open_questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q, ""])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const unanswered = questions.filter((q) => !answers[q]?.trim());
    if (unanswered.length > 0) {
      setError("Lütfen tüm soruları cevaplayın.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Bir hata oluştu.");
      }
      // Job status update comes via Realtime — no refresh needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="mb-6 border"
      style={{ borderColor: "rgba(251,191,36,0.35)", backgroundColor: "rgba(251,191,36,0.04)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-5 py-3 border-b"
        style={{ borderColor: "rgba(251,191,36,0.2)" }}
      >
        <span style={{ color: "#fbbf24", fontSize: "13px" }}>?</span>
        <span
          className="uppercase tracking-widest"
          style={{ color: "#fbbf24", fontSize: "10px", letterSpacing: "0.12em", fontFamily: "Syne, sans-serif" }}
        >
          Product Owner şu soruları soruyor
        </span>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="px-5 py-4">
        <div className="flex flex-col gap-5">
          {questions.map((q, i) => (
            <div key={i}>
              <p
                className="mb-2 text-xs font-semibold leading-relaxed"
                style={{ color: "#fef3c7", fontFamily: "Syne, sans-serif" }}
              >
                {q}
              </p>
              <textarea
                value={answers[q] ?? ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
                placeholder="Cevabınız..."
                rows={3}
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: "11px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: "var(--text-primary)",
                  backgroundColor: "var(--surface-raised)",
                  border: "1px solid rgba(251,191,36,0.25)",
                  outline: "none",
                  resize: "vertical",
                  lineHeight: 1.6,
                  opacity: submitting ? 0.6 : 1,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(251,191,36,0.6)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(251,191,36,0.25)")}
              />
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-xs" style={{ color: "#f87171", fontFamily: "JetBrains Mono, monospace" }}>
            {error}
          </p>
        )}

        <div className="mt-4">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 text-xs uppercase tracking-widest transition-all"
            style={{
              fontFamily: "Syne, sans-serif",
              letterSpacing: "0.1em",
              fontSize: "10px",
              color: submitting ? "#92400e" : "#78350f",
              backgroundColor: submitting ? "rgba(251,191,36,0.3)" : "#fbbf24",
              border: "1px solid rgba(251,191,36,0.5)",
              cursor: submitting ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => !submitting && (e.currentTarget.style.backgroundColor = "#f59e0b")}
            onMouseLeave={(e) => !submitting && (e.currentTarget.style.backgroundColor = "#fbbf24")}
          >
            {submitting ? "Gönderiliyor…" : "Cevapla ve Devam Et →"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job status banners
// ---------------------------------------------------------------------------

function JobBanners({
  job,
  childJobs,
}: {
  job: JobRow;
  childJobs: { id: string; title: string; status: JobStatus }[];
}) {
  if (job.status === "pr_opened" && job.pr_url) {
    return (
      <a
        href={job.pr_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between w-full px-6 py-4 mb-6 border transition-all group"
        style={{ borderColor: "#065f46", backgroundColor: "rgba(52,211,153,0.06)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(52,211,153,0.12)";
          e.currentTarget.style.borderColor = "#34d399";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(52,211,153,0.06)";
          e.currentTarget.style.borderColor = "#065f46";
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-8 h-8 flex items-center justify-center flex-shrink-0 text-sm"
            style={{ border: "1px solid #065f46", color: "#34d399" }}
          >
            ✓
          </span>
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: "#34d399", fontFamily: "Syne, sans-serif", letterSpacing: "-0.01em" }}
            >
              PR Hazır
            </p>
            <p className="text-xs" style={{ color: "#6ee7b7", fontSize: "10px" }}>
              {job.pr_url}
            </p>
          </div>
        </div>
        <span className="text-xl transition-transform group-hover:translate-x-1" style={{ color: "#34d399" }}>
          →
        </span>
      </a>
    );
  }

  if (job.status === "needs_human") {
    return (
      <div
        className="mb-6 px-5 py-4 border"
        style={{ borderColor: "#7c2d12", backgroundColor: "rgba(251,146,60,0.06)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: "#fb923c", fontSize: "12px" }}>⚠</span>
          <span
            className="uppercase tracking-widest"
            style={{ color: "#fb923c", fontSize: "10px", letterSpacing: "0.12em", fontFamily: "Syne, sans-serif" }}
          >
            İnsan müdahalesi gerekiyor
          </span>
        </div>
        {job.error && (
          <p
            className="text-xs leading-relaxed"
            style={{ color: "#fed7aa", fontFamily: "JetBrains Mono, monospace" }}
          >
            {job.error}
          </p>
        )}
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div
        className="mb-6 px-5 py-4 border"
        style={{ borderColor: "#7f1d1d", backgroundColor: "rgba(248,113,113,0.06)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: "#f87171", fontSize: "12px" }}>✕</span>
          <span
            className="uppercase tracking-widest"
            style={{ color: "#f87171", fontSize: "10px", letterSpacing: "0.12em", fontFamily: "Syne, sans-serif" }}
          >
            Job başarısız oldu
          </span>
        </div>
        {job.error && (
          <p
            className="text-xs leading-relaxed"
            style={{ color: "#fca5a5", fontFamily: "JetBrains Mono, monospace" }}
          >
            {job.error}
          </p>
        )}
      </div>
    );
  }

  if (job.status === "decomposed" && childJobs && childJobs.length > 0) {
    return (
      <div
        className="mb-6 px-5 py-4 border"
        style={{ borderColor: "rgba(96,165,250,0.3)", backgroundColor: "rgba(96,165,250,0.05)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span style={{ color: "#60a5fa", fontSize: "12px" }}>⊞</span>
          <span
            className="uppercase tracking-widest"
            style={{ color: "#60a5fa", fontSize: "10px", letterSpacing: "0.12em", fontFamily: "Syne, sans-serif" }}
          >
            Alt feature&apos;lara bölündü
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {childJobs.map((child) => {
            const meta = STATUS_META[child.status] ?? STATUS_META.queued;
            return (
              <Link
                key={child.id}
                href={`/dashboard/jobs/${child.id}`}
                className="flex items-center justify-between px-3 py-2 transition-colors"
                style={{
                  backgroundColor: "rgba(96,165,250,0.05)",
                  border: "1px solid rgba(96,165,250,0.15)",
                  color: "#93c5fd",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.12)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.05)")
                }
              >
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px" }}>
                  {child.title}
                </span>
                <span
                  style={{
                    fontSize: "9px",
                    color: meta.color,
                    fontFamily: "JetBrains Mono, monospace",
                    letterSpacing: "0.08em",
                  }}
                >
                  {child.status.toUpperCase()} →
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  if (job.status === "waiting_input") {
    return <WaitingInputForm job={job} />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Timeline run row (accordion)
// ---------------------------------------------------------------------------

function RunRow({
  run,
  cost,
  isLast,
}: {
  run: RunRow;
  cost: number | undefined;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const runMeta = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.started;
  const isActive = run.status === "started";

  const inputPreview = jsonPreview(
    run.input && typeof run.input === "object" ? (run.input as Record<string, unknown>).prompt : run.input,
  );
  const outputPreview = jsonPreview(
    run.output && typeof run.output === "object"
      ? (run.output as Record<string, unknown>).output ?? run.output
      : run.output,
  );
  const errorText =
    run.output && typeof run.output === "object"
      ? ((run.output as Record<string, unknown>).error as string | undefined)
      : undefined;

  return (
    <div
      style={{
        borderBottom: isLast ? "none" : "1px solid var(--border)",
        backgroundColor: "transparent",
        transition: "background 0.12s",
      }}
    >
      {/* Main row — clickable */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
        style={{ display: "block", padding: 0, background: "none", border: "none", cursor: "pointer" }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 transition-colors"
          style={{
            backgroundColor: open ? "var(--surface-overlay)" : "transparent",
          }}
          onMouseEnter={(e) => !open && (e.currentTarget.style.backgroundColor = "var(--surface-raised)")}
          onMouseLeave={(e) => !open && (e.currentTarget.style.backgroundColor = "transparent")}
        >
          {/* Status icon */}
          <div className="flex-shrink-0 w-5 text-center">
            {isActive ? (
              <ActiveDots />
            ) : (
              <span
                style={{
                  fontSize: "12px",
                  color: runMeta.color,
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {runMeta.icon}
              </span>
            )}
          </div>

          {/* Agent name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                style={{
                  fontSize: "11px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: isActive ? "var(--amber)" : "var(--text-primary)",
                }}
              >
                {AGENT_LABELS[run.agent] ?? run.agent}
              </span>
              <ModelBadge model={run.model} />
              <LaneBadge lane={run.lane} />
            </div>
          </div>

          {/* Iter */}
          <div className="flex-shrink-0">
            <span style={{ fontSize: "10px", color: "var(--text-dim)", fontFamily: "JetBrains Mono, monospace" }}>
              #{run.iteration}
            </span>
          </div>

          {/* Status text */}
          <div className="flex-shrink-0 w-16 text-right">
            <span
              style={{
                fontSize: "9px",
                letterSpacing: "0.1em",
                fontFamily: "JetBrains Mono, monospace",
                color: runMeta.color,
              }}
            >
              {run.status.toUpperCase()}
            </span>
          </div>

          {/* Time */}
          <div className="flex-shrink-0 w-20 text-right">
            <span style={{ fontSize: "9px", color: "var(--text-dim)", fontFamily: "JetBrains Mono, monospace" }}>
              {formatTime(run.created_at)}
            </span>
          </div>

          {/* Expand chevron */}
          <div className="flex-shrink-0 w-4">
            <span
              style={{
                fontSize: "9px",
                color: "var(--text-dim)",
                display: "inline-block",
                transform: open ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
              }}
            >
              ▶
            </span>
          </div>
        </div>
      </button>

      {/* Accordion detail */}
      <div
        ref={contentRef}
        style={{
          overflow: "hidden",
          maxHeight: open ? "600px" : "0",
          transition: "max-height 0.25s ease",
        }}
      >
        <div
          style={{
            margin: "0 16px 12px 16px",
            padding: "12px",
            backgroundColor: "var(--surface-raised)",
            border: "1px solid var(--border)",
          }}
        >
          {/* Cost */}
          <div className="flex items-center gap-4 mb-3 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <span
                className="uppercase"
                style={{ fontSize: "8px", letterSpacing: "0.12em", color: "var(--text-dim)" }}
              >
                Tahmini Maliyet
              </span>
              <p
                style={{
                  fontSize: "13px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: cost !== undefined ? "#34d399" : "var(--text-dim)",
                  marginTop: 2,
                }}
              >
                {cost !== undefined ? `$${cost.toFixed(4)}` : "—"}
              </p>
            </div>
            <div>
              <span
                className="uppercase"
                style={{ fontSize: "8px", letterSpacing: "0.12em", color: "var(--text-dim)" }}
              >
                Model
              </span>
              <p style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: "var(--text-secondary)", marginTop: 2 }}>
                {run.model ?? "—"}
              </p>
            </div>
            <div>
              <span
                className="uppercase"
                style={{ fontSize: "8px", letterSpacing: "0.12em", color: "var(--text-dim)" }}
              >
                Lane
              </span>
              <p style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: "var(--text-secondary)", marginTop: 2 }}>
                {run.lane ?? "—"}
              </p>
            </div>
          </div>

          {/* Input */}
          {inputPreview && (
            <div className="mb-3">
              <span
                className="uppercase block mb-1"
                style={{ fontSize: "8px", letterSpacing: "0.12em", color: "var(--text-dim)" }}
              >
                Input
              </span>
              <pre
                style={{
                  fontSize: "10px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {inputPreview}
              </pre>
            </div>
          )}

          {/* Output */}
          {outputPreview && !errorText && (
            <div className="mb-3">
              <span
                className="uppercase block mb-1"
                style={{ fontSize: "8px", letterSpacing: "0.12em", color: "var(--text-dim)" }}
              >
                Output
              </span>
              <pre
                style={{
                  fontSize: "10px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {outputPreview}
              </pre>
            </div>
          )}

          {/* Error */}
          {errorText && (
            <div>
              <span
                className="uppercase block mb-1"
                style={{ fontSize: "8px", letterSpacing: "0.12em", color: "#f87171" }}
              >
                Hata
              </span>
              <pre
                style={{
                  fontSize: "10px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#fca5a5",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {truncate(errorText, 300)}
              </pre>
            </div>
          )}

          {/* Empty state */}
          {!inputPreview && !outputPreview && !errorText && !cost && (
            <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>Detay bilgisi yok.</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function JobDetailClient({ initialJob, initialRuns, costMap, initialChildJobs }: Props) {
  const [job, setJob] = useState<JobRow>(initialJob);
  const [runs, setRuns] = useState<RunRow[]>(initialRuns);
  const [costs, setCosts] = useState<Record<string, number>>(costMap);
  const [childJobs, setChildJobs] = useState<{ id: string; title: string; status: JobStatus }[]>(initialChildJobs);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const supabase = createClient();
    const jobId = initialJob.id;

    // Single channel for all job-scoped subscriptions — fewer WebSocket connections
    const channel = supabase
      .channel(`job-detail-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        (payload) => setJob(payload.new as JobRow),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "jobs", filter: `parent_job_id=eq.${jobId}` },
        (payload) => {
          const child = payload.new as { id: string; title: string; status: JobStatus };
          setChildJobs((prev) => {
            if (prev.some((c) => c.id === child.id)) return prev;
            return [...prev, { id: child.id, title: child.title, status: child.status }];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `parent_job_id=eq.${jobId}` },
        (payload) => {
          const updated = payload.new as { id: string; title: string; status: JobStatus };
          setChildJobs((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, status: updated.status } : c)),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "runs", filter: `job_id=eq.${jobId}` },
        (payload) => setRuns((prev) => [...prev, payload.new as RunRow]),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "runs", filter: `job_id=eq.${jobId}` },
        (payload) => {
          setRuns((prev) =>
            prev.map((r) => (r.id === (payload.new as RunRow).id ? (payload.new as RunRow) : r)),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "usage_log" },
        (payload) => {
          const row = payload.new as { run_id: string; est_cost_usd: number | null };
          if (row.est_cost_usd !== null) {
            setCosts((prev) => ({
              ...prev,
              [row.run_id]: (prev[row.run_id] ?? 0) + row.est_cost_usd!,
            }));
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [initialJob.id]);

  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <div className="mb-6 opacity-0 animate-fade-up" style={{ animationFillMode: "forwards" }}>
        <Link
          href="/dashboard/jobs"
          className="inline-flex items-center gap-2 text-xs transition-colors"
          style={{ color: "var(--text-dim)", fontSize: "10px" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-dim)")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M7 1L3 5l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
          </svg>
          <span className="uppercase tracking-widest" style={{ letterSpacing: "0.12em" }}>
            Jobs
          </span>
        </Link>
      </div>

      {/* Job header */}
      <div
        className="mb-6 opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards", animationDelay: "60ms" }}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1
            className="text-xl font-bold leading-tight"
            style={{ fontFamily: "Syne, sans-serif", color: "var(--text-primary)", letterSpacing: "-0.02em" }}
          >
            {job.title}
          </h1>
          <div className="flex-shrink-0 pt-0.5">
            <StatusBadge status={job.status} />
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4">
          <MetaItem label="ID" value={job.id.split("-")[0] ?? job.id} mono />
          <MetaItem label="TYPE" value={job.type.toUpperCase()} mono />
          <MetaItem label="LANE" value={job.lane_preference.toUpperCase()} mono />
          {job.branch && <MetaItem label="BRANCH" value={job.branch} mono />}
          <MetaItem label="CREATED" value={mounted ? formatRelative(job.created_at) : "—"} />
          {totalCost > 0 && (
            <MetaItem label="EST. COST" value={`$${totalCost.toFixed(4)}`} mono />
          )}
        </div>
      </div>

      {/* Status banners */}
      <div
        className="opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards", animationDelay: "100ms" }}
      >
        <JobBanners job={job} childJobs={childJobs} />
      </div>

      {/* Description */}
      <div
        className="mb-6 opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards", animationDelay: "150ms" }}
      >
        <SectionLabel text="Description" />
        <div
          className="px-4 py-3 border"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
        >
          <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
            {job.description}
          </p>
        </div>
      </div>

      {/* Branch meta */}
      {job.branch && (
        <div
          className="mb-6 flex flex-wrap gap-3 opacity-0 animate-fade-up"
          style={{ animationFillMode: "forwards", animationDelay: "180ms" }}
        >
          <div
            className="inline-flex items-center gap-2 px-3 py-2 border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 1v5.5C2 7.3 2.7 8 3.5 8H6M6 8L4.5 6.5M6 8L4.5 9.5"
                stroke="var(--text-dim)"
                strokeWidth="1.2"
                strokeLinecap="square"
              />
              <circle cx="2" cy="1" r="1" fill="var(--text-dim)" />
              <circle cx="8" cy="5" r="1" fill="var(--text-dim)" />
            </svg>
            <span
              className="text-xs"
              style={{ color: "var(--text-secondary)", fontFamily: "JetBrains Mono, monospace", fontSize: "11px" }}
            >
              {job.branch}
            </span>
          </div>
          {job.pr_url && (
            <a
              href={job.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 border transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#34d399")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <span style={{ color: "#34d399", fontFamily: "JetBrains Mono, monospace", fontSize: "11px" }}>
                View PR ↗
              </span>
            </a>
          )}
        </div>
      )}

      {/* Timeline */}
      <div
        className="opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards", animationDelay: "210ms" }}
      >
        <div className="flex items-center justify-between mb-3">
          <SectionLabel text="Agent Timeline" />
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "#34d399", animation: "pulse 2s ease-in-out infinite" }}
            />
            <span className="text-xs" style={{ color: "var(--text-dim)", fontSize: "10px" }}>
              live
            </span>
          </div>
        </div>

        {runs.length === 0 ? (
          <div
            className="flex items-center gap-3 px-4 py-6 border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
          >
            <span style={{ color: "var(--text-dim)", fontSize: "10px" }}>
              Henüz agent run yok. Worker bu job&apos;u almayı bekliyor.
            </span>
          </div>
        ) : (
          <div className="border" style={{ borderColor: "var(--border)" }}>
            {/* Column header */}
            <div
              className="flex items-center gap-3 px-4 py-2"
              style={{ borderBottom: "1px solid var(--border)", backgroundColor: "var(--surface-raised)" }}
            >
              <div className="w-5" />
              <div className="flex-1">
                <span
                  className="uppercase tracking-widest"
                  style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.12em" }}
                >
                  AGENT / MODEL / LANE
                </span>
              </div>
              <span className="uppercase tracking-widest" style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.12em", width: 24 }}>
                #
              </span>
              <span className="uppercase tracking-widest" style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.12em", width: 64, textAlign: "right" }}>
                STATUS
              </span>
              <span className="uppercase tracking-widest" style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.12em", width: 80, textAlign: "right" }}>
                TIME
              </span>
              <div className="w-4" />
            </div>

            {runs.map((run, i) => (
              <RunRow
                key={run.id}
                run={run}
                cost={costs[run.id]}
                isLast={i === runs.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes dots {
          0%   { content: "·"; }
          25%  { content: "··"; }
          50%  { content: "···"; }
          75%  { content: "····"; }
          100% { content: "·"; }
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
