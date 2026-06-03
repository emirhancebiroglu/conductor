"use client";

import { useState } from "react";

type Tab = "pipeline" | "repos" | "runs" | "reports";

const TABS: { key: Tab; label: string }[] = [
  { key: "pipeline", label: "Pipeline" },
  { key: "repos", label: "Repos" },
  { key: "runs", label: "Runs" },
  { key: "reports", label: "Reports" },
];

export function CmClient() {
  const [activeTab, setActiveTab] = useState<Tab>("pipeline");

  return (
    <div className="cm-page">
      <header className="cm-header">
        <div>
          <p className="cm-eyebrow">Checkmarx · Auto-Scan &amp; Fix</p>
          <h1 className="cm-title">CM Pipeline</h1>
        </div>
      </header>

      <div className="cm-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="cm-tab"
            style={{
              color: activeTab === tab.key ? "var(--amber)" : "var(--text-secondary)",
              borderBottom: activeTab === tab.key ? "2px solid var(--amber)" : "2px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="cm-content">
        {activeTab === "pipeline" && (
          <div className="cm-placeholder">
            <p>Pipeline settings form will be rendered here.</p>
          </div>
        )}
        {activeTab === "repos" && (
          <div className="cm-placeholder">
            <p>Repos management tab will be rendered here.</p>
          </div>
        )}
        {activeTab === "runs" && (
          <div className="cm-placeholder">
            <p>Runs list and detail will be rendered here.</p>
          </div>
        )}
        {activeTab === "reports" && (
          <div className="cm-placeholder">
            <p>Reports download will be rendered here.</p>
          </div>
        )}
      </div>

      <style jsx>{`
        .cm-page {
          padding: 24px 32px;
        }
        .cm-header {
          margin-bottom: 24px;
        }
        .cm-eyebrow {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--text-dim);
          margin: 0 0 4px 0;
          font-family: "Syne", sans-serif;
        }
        .cm-title {
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
          font-family: "Syne", sans-serif;
          letter-spacing: 0.03em;
        }
        .cm-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border);
          margin-bottom: 24px;
        }
        .cm-tab {
          background: none;
          border: none;
          padding: 10px 20px;
          font-size: 12px;
          font-family: "Syne", sans-serif;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.15s;
        }
        .cm-tab:hover {
          color: var(--amber);
        }
        .cm-placeholder {
          padding: 40px;
          text-align: center;
          color: var(--text-dim);
          font-size: 13px;
          border: 1px dashed var(--border);
          border-radius: 6px;
        }
      `}</style>
    </div>
  );
}
