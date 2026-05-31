"use client";

import Link from "next/link";

export type AgentStatus = "running" | "idle" | "error" | "disabled";

interface AgentStatusBadgeProps {
  readonly status: AgentStatus;
  readonly jobLink?: string;
}

const STATUS_CONFIG = {
  running: {
    dot: "#f59e0b",
    label: "RUNNING",
    pulse: true,
    textColor: "var(--amber)",
    borderColor: "rgba(245,158,11,0.2)",
    bg: "rgba(245,158,11,0.06)",
  },
  idle: {
    dot: "#34d399",
    label: "ONLINE",
    pulse: false,
    textColor: "#34d399",
    borderColor: "rgba(52,211,153,0.2)",
    bg: "rgba(52,211,153,0.06)",
  },
  error: {
    dot: "#f87171",
    label: "ERROR",
    pulse: false,
    textColor: "#f87171",
    borderColor: "rgba(248,113,113,0.2)",
    bg: "rgba(248,113,113,0.06)",
  },
  disabled: {
    dot: "transparent",
    label: "OFFLINE",
    pulse: false,
    textColor: "var(--text-dim)",
    borderColor: "var(--border)",
    bg: "transparent",
  },
} as const;

export function AgentStatusBadge({
  status,
  jobLink,
}: AgentStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];

  const badge = (
    <span
      className="status-badge"
      style={{
        color: cfg.textColor,
        borderColor: cfg.borderColor,
        backgroundColor: cfg.bg,
      }}
    >
      <span
        className={`status-dot${cfg.pulse ? " status-dot--pulse" : ""}`}
        style={{
          backgroundColor: cfg.dot,
          border: status === "disabled" ? "1px dashed var(--text-dim)" : "none",
        }}
      />
      {cfg.label}
    </span>
  );

  if (status === "running" && jobLink) {
    return (
      <Link href={jobLink} className="inline-flex hover:opacity-80 transition-opacity">
        {badge}
      </Link>
    );
  }

  return badge;
}
