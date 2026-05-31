import type { AgentConfig } from "@conductor/core";
import Link from "next/link";
import { AgentStatusBadge } from "./agent-status-badge";

interface AgentCardProps {
  agent: AgentConfig;
  isSelected: boolean;
  isRunning: boolean;
  runningJobId?: string | undefined;
  runningJobTitle?: string | undefined;
  lastRunStatus?: string | undefined;
  onClick: () => void;
  index?: number;
}

export function AgentCard({
  agent,
  isSelected,
  isRunning,
  runningJobId,
  runningJobTitle,
  lastRunStatus,
  onClick,
  index = 0,
}: AgentCardProps) {
  let status: "running" | "idle" | "error" | "disabled" = "idle";
  if (!agent.enabled) {
    status = "disabled";
  } else if (isRunning) {
    status = "running";
  } else if (lastRunStatus === "failed") {
    status = "error";
  }

  const jobLink =
    isRunning && runningJobId
      ? `/dashboard/jobs/${runningJobId}`
      : undefined;

  const delayStyle = {
    animationDelay: `${index * 40}ms`,
    animationFillMode: "both" as const,
  };

  return (
    <div
      onClick={onClick}
      className="agent-card-row group"
      data-selected={isSelected}
      data-disabled={!agent.enabled}
      style={delayStyle}
    >
      {/* Selected accent bar */}
      <div className="agent-card-accent" />

      <div className="agent-card-inner">
        {/* Top row: name + badge */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="agent-card-name">
            {agent.displayName}
          </span>
          <AgentStatusBadge
            status={status}
            {...(jobLink ? { jobLink } : {})}
          />
        </div>

        {/* Role */}
        <p className="agent-card-role">{agent.role}</p>

        {/* Bottom row: model pill + running job */}
        <div className="agent-card-footer">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="agent-provider-pill">{agent.provider}</span>
            <span className="agent-model-label" title={agent.model}>
              {agent.model}
            </span>
          </div>

          {isRunning && runningJobTitle && jobLink && (
            <Link
              href={jobLink}
              onClick={(e) => e.stopPropagation()}
              className="agent-job-link"
            >
              <span className="agent-job-dot" />
              <span className="truncate">{runningJobTitle}</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
