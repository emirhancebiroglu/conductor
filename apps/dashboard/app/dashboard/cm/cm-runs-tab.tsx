"use client";

import { useState, useEffect, useCallback } from "react";

type CmScan = {
  id: string;
  repo_id: string;
  status: string;
  trigger: string;
  findings_total: number;
  findings_actionable: number;
  current_step: string | null;
  pr_url: string | null;
  report_path: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type ScanDetail = {
  scan: CmScan;
  findings: Array<{
    severity: string;
    source: string;
    rule: string | null;
    package: string | null;
    fix_status: string;
    file: string | null;
    line: number | null;
  }>;
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

const STATUS_COLORS: Record<string, string> = {
  queued: "#6b7280",
  scanning: "#fbbf24",
  scan_done: "#34d399",
  scan_failed: "#f87171",
  fixing: "#60a5fa",
  fixed: "#34d399",
  rescanning: "#fbbf24",
  verified: "#34d399",
  pr_opening: "#60a5fa",
  pr_opened: "#818cf8",
  reporting: "#60a5fa",
  done: "#34d399",
  failed: "#f87171",
  needs_human: "#f97316",
  run_blocked: "#f97316",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

export function CmRunsTab() {
  const [scans, setScans] = useState<CmScan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedScan, setSelectedScan] = useState<ScanDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchScans = useCallback(async () => {
    try {
      const res = await fetch("/api/cm/scans");
      const json = await res.json();
      setScans(Array.isArray(json) ? json : []);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchScans(); }, [fetchScans]);

  const openDetail = async (scanId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/cm/scans/${scanId}`);
      const json = await res.json();
      setSelectedScan(json as ScanDetail);
    } catch {
      setSelectedScan(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="runs-layout">
      {/* Scans list */}
      <div className="runs-list" style={{ flex: selectedScan ? 1 : "none", maxWidth: selectedScan ? "500px" : "100%" }}>
        <div className="runs-toolbar">
          <button onClick={fetchScans} className="rn-btn">↻ Refresh</button>
        </div>

        {isLoading ? (
          <div className="rn-placeholder">Loading scans...</div>
        ) : scans.length === 0 ? (
          <div className="rn-placeholder">No scans yet. Trigger a scan from the Repos tab.</div>
        ) : (
          <div className="rn-table">
            <div className="rn-header">
              <span className="rn-hcol rn-hcol--status">Status</span>
              <span className="rn-hcol rn-hcol--findings">Findings</span>
              <span className="rn-hcol rn-hcol--trigger">Trigger</span>
              <span className="rn-hcol rn-hcol--time">Started</span>
            </div>
            {scans.map((scan) => (
              <div
                key={scan.id}
                className="rn-row"
                onClick={() => openDetail(scan.id)}
                style={{
                  backgroundColor: selectedScan?.scan.id === scan.id ? "var(--amber-glow)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span className="rn-hcol rn-hcol--status">
                  <span className="rn-status-dot" style={{ backgroundColor: STATUS_COLORS[scan.status] ?? "#6b7280" }} />
                  <span className="rn-status-label">{scan.status}</span>
                </span>
                <span className="rn-hcol rn-hcol--findings">
                  <span className="rn-findings">{scan.findings_actionable}/{scan.findings_total}</span>
                </span>
                <span className="rn-hcol rn-hcol--trigger">
                  <span className={`rn-trigger-badge rn-trigger-${scan.trigger}`}>{scan.trigger}</span>
                </span>
                <span className="rn-hcol rn-hcol--time">
                  <span className="rn-time">{formatTime(scan.started_at)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedScan && (
        <div className="rn-detail">
          <div className="rn-detail-header">
            <h3 className="rn-detail-title">Scan Detail</h3>
            <button onClick={() => setSelectedScan(null)} className="rn-btn rn-btn--sm">✕</button>
          </div>

          {detailLoading ? (
            <div className="rn-placeholder" style={{ padding: "40px" }}>Loading...</div>
          ) : (
            <div className="rn-detail-body">
              {/* Summary */}
              <section className="rn-section">
                <h4 className="rn-section-title">Summary</h4>
                <div className="rn-summary-grid">
                  <div className="rn-summary-item"><span className="rn-label">Status</span><span style={{ color: STATUS_COLORS[selectedScan.scan.status] }}>{selectedScan.scan.status}</span></div>
                  <div className="rn-summary-item"><span className="rn-label">Trigger</span><span>{selectedScan.scan.trigger}</span></div>
                  <div className="rn-summary-item"><span className="rn-label">Total Findings</span><span>{selectedScan.scan.findings_total}</span></div>
                  <div className="rn-summary-item"><span className="rn-label">Actionable</span><span>{selectedScan.scan.findings_actionable}</span></div>
                  <div className="rn-summary-item"><span className="rn-label">Started</span><span>{formatTime(selectedScan.scan.started_at)}</span></div>
                  <div className="rn-summary-item"><span className="rn-label">Finished</span><span>{formatTime(selectedScan.scan.finished_at)}</span></div>
                </div>
                {selectedScan.scan.error && (
                  <div className="rn-error">{selectedScan.scan.error}</div>
                )}
                {selectedScan.scan.current_step && (
                  <p className="rn-step">Current: {selectedScan.scan.current_step}</p>
                )}
              </section>

              {/* Findings */}
              <section className="rn-section">
                <h4 className="rn-section-title">Findings ({selectedScan.findings.length})</h4>
                {selectedScan.findings.length === 0 ? (
                  <p className="rn-empty">No findings</p>
                ) : (
                  <div className="rn-findings-table">
                    <div className="rn-fheader">
                      <span>Severity</span><span>Source</span><span>Rule</span><span>Status</span>
                    </div>
                    {selectedScan.findings.map((f, i) => (
                      <div key={i} className="rn-frow">
                        <span className={`rn-severity rn-sev-${f.severity.toLowerCase()}`}>{f.severity}</span>
                        <span>{f.source}</span>
                        <span className="rn-mono">{f.rule ?? f.package ?? "-"}</span>
                        <span>{f.fix_status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Agent Steps */}
              <section className="rn-section">
                <h4 className="rn-section-title">Agent Steps ({selectedScan.runs.length})</h4>
                {selectedScan.runs.length === 0 ? (
                  <p className="rn-empty">No agent steps</p>
                ) : (
                  <div className="rn-runs-table">
                    {selectedScan.runs.map((run) => (
                      <div key={run.id} className="rn-run-row">
                        <span className="rn-mono">{run.agent}</span>
                        <span className="rn-model">{run.model}</span>
                        <span className="rn-run-status">{run.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Cost */}
              <section className="rn-section">
                <h4 className="rn-section-title">Cost</h4>
                {selectedScan.usageLog.length === 0 ? (
                  <p className="rn-empty">No usage data</p>
                ) : (
                  <div className="rn-cost-table">
                    <div className="rn-fheader">
                      <span>Model</span><span>Input</span><span>Output</span><span>Cost</span>
                    </div>
                    {selectedScan.usageLog.map((u, i) => (
                      <div key={i} className="rn-frow">
                        <span className="rn-mono">{u.model}</span>
                        <span>{u.input_tokens}</span>
                        <span>{u.output_tokens}</span>
                        <span>${(u.est_cost_usd ?? 0).toFixed(6)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Links */}
              <section className="rn-section">
                <h4 className="rn-section-title">Links</h4>
                {selectedScan.scan.pr_url ? (
                  <a href={selectedScan.scan.pr_url} target="_blank" rel="noopener noreferrer" className="rn-link">View PR →</a>
                ) : (
                  <p className="rn-empty">No PR</p>
                )}
                {selectedScan.scan.report_path && (
                  <p className="rn-report-path">Report: {selectedScan.scan.report_path}</p>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .runs-layout { display: flex; gap: 16px; align-items: flex-start; }
        .runs-list { min-width: 0; }
        .runs-toolbar { margin-bottom: 12px; }
        .rn-btn { background: transparent; border: 1px solid var(--border); padding: 6px 14px; font-size: 11px; border-radius: 4px; color: var(--text-secondary); cursor: pointer; }
        .rn-btn--sm { padding: 4px 8px; font-size: 12px; }
        .rn-placeholder { padding: 40px 0; text-align: center; color: var(--text-dim); font-size: 13px; }
        .rn-table { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; min-width: 480px; }
        .rn-header { display: flex; padding: 8px 12px; background: var(--surface-overlay); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); border-bottom: 1px solid var(--border); }
        .rn-hcol { flex: 1; display: flex; align-items: center; gap: 6px; }
        .rn-hcol--status { flex: 1.5; }
        .rn-hcol--findings { flex: 0.8; }
        .rn-hcol--trigger { flex: 0.8; }
        .rn-row { display: flex; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; transition: background 0.1s; }
        .rn-row:hover { background: var(--amber-glow); }
        .rn-row:last-child { border-bottom: none; }
        .rn-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .rn-status-label { font-family: var(--font-geist-mono), monospace; font-size: 11px; }
        .rn-findings { font-family: var(--font-geist-mono), monospace; }
        .rn-trigger-badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; }
        .rn-trigger-manual { background: rgba(251,191,36,0.1); color: #fbbf24; }
        .rn-trigger-schedule { background: rgba(129,140,248,0.1); color: #818cf8; }
        .rn-time { font-size: 11px; color: var(--text-dim); }

        .rn-detail { flex: 2; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; max-height: 80vh; overflow-y: auto; }
        .rn-detail-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--surface-overlay); border-bottom: 1px solid var(--border); }
        .rn-detail-title { font-size: 13px; font-weight: 500; margin: 0; }
        .rn-detail-body { padding: 16px; }
        .rn-section { margin-bottom: 20px; }
        .rn-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); margin: 0 0 8px 0; }
        .rn-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; }
        .rn-summary-item { display: flex; justify-content: space-between; padding: 6px 8px; background: var(--surface-overlay); border-radius: 4px; }
        .rn-label { color: var(--text-dim); font-size: 11px; }
        .rn-error { margin-top: 8px; padding: 8px; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.2); border-radius: 4px; font-size: 11px; color: #f87171; font-family: var(--font-geist-mono), monospace; }
        .rn-step { font-size: 11px; color: var(--text-dim); margin: 8px 0 0; }
        .rn-empty { font-size: 12px; color: var(--text-dim); }
        .rn-findings-table, .rn-cost-table, .rn-runs-table { font-size: 11px; }
        .rn-fheader { display: flex; padding: 6px 8px; gap: 12px; background: var(--surface-overlay); border-radius: 4px 4px 0 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); }
        .rn-fheader span { flex: 1; }
        .rn-frow { display: flex; padding: 6px 8px; gap: 12px; border-bottom: 1px solid var(--border); font-size: 11px; align-items: center; }
        .rn-frow span { flex: 1; }
        .rn-frow:last-child { border-bottom: none; }
        .rn-severity { font-family: var(--font-geist-mono), monospace; font-weight: 500; }
        .rn-sev-critical { color: #f87171; }
        .rn-sev-high { color: #fb923c; }
        .rn-sev-medium { color: #fbbf24; }
        .rn-sev-low { color: #6b7280; }
        .rn-mono { font-family: var(--font-geist-mono), monospace; }
        .rn-model { font-size: 10px; color: var(--text-dim); }
        .rn-run-status { text-transform: uppercase; font-size: 10px; }
        .rn-run-row { display: flex; gap: 12px; padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 11px; }
        .rn-run-row span { flex: 1; }
        .rn-link { display: inline-block; color: var(--amber); font-size: 12px; text-decoration: none; }
        .rn-link:hover { text-decoration: underline; }
        .rn-report-path { font-size: 11px; color: var(--text-dim); font-family: var(--font-geist-mono), monospace; margin-top: 4px; }
      `}</style>
    </div>
  );
}
