"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type WorkerStatus = "online" | "paused_limit" | "paused_manual";

function useWorkerStatus(): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>("online");

  useEffect(() => {
    const supabase = createClient();

    // Initial fetch — worker_status not in generated types, cast via any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("worker_status")
      .select("status")
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: { status: string } | null }) => {
        if (data) setStatus(data.status as WorkerStatus);
      })
      .catch(() => {/* non-fatal */});

    // Realtime updates — no more polling
    const channel = supabase
      .channel("worker-status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_status" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { status?: string } | null;
          if (row?.status) setStatus(row.status as WorkerStatus);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return status;
}

const NAV = [
  {
    label: "Projects",
    href: "/dashboard/projects",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="8" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="1" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="8" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    label: "Jobs",
    href: "/dashboard/jobs",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 3h12M1 7h8M1 11h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
      </svg>
    ),
  },
  {
    label: "Costs",
    href: "/dashboard/costs",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M7 1v12M4 4h4.5C9.9 4 11 4.9 11 6s-1.1 2-2.5 2H4M4 8h5c1.4 0 2.5.9 2.5 2s-1.1 2-2.5 2H4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="square"
        />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const workerStatus = useWorkerStatus();
  const isPaused = workerStatus !== "online";

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 flex flex-col"
      style={{
        width: "var(--sidebar-w)",
        backgroundColor: "var(--surface-raised)",
        borderRight: "1px solid var(--border)",
        zIndex: 40,
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-5 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div
          className="w-6 h-6 flex items-center justify-center flex-shrink-0"
          style={{ border: "1px solid var(--amber)", color: "var(--amber)" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 6L3.5 3.5L6 6L8.5 3.5L11 6"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="square"
            />
            <path
              d="M1 9L3.5 6.5L6 9L8.5 6.5L11 9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="square"
              opacity="0.35"
            />
          </svg>
        </div>
        <span
          className="text-sm font-semibold tracking-wider"
          style={{
            fontFamily: "Syne, sans-serif",
            color: "var(--text-primary)",
            letterSpacing: "0.1em",
          }}
        >
          CONDUCTOR
        </span>
      </div>

      {/* New Feature CTA */}
      <div className="px-3 pt-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link href="/dashboard/jobs/new" className="new-feature-btn">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
          NEW FEATURE
        </Link>
      </div>

      {/* Nav label */}
      <div className="px-5 pt-4 pb-2">
        <span
          className="text-xs uppercase tracking-widest"
          style={{ color: "var(--text-dim)", letterSpacing: "0.14em", fontSize: "10px" }}
        >
          Navigation
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3">
        {NAV.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 mb-0.5 text-xs transition-all group"
              style={{
                color: isActive ? "var(--amber)" : "var(--text-secondary)",
                backgroundColor: isActive ? "var(--amber-glow)" : "transparent",
                borderLeft: isActive
                  ? "2px solid var(--amber)"
                  : "2px solid transparent",
                letterSpacing: "0.04em",
              }}
            >
              <span
                style={{
                  color: isActive ? "var(--amber)" : "var(--text-dim)",
                  transition: "color 0.15s",
                }}
              >
                {item.icon}
              </span>
              {item.label}
              {isActive && (
                <span
                  className="ml-auto text-xs"
                  style={{ color: "var(--amber)", opacity: 0.6 }}
                >
                  ▸
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer — worker status */}
      <div
        className="px-5 py-4"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: isPaused ? "#f59e0b" : "#34d399" }}
          />
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
            {isPaused ? "duraklatıldı" : "system online"}
          </span>
        </div>
      </div>
    </aside>
  );
}
