"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CmPipelineForm } from "./cm-pipeline-form";
import { CmReposTab } from "./cm-repos-tab";
import { CmRunsTab } from "./cm-runs-tab";

type Tab = "pipeline" | "repos" | "runs" | "reports";

const TABS: { key: Tab; label: string }[] = [
  { key: "pipeline", label: "Pipeline" },
  { key: "repos", label: "Repos" },
  { key: "runs", label: "Runs" },
  { key: "reports", label: "Reports" },
];

const VALID_TABS = new Set<string>(TABS.map((t) => t.key));

function CmClientInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab") ?? "";
  const activeTab: Tab = VALID_TABS.has(rawTab) ? (rawTab as Tab) : "pipeline";

  const setTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

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
            onClick={() => setTab(tab.key)}
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
        {activeTab === "pipeline" && <CmPipelineForm />}
        {activeTab === "repos" && <CmReposTab />}
        {activeTab === "runs" && <CmRunsTab />}
        {activeTab === "reports" && (
          <div className="cm-placeholder" style={{ padding: "60px", textAlign: "center", color: "var(--text-dim)", border: "1px dashed var(--border)", fontSize: "12px" }}>
            <div style={{ fontSize: "24px", marginBottom: "12px", opacity: 0.3 }}>⬡</div>
            Reports generation not yet enabled.
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

export function CmClient() {
  return (
    <Suspense fallback={null}>
      <CmClientInner />
    </Suspense>
  );
}
