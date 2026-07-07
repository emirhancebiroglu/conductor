"use client";

import { useCmReports } from "@/lib/hooks/use-cm-reports";

type CmReport = {
  id: string;
  scan_id: string;
  path: string;
  format: string;
  created_at: string;
  cm_scan: {
    id: string;
    status: string;
    findings_total: number;
    findings_actionable: number;
    cm_repo: { owner: string; name: string } | null;
  } | null;
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  verified: { color: "#34d399", label: "Verified" },
  done: { color: "#34d399", label: "Done" },
  needs_human: { color: "#fb923c", label: "Needs Review" },
  failed: { color: "#f87171", label: "Failed" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { color: "#7a7468", label: status };
  return (
    <span className="rp-status-badge" style={{ color: cfg.color, borderColor: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function CmReportsTab() {
  const { reports: rawReports, isLoading } = useCmReports();
  const reports = rawReports as CmReport[];

  return (
    <div className="rp-root">
      {isLoading ? (
        <div className="rp-empty">Loading reports…</div>
      ) : reports.length === 0 ? (
        <div className="rp-empty">
          <div className="rp-empty-icon">⬡</div>
          No reports generated yet. Reports appear here once a scan reaches Verified.
        </div>
      ) : (
        <div className="rp-list">
          {reports.map((r) => (
            <div key={r.id} className="rp-card">
              <div className="rp-card-main">
                <div className="rp-card-top">
                  <span className="rp-repo-name">{r.cm_scan?.cm_repo ? `${r.cm_scan.cm_repo.owner}/${r.cm_scan.cm_repo.name}` : "unknown repo"}</span>
                  {r.cm_scan && <StatusBadge status={r.cm_scan.status} />}
                </div>
                <div className="rp-card-meta">
                  <span>{formatTime(r.created_at)}</span>
                  {r.cm_scan && <span>{r.cm_scan.findings_actionable} actionable / {r.cm_scan.findings_total} total</span>}
                  <span className="rp-format">{r.format.toUpperCase()}</span>
                </div>
              </div>
              <a className="rp-download" href={`/api/cm/reports/${r.id}/download`} download>
                Download
              </a>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .rp-root {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .rp-empty {
          padding: 60px;
          text-align: center;
          color: var(--text-dim);
          border: 1px dashed var(--border);
          border-radius: 6px;
          font-size: 12px;
        }
        .rp-empty-icon {
          font-size: 24px;
          margin-bottom: 12px;
          opacity: 0.3;
        }
        .rp-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .rp-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-secondary, rgba(255, 255, 255, 0.02));
        }
        .rp-card-main {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .rp-card-top {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .rp-repo-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .rp-card-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 11px;
          color: var(--text-dim);
        }
        .rp-format {
          padding: 1px 6px;
          border: 1px solid var(--border);
          border-radius: 4px;
          font-size: 9px;
          letter-spacing: 0.04em;
        }
        .rp-status-badge {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 2px 8px;
          border: 1px solid;
          border-radius: 10px;
        }
        .rp-download {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 8px 16px;
          border: 1px solid var(--amber);
          border-radius: 6px;
          color: var(--amber);
          text-decoration: none;
          transition: all 0.15s;
        }
        .rp-download:hover {
          background: var(--amber);
          color: #000;
        }
      `}</style>
    </div>
  );
}
