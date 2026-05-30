"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { JobRow, RunRow, JobStatus, RunStatus } from "@conductor/core";

interface Props {
  initialJob: JobRow;
  initialRuns: RunRow[];
}

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
};

const RUN_STATUS_META: Record<RunStatus, { color: string; icon: string }> = {
  started: { color: "var(--amber)", icon: "▷" },
  ok: { color: "#34d399", icon: "✓" },
  retry: { color: "#fb923c", icon: "↺" },
  failed: { color: "#f87171", icon: "✕" },
};

const AGENT_LABELS: Record<string, string> = {
  "product-owner": "Product Owner",
  architect: "Architect",
  frontend: "Frontend",
  backend: "Backend",
  "code-reviewer": "Code Review",
  tester: "Tester",
};

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

export function JobDetailClient({ initialJob, initialRuns }: Props) {
  const [job, setJob] = useState<JobRow>(initialJob);
  const [runs, setRuns] = useState<RunRow[]>(initialRuns);

  useEffect(() => {
    const supabase = createClient();

    const jobChannel = supabase
      .channel(`job-${job.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "jobs",
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          setJob(payload.new as JobRow);
        }
      )
      .subscribe();

    const runsChannel = supabase
      .channel(`runs-${job.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "runs",
          filter: `job_id=eq.${job.id}`,
        },
        (payload) => {
          setRuns((prev) => [...prev, payload.new as RunRow]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "runs",
          filter: `job_id=eq.${job.id}`,
        },
        (payload) => {
          setRuns((prev) =>
            prev.map((r) =>
              r.id === (payload.new as RunRow).id ? (payload.new as RunRow) : r
            )
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(jobChannel);
      void supabase.removeChannel(runsChannel);
    };
  }, [job.id]);

  const meta = STATUS_META[job.status] ?? STATUS_META.queued;

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <div
        className="mb-6 opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards" }}
      >
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
            style={{
              fontFamily: "Syne, sans-serif",
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
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
          <MetaItem label="CREATED" value={formatRelative(job.created_at)} />
        </div>
      </div>

      {/* Failed error box */}
      {job.status === "failed" && job.error && (
        <div
          className="mb-6 px-4 py-3 border opacity-0 animate-fade-up"
          style={{
            borderColor: "#7f1d1d",
            backgroundColor: "rgba(127,29,29,0.10)",
            animationFillMode: "forwards",
            animationDelay: "120ms",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: "#f87171", fontSize: "10px" }}>✕</span>
            <span
              className="uppercase tracking-widest"
              style={{ color: "#f87171", fontSize: "9px", letterSpacing: "0.12em" }}
            >
              Error
            </span>
          </div>
          <p
            className="text-xs leading-relaxed"
            style={{ color: "#fca5a5", fontFamily: "JetBrains Mono, monospace" }}
          >
            {job.error}
          </p>
        </div>
      )}

      {/* PR opened — big CTA */}
      {job.status === "pr_opened" && job.pr_url && (
        <div
          className="mb-6 opacity-0 animate-fade-up"
          style={{ animationFillMode: "forwards", animationDelay: "120ms" }}
        >
          <a
            href={job.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between w-full px-6 py-4 border transition-all group"
            style={{
              borderColor: "#065f46",
              backgroundColor: "rgba(52,211,153,0.06)",
            }}
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
                className="w-8 h-8 flex items-center justify-center flex-shrink-0"
                style={{ border: "1px solid #065f46", color: "#34d399" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <circle cx="3" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <circle cx="11" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M3 4.5v5M4.5 3h3.5c1.1 0 2 .9 2 2v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
                </svg>
              </span>
              <div>
                <p
                  className="text-sm font-semibold"
                  style={{
                    color: "#34d399",
                    fontFamily: "Syne, sans-serif",
                    letterSpacing: "-0.01em",
                  }}
                >
                  PR'ı İncele
                </p>
                <p className="text-xs" style={{ color: "#6ee7b7", fontSize: "10px" }}>
                  {job.pr_url}
                </p>
              </div>
            </div>
            <span
              className="text-xl transition-transform group-hover:translate-x-1"
              style={{ color: "#34d399" }}
            >
              →
            </span>
          </a>
        </div>
      )}

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
          <p
            className="text-xs leading-relaxed whitespace-pre-wrap"
            style={{ color: "var(--text-secondary)" }}
          >
            {job.description}
          </p>
        </div>
      </div>

      {/* Branch + PR meta */}
      {(job.branch || job.pr_url) && (
        <div
          className="mb-6 flex flex-wrap gap-3 opacity-0 animate-fade-up"
          style={{ animationFillMode: "forwards", animationDelay: "180ms" }}
        >
          {job.branch && (
            <div
              className="inline-flex items-center gap-2 px-3 py-2 border"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-raised)",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 1v5.5C2 7.3 2.7 8 3.5 8H6M6 8L4.5 6.5M6 8L4.5 9.5" stroke="var(--text-dim)" strokeWidth="1.2" strokeLinecap="square" />
                <circle cx="2" cy="1" r="1" fill="var(--text-dim)" />
                <circle cx="8" cy="5" r="1" fill="var(--text-dim)" />
              </svg>
              <span
                className="text-xs"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "11px",
                }}
              >
                {job.branch}
              </span>
            </div>
          )}
          {job.pr_url && (
            <a
              href={job.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 border transition-colors"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-secondary)",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#34d399")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 9L9 1M9 1H3M9 1v6" stroke="#34d399" strokeWidth="1.4" strokeLinecap="square" />
              </svg>
              <span
                className="text-xs"
                style={{
                  color: "#34d399",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "11px",
                }}
              >
                View PR ↗
              </span>
            </a>
          )}
        </div>
      )}

      {/* Agent run log */}
      <div
        className="opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards", animationDelay: "210ms" }}
      >
        <div className="flex items-center justify-between mb-3">
          <SectionLabel text="Agent Runs" />
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
              No agent runs yet. Waiting for worker to pick up this job.
            </span>
          </div>
        ) : (
          <div
            className="border"
            style={{ borderColor: "var(--border)" }}
          >
            {/* Run header */}
            <div
              className="grid px-4 py-2"
              style={{
                gridTemplateColumns: "24px 1fr 90px 80px 80px",
                borderBottom: "1px solid var(--border)",
                backgroundColor: "var(--surface-raised)",
              }}
            >
              {["", "AGENT", "STATUS", "ITER", "TIME"].map((h) => (
                <span
                  key={h}
                  className="uppercase tracking-widest"
                  style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.12em" }}
                >
                  {h}
                </span>
              ))}
            </div>

            {runs.map((run, i) => {
              const runMeta = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.started;
              return (
                <div
                  key={run.id}
                  className="grid px-4 py-3 transition-colors"
                  style={{
                    gridTemplateColumns: "24px 1fr 90px 80px 80px",
                    borderBottom:
                      i < runs.length - 1 ? "1px solid var(--border)" : "none",
                    backgroundColor: "transparent",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "var(--surface-overlay)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  {/* Status icon */}
                  <div className="flex items-center">
                    <span
                      className="text-xs"
                      style={{
                        color: runMeta.color,
                        fontSize: "11px",
                        animation:
                          run.status === "started"
                            ? "pulse 1.5s ease-in-out infinite"
                            : "none",
                      }}
                    >
                      {runMeta.icon}
                    </span>
                  </div>

                  {/* Agent */}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span
                      className="text-xs"
                      style={{
                        color: "var(--text-primary)",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: "11px",
                      }}
                    >
                      {AGENT_LABELS[run.agent] ?? run.agent}
                    </span>
                    {run.model && (
                      <span
                        className="text-xs truncate"
                        style={{
                          color: "var(--text-dim)",
                          fontSize: "9px",
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {run.model}
                        {run.lane ? ` · ${run.lane}` : ""}
                      </span>
                    )}
                  </div>

                  {/* Run status */}
                  <div className="flex items-center">
                    <span
                      className="text-xs uppercase tracking-widest"
                      style={{
                        color: runMeta.color,
                        fontSize: "9px",
                        letterSpacing: "0.1em",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {run.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Iteration */}
                  <div className="flex items-center">
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-dim)", fontSize: "10px" }}
                    >
                      #{run.iteration}
                    </span>
                  </div>

                  {/* Time */}
                  <div className="flex items-center">
                    <span
                      className="text-xs"
                      style={{
                        color: "var(--text-dim)",
                        fontSize: "9px",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {formatTime(run.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
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

function MetaItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
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
