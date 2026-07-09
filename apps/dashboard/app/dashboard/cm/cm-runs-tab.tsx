"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCmScans, revalidateCmScans } from "@/lib/hooks/use-cm-scans";
import { useCmScanDetail, revalidateCmScanDetail } from "@/lib/hooks/use-cm-scan-detail";

type CmRepo = {
  owner: string;
  name: string;
  default_branch: string;
};

type CmScan = {
  id: string;
  repo_id: string;
  status: string;
  trigger: string;
  findings_total: number;
  findings_actionable: number;
  branch_scanned: string | null;
  current_step: string | null;
  report_path: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  cm_repo: CmRepo | null;
};

type CmFinding = {
  id: string;
  severity: string;
  source: string;
  rule: string | null;
  package: string | null;
  current_version: string | null;
  fixed_version: string | null;
  fix_status: string;
  file: string | null;
  line: number | null;
  description: string | null;
};

type ScanDetail = {
  scan: CmScan;
  findings: CmFinding[];
  runs: Array<{
    id: string;
    agent: string;
    model: string;
    status: string;
    created_at: string;
  }>;
  usageLog: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    est_cost_usd: number;
  }>;
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; pulse?: boolean; label: string }> = {
  queued:      { color: "#7a7468", bg: "rgba(122,116,104,0.08)", border: "rgba(122,116,104,0.2)", label: "Queued" },
  scanning:    { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", pulse: true, label: "Scanning" },
  scan_done:   { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.2)", label: "Scan Done" },
  scan_failed: { color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)", label: "Scan Failed" },
  fixing:      { color: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.2)", pulse: true, label: "Fixing" },
  run_blocked: { color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.2)", label: "Run Blocked" },
  fixed:       { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.2)", label: "Fixed" },
  rescanning:  { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", pulse: true, label: "Rescanning" },
  reporting:   { color: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.2)", pulse: true, label: "Generating Report" },
  verified:    { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.2)", label: "Verified" },
  done:        { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.2)", label: "Done" },
  failed:      { color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)", label: "Failed" },
  needs_human: { color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.2)", label: "Needs Review" },
};

const SEV_CONFIG: Record<string, { color: string; bg: string }> = {
  CRITICAL: { color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  HIGH:     { color: "#fb923c", bg: "rgba(251,146,60,0.12)" },
  MEDIUM:   { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  LOW:      { color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { color: "#7a7468", bg: "rgba(122,116,104,0.08)", border: "rgba(122,116,104,0.2)", label: status };
  return (
    <span className="status-badge-cm" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
      <span className="status-dot-cm" style={{ background: cfg.color, animation: cfg.pulse ? "pulse 1.4s ease-in-out infinite" : "none" }} />
      {cfg.label}
    </span>
  );
}

function SevBadge({ sev }: { sev: string }) {
  const cfg = SEV_CONFIG[sev] ?? { color: "#6b7280", bg: "rgba(107,114,128,0.12)" };
  return (
    <span className="sev-badge" style={{ color: cfg.color, background: cfg.bg }}>
      {sev}
    </span>
  );
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function groupFindings(findings: CmFinding[]) {
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const sast = findings.filter(f => f.source === "sast").sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const sca = findings.filter(f => f.source === "sca").sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return { sast, sca };
}

export function CmRunsTab() {
  const { scans: rawScans, isLoading } = useCmScans();
  const scans = rawScans as CmScan[];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { detail: rawDetail, isLoading: detailLoading } = useCmScanDetail(selectedId);
  const selectedScan = rawDetail as ScanDetail | null;

  const [findingsTab, setFindingsTab] = useState<"all" | "sast" | "sca">("all");

  // Realtime: revalidate scans list on any cm_scan change
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("cm_scan_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "cm_scan" }, () => {
        void revalidateCmScans();
        if (selectedId) void revalidateCmScanDetail(selectedId);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedId]);

  const openDetail = useCallback((scanId: string) => {
    setSelectedId(scanId);
    setFindingsTab("all");
  }, []);

  // why: must match the worker's real terminal states (packages/cm-core/src/scan-states.ts
  // SCAN_TERMINAL_STATUSES + scan_failed/scan_done, which the worker also never
  // resumes from automatically) — "verified" and "needs_human" are end states
  // now that the pipeline stops after committing to the fix branch (no PR step).
  const TERMINAL_STATUSES = ["done", "failed", "scan_failed", "scan_done", "verified", "needs_human"];
  const activeScans = scans.filter(s => !TERMINAL_STATUSES.includes(s.status));

  const { sast: detailSast, sca: detailSca } = selectedScan ? groupFindings(selectedScan.findings) : { sast: [], sca: [] };
  const shownFindings = findingsTab === "sast" ? detailSast : findingsTab === "sca" ? detailSca : selectedScan?.findings ?? [];

  return (
    <div className="runs-root">
      {/* Active scans ticker */}
      {activeScans.length > 0 && (
        <div className="active-bar">
          <span className="active-bar-dot" />
          <span className="active-bar-label">{activeScans.length} scan{activeScans.length > 1 ? "s" : ""} in progress</span>
          {activeScans.map(s => (
            <span key={s.id} className="active-bar-item" onClick={() => openDetail(s.id)}>
              <span style={{ color: "var(--text-primary)" }}>{s.cm_repo?.name ?? "…"}</span>
              <span style={{ color: "var(--text-dim)", fontSize: "9px" }}>{s.current_step ?? s.status}</span>
            </span>
          ))}
        </div>
      )}

      <div className="runs-layout">
        {/* Scan list */}
        <div className="runs-list-panel" style={{ maxWidth: selectedScan ? "480px" : "100%", flex: selectedScan ? "0 0 480px" : "1" }}>
          <div className="runs-toolbar">
            <span className="runs-toolbar-count">{scans.length} scans</span>
            <button onClick={() => revalidateCmScans()} className="rn-icon-btn" title="Refresh">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M6 1.5 8 3.5 6 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {isLoading ? (
            <div className="rn-placeholder">
              <span className="rn-loading-dot" /><span className="rn-loading-dot" style={{ animationDelay: "0.15s" }} /><span className="rn-loading-dot" style={{ animationDelay: "0.3s" }} />
            </div>
          ) : scans.length === 0 ? (
            <div className="rn-empty-state">
              <div className="rn-empty-icon">◎</div>
              <p>No scans yet</p>
              <p style={{ fontSize: "10px", color: "var(--text-dim)", marginTop: "4px" }}>Trigger a scan from the Repos tab</p>
            </div>
          ) : (
            <div className="rn-list">
              {scans.map((scan, i) => {
                const isActive = selectedId === scan.id;
                const isRunning = !TERMINAL_STATUSES.includes(scan.status);
                return (
                  <div
                    key={scan.id}
                    className="rn-card"
                    data-active={isActive}
                    data-running={isRunning}
                    onClick={() => openDetail(scan.id)}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <div className="rn-card-accent" style={{ background: isActive ? "var(--amber)" : "transparent" }} />
                    <div className="rn-card-body">
                      <div className="rn-card-top">
                        <span className="rn-repo-name">
                          {scan.cm_repo ? `${scan.cm_repo.owner}/${scan.cm_repo.name}` : scan.repo_id.slice(0, 8)}
                        </span>
                        <StatusBadge status={scan.status} />
                      </div>

                      <div className="rn-card-meta">
                        <span className="rn-meta-chip">
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.5 }}><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          {scan.branch_scanned ?? scan.cm_repo?.default_branch ?? "—"}
                        </span>
                        <span className="rn-meta-sep">·</span>
                        <span className="rn-meta-chip">{scan.trigger}</span>
                        <span className="rn-meta-sep">·</span>
                        <span className="rn-meta-chip">{formatRelative(scan.created_at)}</span>
                      </div>

                      <div className="rn-card-bottom">
                        {scan.findings_total > 0 ? (
                          <div className="sev-bar-row">
                            {scan.findings_actionable > 0 && (
                              <span className="sev-bar-chip" style={{ color: "#fb923c", background: "rgba(251,146,60,0.12)" }}>
                                {scan.findings_actionable}
                                <span style={{ opacity: 0.6, fontSize: "8px", marginLeft: "2px" }}>C/H</span>
                              </span>
                            )}
                            {(scan.findings_total - scan.findings_actionable) > 0 && (
                              <span className="sev-bar-chip" style={{ color: "#6b7280", background: "rgba(107,114,128,0.12)" }}>
                                {scan.findings_total - scan.findings_actionable}
                                <span style={{ opacity: 0.6, fontSize: "8px", marginLeft: "2px" }}>M/L</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                            {scan.status === "scan_done" || scan.status === "done" ? "No findings" : "—"}
                          </span>
                        )}
                        <span className="rn-duration">
                          {formatDuration(scan.started_at, scan.finished_at)}
                        </span>
                      </div>

                      {scan.current_step && isRunning && (
                        <div className="rn-card-step">{scan.current_step}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div className="rn-detail-panel">
            <div className="rn-detail-head">
              <div>
                {selectedScan ? (
                  <>
                    <div className="rn-detail-eyebrow">
                      {selectedScan.scan.cm_repo
                        ? `${selectedScan.scan.cm_repo.owner} / ${selectedScan.scan.cm_repo.name}`
                        : selectedScan.scan.repo_id.slice(0, 8)}
                    </div>
                    <div className="rn-detail-branch">
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4 }}><circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="9" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M3 4.5V6a3 3 0 0 0 3 3h0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      {selectedScan.scan.branch_scanned ?? "—"}
                    </div>
                  </>
                ) : <div className="rn-detail-eyebrow">Loading…</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {selectedScan && <StatusBadge status={selectedScan.scan.status} />}
                <button onClick={() => setSelectedId(null)} className="rn-icon-btn" title="Close">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                </button>
              </div>
            </div>

            {detailLoading || !selectedScan ? (
              <div className="rn-placeholder" style={{ padding: "60px 0" }}>
                <span className="rn-loading-dot" /><span className="rn-loading-dot" style={{ animationDelay: "0.15s" }} /><span className="rn-loading-dot" style={{ animationDelay: "0.3s" }} />
              </div>
            ) : (
              <div className="rn-detail-scroll">

                {/* Error */}
                {selectedScan.scan.error && (
                  <div className="rn-error-banner">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 10H1L6 1z" stroke="#f87171" strokeWidth="1.2" strokeLinejoin="round"/><path d="M6 5v2.5M6 9v.5" stroke="#f87171" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    <span>{selectedScan.scan.error}</span>
                  </div>
                )}

                {/* Step */}
                {selectedScan.scan.current_step && (
                  <div className="rn-step-bar">{selectedScan.scan.current_step}</div>
                )}

                {/* Stats row */}
                <div className="rn-stats-row">
                  <div className="rn-stat">
                    <span className="rn-stat-label">Total</span>
                    <span className="rn-stat-value">{selectedScan.scan.findings_total}</span>
                  </div>
                  <div className="rn-stat">
                    <span className="rn-stat-label">Actionable</span>
                    <span className="rn-stat-value" style={{ color: selectedScan.scan.findings_actionable > 0 ? "#f59e0b" : "var(--text-primary)" }}>
                      {selectedScan.scan.findings_actionable}
                    </span>
                  </div>
                  <div className="rn-stat">
                    <span className="rn-stat-label">SAST</span>
                    <span className="rn-stat-value">{detailSast.length}</span>
                  </div>
                  <div className="rn-stat">
                    <span className="rn-stat-label">SCA</span>
                    <span className="rn-stat-value">{detailSca.length}</span>
                  </div>
                  <div className="rn-stat">
                    <span className="rn-stat-label">Duration</span>
                    <span className="rn-stat-value">{formatDuration(selectedScan.scan.started_at, selectedScan.scan.finished_at)}</span>
                  </div>
                </div>

                {/* Findings */}
                <div className="rn-section">
                  <div className="rn-section-head">
                    <span className="rn-section-title">Findings</span>
                    <div className="rn-tab-group">
                      {(["all", "sast", "sca"] as const).map(t => (
                        <button
                          key={t}
                          className="rn-tab-btn"
                          data-active={findingsTab === t}
                          onClick={() => setFindingsTab(t)}
                        >
                          {t === "all" ? `All (${selectedScan.findings.length})` : t === "sast" ? `SAST (${detailSast.length})` : `SCA (${detailSca.length})`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {shownFindings.length === 0 ? (
                    <div className="rn-findings-empty">No findings in this category</div>
                  ) : (
                    <div className="rn-findings-list">
                      {shownFindings.map((f, i) => (
                        <div key={f.id ?? i} className="rn-finding-row">
                          <div className="rn-finding-top">
                            <SevBadge sev={f.severity} />
                            <span className="rn-source-tag">{f.source}</span>
                            <span className="rn-finding-rule">{f.rule ?? f.package ?? "—"}</span>
                            <span className="rn-fix-status" data-status={f.fix_status}>{f.fix_status}</span>
                          </div>
                          {f.source === "sast" && f.file && (
                            <div className="rn-finding-loc">
                              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4 }}><rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/><path d="M4 4h4M4 6h4M4 8h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                              <span className="rn-finding-file">{f.file.split("/").slice(-2).join("/")}</span>
                              {f.line && <span className="rn-finding-line">:{f.line}</span>}
                            </div>
                          )}
                          {f.source === "sca" && f.package && (
                            <div className="rn-finding-pkg">
                              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4 }}><rect x="1" y="4" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/><path d="M4 4V3a2 2 0 0 1 4 0v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                              <span className="rn-finding-pkg-name">{f.package.replace(/^(Npm|Maven|Pip)-/, "")}</span>
                              {f.current_version && <span className="rn-finding-ver">{f.current_version}</span>}
                              {f.fixed_version && f.fixed_version !== f.current_version && (
                                <>
                                  <span style={{ color: "var(--text-dim)", fontSize: "9px" }}>→</span>
                                  <span className="rn-finding-ver" style={{ color: "#34d399" }}>{f.fixed_version}</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div className="rn-section">
                  <div className="rn-section-title">Timeline</div>
                  <div className="rn-timeline">
                    <div className="rn-tl-row"><span className="rn-tl-key">Created</span><span className="rn-tl-val">{formatTime(selectedScan.scan.created_at)}</span></div>
                    <div className="rn-tl-row"><span className="rn-tl-key">Started</span><span className="rn-tl-val">{formatTime(selectedScan.scan.started_at)}</span></div>
                    <div className="rn-tl-row"><span className="rn-tl-key">Finished</span><span className="rn-tl-val">{formatTime(selectedScan.scan.finished_at)}</span></div>
                    <div className="rn-tl-row"><span className="rn-tl-key">Trigger</span><span className="rn-tl-val">{selectedScan.scan.trigger}</span></div>
                  </div>
                </div>

                {/* Agent Runs */}
                {selectedScan.runs.length > 0 && (
                  <div className="rn-section">
                    <div className="rn-section-title">Agent Steps ({selectedScan.runs.length})</div>
                    <div className="rn-runs-list">
                      {selectedScan.runs.map((run) => (
                        <div key={run.id} className="rn-run-row">
                          <span className="rn-run-agent">{run.agent}</span>
                          <span className="rn-run-model">{run.model}</span>
                          <span className="rn-run-status" data-ok={run.status === "ok"}>{run.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cost */}
                {selectedScan.usageLog.length > 0 && (
                  <div className="rn-section">
                    <div className="rn-section-title">Token Usage</div>
                    {selectedScan.usageLog.map((u, i) => (
                      <div key={i} className="rn-cost-row">
                        <span className="rn-cost-model">{u.model}</span>
                        <span className="rn-cost-tokens">{(u.input_tokens + u.output_tokens).toLocaleString()} tok</span>
                        <span className="rn-cost-usd">${(u.est_cost_usd ?? 0).toFixed(5)}</span>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blink { 0%,100%{opacity:.3} 50%{opacity:1} }

        .runs-root { display: flex; flex-direction: column; gap: 12px; }

        .active-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 8px 14px;
          background: rgba(245,158,11,0.05);
          border: 1px solid rgba(245,158,11,0.2);
          font-size: 11px; overflow: hidden;
        }
        .active-bar-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--amber); flex-shrink: 0;
          animation: pulse 1.2s ease-in-out infinite;
        }
        .active-bar-label { font-size: 10px; color: var(--amber); text-transform: uppercase; letter-spacing: 0.08em; flex-shrink: 0; }
        .active-bar-item {
          display: flex; flex-direction: column; gap: 1px;
          border-left: 1px solid rgba(245,158,11,0.2); padding-left: 12px;
          cursor: pointer;
        }
        .active-bar-item:hover span:first-child { color: var(--amber); }

        .runs-layout { display: flex; gap: 1px; align-items: flex-start; background: var(--border); border: 1px solid var(--border); min-height: 400px; }

        .runs-list-panel { display: flex; flex-direction: column; background: var(--surface); min-width: 0; transition: all 0.2s; }
        .runs-toolbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; border-bottom: 1px solid var(--border);
          background: var(--surface-overlay);
        }
        .runs-toolbar-count { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
        .rn-icon-btn {
          background: transparent; border: 1px solid var(--border); padding: 5px 7px;
          color: var(--text-secondary); cursor: pointer; display: flex; align-items: center;
          transition: color 0.12s, background 0.12s;
        }
        .rn-icon-btn:hover { color: var(--text-primary); background: var(--surface-overlay); }

        .rn-placeholder { display: flex; gap: 4px; align-items: center; justify-content: center; padding: 60px 0; }
        .rn-loading-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--text-dim); animation: blink 1.2s ease-in-out infinite;
        }
        .rn-empty-state { padding: 60px 24px; text-align: center; color: var(--text-secondary); font-size: 12px; }
        .rn-empty-icon { font-size: 28px; color: var(--text-dim); margin-bottom: 12px; line-height: 1; }

        .rn-list { display: flex; flex-direction: column; }

        .rn-card {
          display: flex; cursor: pointer;
          border-bottom: 1px solid var(--border);
          animation: fadeUp 0.25s ease both;
          transition: background 0.1s;
        }
        .rn-card:last-child { border-bottom: none; }
        .rn-card:hover { background: var(--surface-raised); }
        .rn-card[data-active="true"] { background: var(--surface-overlay); }
        .rn-card[data-running="true"] { background: rgba(245,158,11,0.02); }

        .rn-card-accent { width: 2px; flex-shrink: 0; transition: background 0.15s; }
        .rn-card-body { flex: 1; padding: 12px 14px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

        .rn-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .rn-repo-name { font-family: var(--font-geist-mono), monospace; font-size: 11px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .status-badge-cm {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 2px 7px; font-family: var(--font-geist-mono), monospace;
          font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
          border: 1px solid; white-space: nowrap; flex-shrink: 0;
        }
        .status-dot-cm { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }

        .rn-card-meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .rn-meta-chip { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-secondary); display: flex; align-items: center; gap: 3px; }
        .rn-meta-sep { color: var(--text-dim); font-size: 10px; }

        .rn-card-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .sev-bar-row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
        .sev-bar-chip { font-family: var(--font-geist-mono), monospace; font-size: 10px; font-weight: 700; padding: 1px 6px; display: flex; align-items: center; }
        .rn-duration { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-dim); flex-shrink: 0; }

        .rn-card-step { font-size: 9px; color: var(--amber); opacity: 0.8; font-family: var(--font-geist-mono), monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Detail panel */
        .rn-detail-panel { flex: 1; min-width: 0; background: var(--surface-raised); display: flex; flex-direction: column; max-height: 82vh; }

        .rn-detail-head {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          background: var(--surface-overlay); flex-shrink: 0;
        }
        .rn-detail-eyebrow { font-family: var(--font-geist-mono), monospace; font-size: 11px; font-weight: 600; color: var(--text-primary); margin-bottom: 3px; }
        .rn-detail-branch { display: flex; align-items: center; gap: 5px; font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-secondary); }

        .rn-detail-scroll { flex: 1; overflow-y: auto; padding: 0; }

        .rn-error-banner {
          display: flex; gap: 8px; align-items: flex-start;
          padding: 10px 18px; background: rgba(248,113,113,0.06);
          border-bottom: 1px solid rgba(248,113,113,0.15);
          font-family: var(--font-geist-mono), monospace; font-size: 10px; color: #f87171;
        }
        .rn-step-bar { padding: 8px 18px; background: rgba(245,158,11,0.05); border-bottom: 1px solid rgba(245,158,11,0.12); font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--amber); }

        .rn-stats-row {
          display: flex; gap: 0; border-bottom: 1px solid var(--border);
          background: var(--surface);
        }
        .rn-stat { flex: 1; padding: 12px 16px; display: flex; flex-direction: column; gap: 3px; border-right: 1px solid var(--border); }
        .rn-stat:last-child { border-right: none; }
        .rn-stat-label { font-family: var(--font-geist-mono), monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
        .rn-stat-value { font-family: var(--font-geist-mono), monospace; font-size: 18px; font-weight: 700; color: var(--text-primary); line-height: 1; }

        .rn-section { padding: 16px 18px; border-bottom: 1px solid var(--border); }
        .rn-section:last-child { border-bottom: none; }
        .rn-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .rn-section-title { font-family: var(--font-geist-mono), monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); }

        .rn-tab-group { display: flex; gap: 0; border: 1px solid var(--border); }
        .rn-tab-btn {
          padding: 3px 10px; font-family: var(--font-geist-mono), monospace; font-size: 9px;
          text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer;
          background: transparent; border: none; color: var(--text-secondary);
          border-right: 1px solid var(--border); transition: all 0.1s;
        }
        .rn-tab-btn:last-child { border-right: none; }
        .rn-tab-btn[data-active="true"] { background: var(--amber); color: var(--surface); }
        .rn-tab-btn:hover:not([data-active="true"]) { background: var(--surface-overlay); color: var(--text-primary); }

        .rn-findings-empty { font-family: var(--font-geist-mono), monospace; font-size: 11px; color: var(--text-dim); padding: 16px 0; text-align: center; border: 1px dashed var(--border); }
        .rn-findings-list { display: flex; flex-direction: column; gap: 1px; background: var(--border); border: 1px solid var(--border); }

        .rn-finding-row { background: var(--surface); padding: 9px 12px; display: flex; flex-direction: column; gap: 5px; }
        .rn-finding-row:hover { background: var(--surface-raised); }
        .rn-finding-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .sev-badge { font-family: var(--font-geist-mono), monospace; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 1px 5px; flex-shrink: 0; }
        .rn-source-tag { font-family: var(--font-geist-mono), monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); border: 1px solid var(--border); padding: 1px 4px; flex-shrink: 0; }
        .rn-finding-rule { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .rn-fix-status { font-family: var(--font-geist-mono), monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); flex-shrink: 0; }
        .rn-fix-status[data-status="fixed"] { color: #34d399; }
        .rn-fix-status[data-status="failed"] { color: #f87171; }

        .rn-finding-loc { display: flex; align-items: center; gap: 5px; }
        .rn-finding-file { font-family: var(--font-geist-mono), monospace; font-size: 9px; color: var(--text-secondary); }
        .rn-finding-line { font-family: var(--font-geist-mono), monospace; font-size: 9px; color: var(--text-dim); }

        .rn-finding-pkg { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .rn-finding-pkg-name { font-family: var(--font-geist-mono), monospace; font-size: 9px; color: var(--text-secondary); }
        .rn-finding-ver { font-family: var(--font-geist-mono), monospace; font-size: 9px; color: var(--text-dim); border: 1px solid var(--border); padding: 0 4px; }

        .rn-timeline { display: flex; flex-direction: column; gap: 0; }
        .rn-tl-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); }
        .rn-tl-row:last-child { border-bottom: none; }
        .rn-tl-key { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
        .rn-tl-val { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-secondary); }

        .rn-runs-list { display: flex; flex-direction: column; gap: 1px; background: var(--border); border: 1px solid var(--border); }
        .rn-run-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface); }
        .rn-run-agent { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-primary); flex: 1; }
        .rn-run-model { font-family: var(--font-geist-mono), monospace; font-size: 9px; color: var(--text-dim); }
        .rn-run-status { font-family: var(--font-geist-mono), monospace; font-size: 9px; text-transform: uppercase; color: var(--text-secondary); }
        .rn-run-status[data-ok="true"] { color: #34d399; }

        .rn-cost-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
        .rn-cost-row:last-child { border-bottom: none; }
        .rn-cost-model { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-secondary); flex: 1; }
        .rn-cost-tokens { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--text-dim); }
        .rn-cost-usd { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--amber); }

        .rn-pr-link {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--font-geist-mono), monospace; font-size: 11px;
          color: var(--amber); text-decoration: none;
          padding: 8px 12px; border: 1px solid rgba(245,158,11,0.25);
          background: rgba(245,158,11,0.05);
          transition: background 0.12s;
        }
        .rn-pr-link:hover { background: rgba(245,158,11,0.1); }
      `}</style>
    </div>
  );
}
