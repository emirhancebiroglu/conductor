import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentCard } from "@/app/dashboard/agents/components/agent-card";
import type { AgentConfig } from "@conductor/core";

const mockAgent: AgentConfig = {
  id: "uuid-1",
  agentName: "product-owner",
  displayName: "Product Owner",
  role: "Gathers requirements and creates spec",
  provider: "claude",
  model: "claude-sonnet-4-6",
  systemPrompt: "You are the product owner...",
  skillPath: "skills/product-owner/SKILL.md",
  enabled: true,
  laneOverride: null,
  order: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

vi.mock("next/link", () => ({
  default: ({ children, href, className, onClick }: { children: React.ReactNode; href: string; className?: string; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} className={className} onClick={onClick} data-testid="link">
      {children}
    </a>
  ),
}));

vi.mock("@/app/dashboard/agents/components/agent-status-badge", () => ({
  AgentStatusBadge: ({ status, jobTitle, jobLink }: { status: string; jobTitle?: string; jobLink?: string }) => (
    <div data-testid="status-badge" data-status={status}>
      {status}
      {jobTitle && <span data-testid="job-title">{jobTitle}</span>}
      {jobLink && <a href={jobLink} data-testid="job-link">link</a>}
    </div>
  ),
}));

describe("AgentCard", () => {
  const onClick = vi.fn();

  beforeEach(() => {
    onClick.mockClear();
  });

  it("displays agent display name", () => {
    render(
      <AgentCard
        agent={mockAgent}
        isSelected={false}
        isRunning={false}
        onClick={onClick}
      />,
    );

    expect(screen.getByText("Product Owner")).toBeInTheDocument();
  });

  it("displays model badge", () => {
    render(
      <AgentCard
        agent={mockAgent}
        isSelected={false}
        isRunning={false}
        onClick={onClick}
      />,
    );

    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("clicking card fires onClick handler", () => {
    render(
      <AgentCard
        agent={mockAgent}
        isSelected={false}
        isRunning={false}
        onClick={onClick}
      />,
    );

    const card = screen.getByText("Product Owner").closest("div[onclick], div[style]");
    card?.click();

    expect(onClick).toHaveBeenCalled();
  });

  it("selected card has amber border", () => {
    const { container } = render(
      <AgentCard
        agent={mockAgent}
        isSelected={true}
        isRunning={false}
        onClick={onClick}
      />,
    );

    const card = container.querySelector("div[style*='var(--amber)']");
    expect(card).not.toBeNull();
  });

  it("running card shows pulsing amber dot", () => {
    render(
      <AgentCard
        agent={mockAgent}
        isSelected={false}
        isRunning={true}
        runningJobId="job-1"
        runningJobTitle="Login Feature"
        onClick={onClick}
      />,
    );

    const badge = screen.getByTestId("status-badge");
    expect(badge.getAttribute("data-status")).toBe("running");
  });

  it("running card shows job title", () => {
    render(
      <AgentCard
        agent={mockAgent}
        isSelected={false}
        isRunning={true}
        runningJobId="job-1"
        runningJobTitle="Login Feature"
        onClick={onClick}
      />,
    );

    expect(screen.getByText("Login Feature")).toBeInTheDocument();
  });

  it("disabled card has muted appearance", () => {
    const { container } = render(
      <AgentCard
        agent={{ ...mockAgent, enabled: false }}
        isSelected={false}
        isRunning={false}
        onClick={onClick}
      />,
    );

    const card = container.querySelector("div[style*='opacity: 0.6']");
    expect(card).not.toBeNull();
  });

  it("running card's job title is a clickable link", () => {
    render(
      <AgentCard
        agent={mockAgent}
        isSelected={false}
        isRunning={true}
        runningJobId="job-1"
        runningJobTitle="Login Feature"
        onClick={onClick}
      />,
    );

    const link = screen.getByTestId("link");
    expect(link).toHaveAttribute("href", "/dashboard/jobs/job-1");
  });
});
