import type { AgentConfig, AgentCategory, RunningJob } from "@conductor/core";
import Link from "next/link";
import { AgentStatusBadge } from "./agent-status-badge";

interface AgentCategorySectionProps {
  readonly category: AgentCategory | null; // null = Uncategorized
  readonly agents: AgentConfig[];
  readonly runningJobs: RunningJob[];
  readonly lastRuns: Record<string, { status: string } | undefined>;
  readonly index: number;
}

function AgentGridCard({
  agent,
  runningJob,
  lastRunStatus,
  cardIndex,
}: {
  readonly agent: AgentConfig;
  readonly runningJob?: RunningJob;
  readonly lastRunStatus?: string;
  readonly cardIndex: number;
}) {
  let status: "running" | "idle" | "error" | "disabled" = "idle";
  if (!agent.enabled) status = "disabled";
  else if (runningJob) status = "running";
  else if (lastRunStatus === "failed") status = "error";

  return (
    <Link
      href={`/dashboard/agents/${agent.agentName}`}
      className="agent-grid-card"
      data-disabled={!agent.enabled}
      style={{ animationDelay: `${cardIndex * 30}ms` }}
      data-testid="agent-card"
    >
      <div className="agent-grid-card-header">
        <span className="agent-grid-card-name">{agent.displayName}</span>
        <AgentStatusBadge status={status} {...(runningJob ? { jobLink: `/dashboard/jobs/${runningJob.jobId}` } : {})} />
      </div>

      <p className="agent-grid-card-role">{agent.role}</p>

      <div className="agent-grid-card-footer">
        <span className="agent-provider-pill">{agent.provider}</span>
        <span className="agent-model-label" title={agent.model}>{agent.model}</span>
      </div>

      {runningJob && (
        <div className="agent-grid-card-running">
          <span className="agent-job-dot" />
          <span className="truncate">{runningJob.jobTitle}</span>
        </div>
      )}
    </Link>
  );
}

export function AgentCategorySection({
  category,
  agents,
  runningJobs,
  lastRuns,
  index,
}: AgentCategorySectionProps) {
  const sectionColor = category?.color ?? "var(--text-dim)";
  const sectionName = category?.name ?? "Uncategorized";

  return (
    <section
      className="cat-section"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Section header */}
      <div className="cat-section-header">
        <div className="cat-section-title-row">
          <span className="cat-section-dot" style={{ backgroundColor: sectionColor }} />
          <h2 className="cat-section-name">{sectionName}</h2>
          <span className="cat-section-count">{agents.length}</span>
        </div>
        {category?.description && (
          <p className="cat-section-desc">{category.description}</p>
        )}
      </div>

      {/* Agent grid */}
      {agents.length === 0 ? (
        <div className="cat-section-empty">No agents in this category</div>
      ) : (
        <div className="agent-grid">
          {agents.map((agent, cardIndex) => {
            const runningJob = runningJobs.find((j) => j.agentName === agent.agentName);
            const lastRun = lastRuns[agent.agentName];
            return (
              <AgentGridCard
                key={agent.agentName}
                agent={agent}
                {...(runningJob ? { runningJob } : {})}
                {...(lastRun?.status ? { lastRunStatus: lastRun.status } : {})}
                cardIndex={cardIndex}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
