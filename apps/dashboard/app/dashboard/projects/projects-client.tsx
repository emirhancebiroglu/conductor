"use client";

import { useState, useEffect, useCallback } from "react";
import type { ProjectRow } from "@conductor/core";
import type { GithubRepo } from "@/app/api/github/repos/route";

interface Props {
  initialConnected: ProjectRow[];
  fetchError: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function ProjectsClient({ initialConnected, fetchError }: Props) {
  const [connected, setConnected] = useState<ProjectRow[]>(initialConnected);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const res = await fetch("/api/github/repos");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch repos");
      setRepos(json.repos);
    } catch (e) {
      setReposError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  const connectedKeys = new Set(connected.map((p) => `${p.owner}/${p.repo}`));

  async function connectRepo(repo: GithubRepo) {
    const key = repo.full_name;
    setConnecting((s) => new Set(s).add(key));
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repo.owner,
          repo: repo.name,
          default_branch: repo.default_branch,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to connect");
      setConnected((prev) => [json.project as ProjectRow, ...prev]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error connecting repo");
    } finally {
      setConnecting((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }

  async function removeProject(id: string) {
    setRemoving((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? "Failed to remove");
      }
      setConnected((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error removing project");
    } finally {
      setRemoving((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (r.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const availableRepos = filteredRepos.filter((r) => !connectedKeys.has(r.full_name));

  return (
    <div className="max-w-4xl">
      {/* Page header */}
      <div className="mb-7 opacity-0 animate-fade-up" style={{ animationFillMode: "forwards" }}>
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs uppercase tracking-widest"
            style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
          >
            T-102 / T-103
          </span>
        </div>
        <h1
          className="text-2xl font-bold mb-1"
          style={{ fontFamily: "Syne, sans-serif", color: "var(--text-primary)", letterSpacing: "-0.02em" }}
        >
          Projects
        </h1>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Connect GitHub repos to pipeline jobs.
        </p>
      </div>

      {/* ── Connected projects ── */}
      <section
        className="mb-8 opacity-0 animate-fade-up delay-100"
        style={{ animationFillMode: "forwards" }}
      >
        <SectionHeader label="Connected" count={connected.length} />

        {fetchError && (
          <ErrorBanner message={`Supabase error: ${fetchError}`} />
        )}

        {connected.length === 0 ? (
          <EmptyState text="No repos connected yet. Connect one below." />
        ) : (
          <div className="border" style={{ borderColor: "var(--border)" }}>
            {connected.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-4 px-4 py-3 group transition-colors"
                style={{
                  borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                  backgroundColor: "var(--surface-raised)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-overlay)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-raised)"; }}
              >
                {/* Status dot */}
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: "#34d399" }}
                />

                {/* Repo info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)", fontFamily: "JetBrains Mono, monospace" }}>
                      {p.owner}
                      <span style={{ color: "var(--text-dim)" }}>/</span>
                      {p.repo}
                    </span>
                    <span
                      className="text-xs px-1.5 py-px border"
                      style={{ borderColor: "var(--border)", color: "var(--text-dim)", fontSize: "10px" }}
                    >
                      {p.default_branch}
                    </span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                    connected {timeAgo(p.created_at)}
                  </div>
                </div>

                {/* Remove */}
                <button
                  onClick={() => removeProject(p.id)}
                  disabled={removing.has(p.id)}
                  className="text-xs uppercase tracking-widest px-3 py-1.5 border transition-all disabled:opacity-40"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-dim)",
                    fontSize: "10px",
                    letterSpacing: "0.1em",
                  }}
                  onMouseEnter={(e) => {
                    if (!removing.has(p.id)) {
                      e.currentTarget.style.borderColor = "var(--destructive)";
                      e.currentTarget.style.color = "var(--destructive)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--text-dim)";
                  }}
                >
                  {removing.has(p.id) ? "..." : "REMOVE"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Available repos ── */}
      <section
        className="opacity-0 animate-fade-up delay-200"
        style={{ animationFillMode: "forwards" }}
      >
        <div className="flex items-center justify-between mb-3">
          <SectionHeader
            label="Available on GitHub"
            count={reposLoading ? null : availableRepos.length}
          />
          {!reposLoading && (
            <button
              onClick={loadRepos}
              className="text-xs uppercase tracking-widest transition-colors"
              style={{ color: "var(--text-dim)", letterSpacing: "0.1em", fontSize: "10px" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              ↺ REFRESH
            </button>
          )}
        </div>

        {/* Search */}
        {!reposLoading && !reposError && repos.length > 0 && (
          <div className="mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="filter repos..."
              className="w-full px-3 py-2 text-xs outline-none"
              style={{
                backgroundColor: "var(--surface-raised)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontFamily: "JetBrains Mono, monospace",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--amber)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            />
          </div>
        )}

        {reposLoading && <LoadingRows />}
        {reposError && (
          <ErrorBanner
            message={reposError}
            action={{ label: "RETRY", onClick: loadRepos }}
          />
        )}

        {!reposLoading && !reposError && availableRepos.length === 0 && (
          <EmptyState
            text={
              search
                ? `No repos match "${search}".`
                : "All accessible repos are already connected."
            }
          />
        )}

        {!reposLoading && !reposError && availableRepos.length > 0 && (
          <div className="border" style={{ borderColor: "var(--border)" }}>
            {availableRepos.map((r, i) => {
              const key = r.full_name;
              const isConnecting = connecting.has(key);
              return (
                <div
                  key={r.id}
                  className="flex items-start gap-4 px-4 py-3 transition-colors"
                  style={{
                    borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                    backgroundColor: "var(--surface-raised)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-overlay)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-raised)"; }}
                >
                  {/* Private / public indicator */}
                  <div
                    className="flex-shrink-0 mt-0.5 text-xs px-1 py-px border"
                    style={{
                      borderColor: r.private ? "var(--amber-dim)" : "var(--border)",
                      color: r.private ? "var(--amber)" : "var(--text-dim)",
                      fontSize: "9px",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {r.private ? "PVT" : "PUB"}
                  </div>

                  {/* Repo info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className="text-xs font-medium"
                        style={{ color: "var(--text-primary)", fontFamily: "JetBrains Mono, monospace" }}
                      >
                        {r.owner}
                        <span style={{ color: "var(--text-dim)" }}>/</span>
                        {r.name}
                      </span>
                    </div>
                    {r.description && (
                      <p
                        className="text-xs truncate mb-0.5"
                        style={{ color: "var(--text-dim)", maxWidth: "400px" }}
                      >
                        {r.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="text-xs" style={{ color: "var(--text-dim)", fontSize: "10px" }}>
                        {r.default_branch}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-dim)", fontSize: "10px" }}>
                        updated {timeAgo(r.updated_at)}
                      </span>
                    </div>
                  </div>

                  {/* Connect button */}
                  <button
                    onClick={() => connectRepo(r)}
                    disabled={isConnecting}
                    className="flex-shrink-0 text-xs uppercase tracking-widest px-3 py-1.5 border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      borderColor: "var(--amber-dim)",
                      color: "var(--amber)",
                      fontSize: "10px",
                      letterSpacing: "0.1em",
                    }}
                    onMouseEnter={(e) => {
                      if (!isConnecting) {
                        e.currentTarget.style.backgroundColor = "var(--amber-glow)";
                        e.currentTarget.style.borderColor = "var(--amber)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.borderColor = "var(--amber-dim)";
                    }}
                  >
                    {isConnecting ? "CONNECTING..." : "CONNECT →"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number | null }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span
        className="text-xs uppercase tracking-widest"
        style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
      >
        {label}
      </span>
      {count !== null && (
        <span
          className="text-xs px-1.5 py-px border"
          style={{ borderColor: "var(--border)", color: "var(--text-dim)", fontSize: "10px" }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      className="px-4 py-6 text-center border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
    >
      <p className="text-xs" style={{ color: "var(--text-dim)" }}>{text}</p>
    </div>
  );
}

function ErrorBanner({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3 border mb-3"
      style={{ borderColor: "#7f1d1d", backgroundColor: "rgba(127,29,29,0.1)" }}
    >
      <span className="text-xs" style={{ color: "#f87171" }}>{message}</span>
      {action && (
        <button
          onClick={action.onClick}
          className="text-xs uppercase tracking-widest ml-4"
          style={{ color: "#f87171", letterSpacing: "0.1em", fontSize: "10px" }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="border" style={{ borderColor: "var(--border)" }}>
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3"
          style={{
            borderTop: i > 0 ? "1px solid var(--border)" : undefined,
            backgroundColor: "var(--surface-raised)",
          }}
        >
          <div
            className="w-8 h-3 rounded-sm"
            style={{
              backgroundColor: "var(--surface-overlay)",
              animation: "pulse 1.5s ease-in-out infinite",
              animationDelay: `${i * 100}ms`,
            }}
          />
          <div className="flex-1">
            <div
              className="h-3 rounded-sm mb-1.5"
              style={{
                width: `${140 + i * 20}px`,
                backgroundColor: "var(--surface-overlay)",
                animation: "pulse 1.5s ease-in-out infinite",
                animationDelay: `${i * 100}ms`,
              }}
            />
            <div
              className="h-2.5 rounded-sm"
              style={{
                width: `${80 + i * 30}px`,
                backgroundColor: "var(--surface-overlay)",
                animation: "pulse 1.5s ease-in-out infinite",
                animationDelay: `${i * 150}ms`,
              }}
            />
          </div>
          <div
            className="w-20 h-6 rounded-sm"
            style={{
              backgroundColor: "var(--surface-overlay)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        </div>
      ))}
    </div>
  );
}
