"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { JobRow, JobStatus } from "@conductor/core";

interface Props {
  initialJobs: JobRow[];
  projectMap: Record<string, { owner: string; repo: string }>;
  costByJob: Record<string, number>;
}

type StatusMeta = {
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
  pulse?: boolean;
};

const STATUS_META: Record<JobStatus, StatusMeta> = {
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
    label: "REVIEW",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.08)",
    border: "rgba(96,165,250,0.25)",
    dot: "#60a5fa",
    pulse: true,
  },
  test_loop: {
    label: "TESTING",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.25)",
    dot: "#a78bfa",
    pulse: true,
  },
  pr_opened: {
    label: "PR OPEN",
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
    label: "NEEDS YOU",
    color: "#fb923c",
    bg: "rgba(251,146,60,0.08)",
    border: "#7c2d12",
    dot: "#fb923c",
    pulse: true,
  },
  waiting_input: {
    label: "WAITING",
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.08)",
    border: "rgba(251,191,36,0.3)",
    dot: "#fbbf24",
    pulse: true,
  },
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }: { status: JobStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.queued;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs uppercase tracking-widest"
      style={{
        color: meta.color,
        backgroundColor: meta.bg,
        border: `1px solid ${meta.border}`,
        fontSize: "9px",
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

export function JobsClient({ initialJobs, projectMap, costByJob }: Props) {
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("jobs-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setJobs((prev) => [payload.new as JobRow, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === (payload.new as JobRow).id ? (payload.new as JobRow) : j
              )
            );
          } else if (payload.eventType === "DELETE") {
            setJobs((prev) =>
              prev.filter((j) => j.id !== (payload.old as { id: string }).id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      {/* Header */}
      <div
        className="flex items-center justify-between mb-8 opacity-0 animate-fade-up"
        style={{ animationFillMode: "forwards" }}
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="uppercase tracking-widest"
              style={{ color: "var(--text-dim)", fontSize: "10px", letterSpacing: "0.12em" }}
            >
              T-105
            </span>
            <span style={{ color: "var(--text-dim)", fontSize: "10px" }}>·</span>
            <span
              className="uppercase tracking-widest"
              style={{ color: "var(--text-dim)", fontSize: "10px", letterSpacing: "0.12em" }}
            >
              REALTIME
            </span>
          </div>
          <h1
            className="text-2xl font-bold"
            style={{
              fontFamily: "Syne, sans-serif",
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            Jobs
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "#34d399", animation: "pulse 2s ease-in-out infinite" }}
            />
            <span className="text-xs" style={{ color: "var(--text-dim)", fontSize: "10px" }}>
              live
            </span>
          </div>
          <Link
            href="/dashboard/jobs/new"
            className="flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-widest transition-colors"
            style={{
              backgroundColor: "var(--amber)",
              color: "var(--surface)",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "10px",
              letterSpacing: "0.12em",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#fbbf24")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--amber)")
            }
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
            </svg>
            NEW
          </Link>
        </div>
      </div>

      {/* Empty state */}
      {jobs.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-24 opacity-0 animate-fade-up"
          style={{ animationFillMode: "forwards", animationDelay: "100ms" }}
        >
          <div
            className="w-12 h-12 flex items-center justify-center mb-4"
            style={{ border: "1px solid var(--border)" }}
          >
            <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
              <path d="M1 3h12M1 7h8M1 11h10" stroke="var(--text-dim)" strokeWidth="1.2" strokeLinecap="square" />
            </svg>
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            No jobs yet.{" "}
            <Link href="/dashboard/jobs/new" style={{ color: "var(--amber)", textDecoration: "underline" }}>
              Launch first feature →
            </Link>
          </p>
        </div>
      )}

      {/* Job list */}
      {jobs.length > 0 && (
        <div
          className="opacity-0 animate-fade-up"
          style={{ animationFillMode: "forwards", animationDelay: "100ms" }}
        >
          {/* Column headers */}
          <div
            className="grid px-4 pb-2"
            style={{
              gridTemplateColumns: "1fr 160px 110px 72px 80px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {["JOB", "PROJECT", "STATUS", "COST", "WHEN"].map((h) => (
              <span
                key={h}
                className="uppercase tracking-widest"
                style={{ color: "var(--text-dim)", fontSize: "9px", letterSpacing: "0.12em" }}
              >
                {h}
              </span>
            ))}
          </div>

          <div>
            {jobs.map((job, i) => {
              const proj = projectMap[job.project_id];
              return (
                <Link
                  key={job.id}
                  href={`/dashboard/jobs/${job.id}`}
                  className="grid px-4 py-3.5 group transition-colors"
                  style={{
                    gridTemplateColumns: "1fr 160px 110px 72px 80px",
                    borderBottom: "1px solid var(--border)",
                    backgroundColor: "transparent",
                    animationDelay: `${i * 30}ms`,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "var(--surface-raised)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  {/* Title */}
                  <div className="flex flex-col gap-0.5 min-w-0 pr-4">
                    <span
                      className="text-xs truncate group-hover:text-amber-400 transition-colors"
                      style={{
                        color: "var(--text-primary)",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {job.title}
                    </span>
                    <span
                      className="text-xs truncate"
                      style={{ color: "var(--text-dim)", fontSize: "10px" }}
                    >
                      {job.id.split("-")[0]}
                    </span>
                  </div>

                  {/* Project */}
                  <div className="flex items-center">
                    {proj ? (
                      <span
                        className="text-xs truncate"
                        style={{
                          color: "var(--text-secondary)",
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "10px",
                        }}
                      >
                        {proj.owner}/{proj.repo}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-dim)", fontSize: "10px" }}>—</span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex items-center">
                    <StatusBadge status={job.status} />
                  </div>

                  {/* Cost */}
                  <div className="flex items-center">
                    {costByJob[job.id] !== undefined ? (
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: "JetBrains Mono, monospace",
                          color: "#34d399",
                        }}
                      >
                        ${costByJob[job.id]!.toFixed(2)}
                      </span>
                    ) : (
                      <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>—</span>
                    )}
                  </div>

                  {/* When */}
                  <div className="flex items-center">
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-dim)", fontSize: "10px" }}
                    >
                      {formatRelative(job.created_at)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="pt-3 px-4">
            <span className="text-xs" style={{ color: "var(--text-dim)", fontSize: "10px" }}>
              {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
            </span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
