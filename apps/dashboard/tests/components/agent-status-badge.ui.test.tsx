import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentStatusBadge } from "@/app/dashboard/agents/components/agent-status-badge";

describe("AgentStatusBadge", () => {
  it("renders amber dot with pulse animation when status=running", () => {
    const { container } = render(<AgentStatusBadge status="running" />);
    const dot = container.querySelector("span[style*='animation']");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("style")).toContain("pulse");
    expect(dot?.getAttribute("style")).toContain("var(--amber)");
  });

  it("renders green dot without animation when status=idle", () => {
    render(<AgentStatusBadge status="idle" />);
    expect(screen.getByText("ONLINE")).toBeInTheDocument();
  });

  it("renders red dot when status=error", () => {
    render(<AgentStatusBadge status="error" />);
    expect(screen.getByText("ERROR")).toBeInTheDocument();
  });

  it("renders gray dot with dashed border when status=disabled", () => {
    const { container } = render(<AgentStatusBadge status="disabled" />);
    const dot = container.querySelector("span.rounded-full");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("style")).toContain("dashed");
    expect(dot?.getAttribute("style")).toContain("transparent");
  });

  it("displays RUNNING label for running status", () => {
    render(<AgentStatusBadge status="running" />);
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
  });

  it("displays ONLINE label for idle status", () => {
    render(<AgentStatusBadge status="idle" />);
    expect(screen.getByText("ONLINE")).toBeInTheDocument();
  });

  it("displays ERROR label for error status", () => {
    render(<AgentStatusBadge status="error" />);
    expect(screen.getByText("ERROR")).toBeInTheDocument();
  });

  it("displays OFFLINE label for disabled status", () => {
    render(<AgentStatusBadge status="disabled" />);
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });

  it("renders job title text when running with jobTitle", () => {
    render(<AgentStatusBadge status="running" jobTitle="Login Feature" />);
    expect(screen.getByText("Login Feature")).toBeInTheDocument();
  });

  it("renders link when running with jobLink", () => {
    render(
      <AgentStatusBadge
        status="running"
        jobTitle="Login Feature"
        jobLink="/dashboard/jobs/123"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/dashboard/jobs/123");
  });

  it("renders text only (no link) when running without jobLink", () => {
    render(<AgentStatusBadge status="running" jobTitle="Login Feature" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Login Feature")).toBeInTheDocument();
  });

  it("does not render link for idle status even with jobTitle", () => {
    render(
      <AgentStatusBadge status="idle" jobTitle="Some Job" jobLink="/jobs/1" />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
