"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ProjectRow, LanePreference } from "@conductor/core";

interface Props {
  projects: ProjectRow[];
}

const LANES: { value: LanePreference; label: string; sub: string; icon: string }[] = [
  { value: "auto", label: "AUTO", sub: "Router decides per step", icon: "◈" },
  { value: "cheap", label: "CHEAP", sub: "OpenCode Go · fast + low cost", icon: "◇" },
  { value: "premium", label: "PREMIUM", sub: "Claude Code · best quality", icon: "◆" },
];

export function NewJobClient({ projects }: Props) {
  const router = useRouter();
  const descRef = useRef<HTMLTextAreaElement>(null);

  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lane, setLane] = useState<LanePreference>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const titleLen = title.length;
  const descLen = description.length;
  const canSubmit =
    !submitting &&
    projectId &&
    title.trim().length >= 1 &&
    title.length <= 100 &&
    description.trim().length >= 20;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          type: "feature",
          title: title.trim(),
          description: description.trim(),
          lanePreference: lane,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json.issues) setFieldErrors(json.issues as Record<string, string[]>);
        throw new Error(json.error ?? "Failed to create job");
      }

      // Brief visual pause before redirect
      await new Promise((r) => setTimeout(r, 400));
      router.push(`/dashboard/jobs/${(json.job as { id: string }).id}`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const inputStyle = {
    backgroundColor: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    fontFamily: "JetBrains Mono, monospace",
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
  } as const;

  function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    e.currentTarget.style.borderColor = "var(--amber)";
    e.currentTarget.style.boxShadow = "0 0 0 1px var(--amber)";
  }
  function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    e.currentTarget.style.borderColor = "var(--border)";
    e.currentTarget.style.boxShadow = "none";
  }

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-8 opacity-0 animate-fade-up" style={{ animationFillMode: "forwards" }}>
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs uppercase tracking-widest"
            style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
          >
            T-104
          </span>
          <span style={{ color: "var(--text-dim)", fontSize: "10px" }}>·</span>
          <span
            className="text-xs uppercase tracking-widest"
            style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
          >
            NEW JOB
          </span>
        </div>
        <h1
          className="text-2xl font-bold mb-1"
          style={{
            fontFamily: "Syne, sans-serif",
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
          }}
        >
          New Feature
        </h1>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Describe the feature. Agent team picks it up and opens a PR.
        </p>
      </div>

      {/* No projects warning */}
      {projects.length === 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 mb-6 border opacity-0 animate-fade-up"
          style={{
            borderColor: "var(--amber-dim)",
            backgroundColor: "var(--amber-glow)",
            animationFillMode: "forwards",
          }}
        >
          <span style={{ color: "var(--amber)", fontSize: "10px" }}>⚠</span>
          <span className="text-xs" style={{ color: "var(--amber)" }}>
            No connected projects.{" "}
            <a href="/dashboard/projects" style={{ textDecoration: "underline" }}>
              Connect one first →
            </a>
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ── Project ── */}
        <div className="mb-5 opacity-0 animate-fade-up delay-100" style={{ animationFillMode: "forwards" }}>
          <FieldLabel htmlFor="project" text="Project" />
          <div className="relative">
            <select
              id="project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={projects.length === 0 || submitting}
              className="w-full px-3 py-2.5 text-xs appearance-none disabled:opacity-40"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            >
              {projects.length === 0 ? (
                <option value="">— no projects —</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.owner}/{p.repo}  [{p.default_branch}]
                  </option>
                ))
              )}
            </select>
            <div
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: "var(--text-dim)" }}
            >
              ▾
            </div>
          </div>
          <FieldError messages={fieldErrors.projectId} />
        </div>

        {/* ── Title ── */}
        <div className="mb-5 opacity-0 animate-fade-up delay-100" style={{ animationFillMode: "forwards" }}>
          <div className="flex items-center justify-between mb-2">
            <FieldLabel htmlFor="title" text="Feature title" />
            <span
              className="text-xs"
              style={{ color: titleLen > 90 ? "var(--destructive)" : "var(--text-dim)", fontSize: "10px" }}
            >
              {titleLen}/100
            </span>
          </div>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="e.g. Add CSV export to reports page"
            disabled={submitting}
            className="w-full px-3 py-2.5 text-xs disabled:opacity-40"
            style={inputStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <FieldError messages={fieldErrors.title} />
        </div>

        {/* ── Description ── */}
        <div className="mb-5 opacity-0 animate-fade-up delay-200" style={{ animationFillMode: "forwards" }}>
          <div className="flex items-center justify-between mb-2">
            <FieldLabel htmlFor="description" text="Description" />
            <span
              className="text-xs"
              style={{
                color:
                  descLen > 0 && descLen < 20
                    ? "var(--destructive)"
                    : "var(--text-dim)",
                fontSize: "10px",
              }}
            >
              {descLen < 20 ? `min 20 · ${descLen}` : descLen}
            </span>
          </div>
          <textarea
            id="description"
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={6}
            placeholder="What should be built? Include acceptance criteria, edge cases, constraints…"
            disabled={submitting}
            className="w-full px-3 py-2.5 text-xs resize-y disabled:opacity-40"
            style={{ ...inputStyle, minHeight: "120px", lineHeight: "1.7" }}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <FieldError messages={fieldErrors.description} />
        </div>

        {/* ── Lane ── */}
        <div className="mb-7 opacity-0 animate-fade-up delay-200" style={{ animationFillMode: "forwards" }}>
          <FieldLabel text="Lane preference" />
          <div className="grid grid-cols-3 gap-px" style={{ backgroundColor: "var(--border)" }}>
            {LANES.map((l) => {
              const active = lane === l.value;
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLane(l.value)}
                  disabled={submitting}
                  className="flex flex-col items-start px-4 py-3 transition-all text-left disabled:opacity-40"
                  style={{
                    backgroundColor: active ? "var(--amber-glow)" : "var(--surface-raised)",
                    borderLeft: active ? "2px solid var(--amber)" : "2px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!active && !submitting)
                      e.currentTarget.style.backgroundColor = "var(--surface-overlay)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active)
                      e.currentTarget.style.backgroundColor = "var(--surface-raised)";
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-sm"
                      style={{ color: active ? "var(--amber)" : "var(--text-dim)" }}
                    >
                      {l.icon}
                    </span>
                    <span
                      className="text-xs font-medium uppercase tracking-widest"
                      style={{
                        color: active ? "var(--amber)" : "var(--text-secondary)",
                        letterSpacing: "0.1em",
                        fontSize: "10px",
                      }}
                    >
                      {l.label}
                    </span>
                  </div>
                  <span className="text-xs" style={{ color: "var(--text-dim)", fontSize: "10px" }}>
                    {l.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Global error */}
        {error && (
          <div
            className="flex items-center gap-2 px-4 py-3 mb-4 border"
            style={{ borderColor: "#7f1d1d", backgroundColor: "rgba(127,29,29,0.12)" }}
          >
            <span style={{ color: "#f87171", fontSize: "10px" }}>✕</span>
            <span className="text-xs" style={{ color: "#f87171" }}>
              {error}
            </span>
          </div>
        )}

        {/* Submit */}
        <div className="opacity-0 animate-fade-up delay-300" style={{ animationFillMode: "forwards" }}>
          <button
            type="submit"
            disabled={!canSubmit}
            className="relative w-full py-3 text-xs uppercase tracking-widest font-medium overflow-hidden transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: submitting ? "var(--amber-dim)" : "var(--amber)",
              color: "var(--surface)",
              fontFamily: "JetBrains Mono, monospace",
              letterSpacing: "0.14em",
            }}
            onMouseEnter={(e) => {
              if (canSubmit && !submitting)
                e.currentTarget.style.backgroundColor = "#fbbf24";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = submitting
                ? "var(--amber-dim)"
                : "var(--amber)";
            }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full"
                  style={{ animation: "spin 0.7s linear infinite" }}
                />
                QUEUING JOB...
              </span>
            ) : (
              "LAUNCH PIPELINE →"
            )}
          </button>

          <p className="mt-3 text-xs text-center" style={{ color: "var(--text-dim)" }}>
            Job queues immediately · worker picks it up · PR opens · you review
          </p>
        </div>
      </form>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function FieldLabel({ htmlFor, text }: { htmlFor?: string; text: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs uppercase tracking-widest mb-2"
      style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
    >
      {text}
    </label>
  );
}

function FieldError({ messages }: { messages?: string[] | undefined }) {
  if (!messages?.length) return null;
  return (
    <p className="mt-1 text-xs" style={{ color: "var(--destructive)" }}>
      {messages[0]}
    </p>
  );
}
