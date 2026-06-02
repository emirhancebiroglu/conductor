"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getWorkspaceCookie, setWorkspaceCookie } from "@/lib/workspace";
import type { WorkspaceKind } from "@conductor/core";

const WORKSPACES: { kind: WorkspaceKind; label: string; icon: React.ReactNode }[] = [
  {
    kind: "personal",
    label: "Personal",
    icon: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <circle cx="5" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1.5 9C1.5 7.067 3.067 5.5 5 5.5s3.5 1.567 3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
      </svg>
    ),
  },
  {
    kind: "work",
    label: "Work",
    icon: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <rect x="1" y="3.5" width="8" height="5.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3.5 3.5V2.5a1.5 1.5 0 0 1 3 0v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
      </svg>
    ),
  },
];

export function WorkspaceSwitcher() {
  const router = useRouter();
  const [active, setActive] = useState<WorkspaceKind>("personal");

  useEffect(() => {
    setActive(getWorkspaceCookie());
  }, []);

  function handleSelect(kind: WorkspaceKind) {
    if (kind === active) return;
    setActive(kind);
    setWorkspaceCookie(kind);
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label="Workspace"
      style={{
        display: "flex",
        gap: "1px",
        background: "var(--border)",
        border: "1px solid var(--border)",
      }}
    >
      {WORKSPACES.map(({ kind, label, icon }) => {
        const isActive = active === kind;
        const isWork = kind === "work";
        const activeColor = isWork ? "#38bdf8" : "var(--amber)";
        const activeGlow = isWork ? "rgba(56,189,248,0.08)" : "var(--amber-glow)";
        const activeBorder = isWork ? "rgba(56,189,248,0.4)" : "var(--amber)";

        return (
          <button
            key={kind}
            role="button"
            aria-pressed={isActive}
            onClick={() => handleSelect(kind)}
            data-workspace={kind}
            data-active={isActive}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              padding: "6px 0",
              background: isActive ? activeGlow : "var(--surface-raised)",
              border: "none",
              borderLeft: isActive ? `2px solid ${activeBorder}` : "2px solid transparent",
              color: isActive ? activeColor : "var(--text-dim)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "9px",
              fontWeight: isActive ? 700 : 400,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              cursor: "pointer",
              transition: "color 0.15s, background 0.15s, border-color 0.15s",
              outline: "none",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.background = "var(--surface-overlay)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = "var(--text-dim)";
                e.currentTarget.style.background = "var(--surface-raised)";
              }
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = `1px solid ${activeBorder}`;
              e.currentTarget.style.outlineOffset = "-1px";
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = "none";
            }}
          >
            <span
              style={{
                color: isActive ? activeColor : "var(--text-dim)",
                transition: "color 0.15s",
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
            {label}
            {isActive && (
              <span
                aria-hidden="true"
                style={{
                  width: "4px",
                  height: "4px",
                  borderRadius: "50%",
                  background: activeColor,
                  flexShrink: 0,
                  boxShadow: `0 0 6px ${activeColor}`,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
