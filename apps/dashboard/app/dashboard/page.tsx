export default function DashboardPage() {
  return (
    <div className="max-w-3xl">
      {/* Welcome block */}
      <div className="mb-8 opacity-0 animate-fade-up" style={{ animationFillMode: "forwards" }}>
        <div className="flex items-center gap-2 mb-2">
          <div
            className="text-xs uppercase tracking-widest"
            style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
          >
            STATUS
          </div>
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 border text-xs"
            style={{ borderColor: "#065f46", color: "#34d399", fontSize: "10px" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full inline-block"
              style={{ backgroundColor: "#34d399" }}
            />
            ONLINE
          </div>
        </div>

        <h1
          className="text-3xl font-bold mb-1"
          style={{
            fontFamily: "Syne, sans-serif",
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
          }}
        >
          Hoş geldin, Conductor 🎼
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          AI-powered feature pipeline · control plane ready
        </p>
      </div>

      {/* Quick-start panels */}
      <div
        className="grid grid-cols-3 gap-px mb-6 opacity-0 animate-fade-up delay-100"
        style={{ animationFillMode: "forwards", backgroundColor: "var(--border)" }}
      >
        {[
          { label: "PROJECTS", value: "—", sub: "none connected" },
          { label: "JOBS", value: "—", sub: "no jobs yet" },
          { label: "COST (MTD)", value: "$0.00", sub: "no usage" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="px-5 py-4"
            style={{ backgroundColor: "var(--surface-raised)" }}
          >
            <div
              className="text-xs uppercase tracking-widest mb-2"
              style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
            >
              {stat.label}
            </div>
            <div
              className="text-2xl font-bold mb-0.5"
              style={{ fontFamily: "Syne, sans-serif", color: "var(--text-primary)" }}
            >
              {stat.value}
            </div>
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>
              {stat.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Next steps */}
      <div
        className="border p-5 opacity-0 animate-fade-up delay-200"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface-raised)",
          animationFillMode: "forwards",
        }}
      >
        <div
          className="text-xs uppercase tracking-widest mb-4"
          style={{ color: "var(--text-dim)", letterSpacing: "0.12em", fontSize: "10px" }}
        >
          Next steps · Faz 1
        </div>
        <ol className="space-y-2.5">
          {[
            { id: "T-102", label: "Connect GitHub App / OAuth → pull repo list" },
            { id: "T-103", label: "Link a project → creates projects record" },
            { id: "T-104", label: "Submit first feature → POST /api/jobs" },
            { id: "T-105", label: "View job list + detail page" },
            { id: "T-106", label: "Supabase Realtime live status updates" },
          ].map((step, i) => (
            <li key={step.id} className="flex items-start gap-3">
              <span
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs border mt-px"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-dim)",
                  fontSize: "10px",
                }}
              >
                {i + 1}
              </span>
              <div>
                <span
                  className="text-xs mr-2 px-1.5 py-px"
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--amber)",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "10px",
                  }}
                >
                  {step.id}
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {step.label}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
