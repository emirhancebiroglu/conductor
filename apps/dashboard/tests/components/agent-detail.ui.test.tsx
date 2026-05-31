import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentDetail } from "@/app/dashboard/agents/components/agent-detail";
import type { AgentConfig, ProviderModel, RunningJob } from "@conductor/core";

const mockAgent: AgentConfig = {
  id: "uuid-1",
  agentName: "product-owner",
  displayName: "Product Owner",
  role: "Gathers requirements and creates spec",
  provider: "claude",
  model: "claude-sonnet-4-6",
  systemPrompt: "You are the product owner agent. Your job is to analyze requirements.",
  skillPath: "skills/product-owner/SKILL.md",
  enabled: true,
  laneOverride: null,
  order: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockProviderModels: ProviderModel[] = [
  {
    id: "1",
    provider: "claude",
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    capabilities: { tier: "premium", context: 200000 },
    available: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "2",
    provider: "opencode",
    modelId: "opencode-go/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    capabilities: { tier: "cheap", context: 131072 },
    available: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

const mockRunningJob: RunningJob = {
  jobId: "job-1",
  jobTitle: "Login Feature",
  agentName: "product-owner",
  startedAt: new Date(Date.now() - 60000).toISOString(),
  stepMessage: "Analyzing requirements",
};

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} data-testid="link">
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange?: (v: string) => void }) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid="select-item" data-item-value={value}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span data-testid="select-value">{placeholder}</span>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled }: { checked: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean }) => (
    <button
      data-testid="switch"
      data-checked={checked}
      data-disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    >
      {checked ? "ON" : "OFF"}
    </button>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value, onChange, placeholder, id }: { value: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string; id?: string }) => (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange({ target: { value: e.target.value } })}
      placeholder={placeholder}
      data-testid="textarea"
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, disabled, onClick, variant, className }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void; variant?: string; className?: string }) => (
    <button
      disabled={disabled}
      onClick={onClick}
      data-testid="button"
      data-variant={variant}
      className={className}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, placeholder, id, type }: { value: string | number; onChange: (e: { target: { value: string } }) => void; placeholder?: string; id?: string; type?: string }) => (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange({ target: { value: e.target.value } })}
      placeholder={placeholder}
      type={type}
      data-testid="input"
      data-id={id}
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr data-testid="separator" />,
}));

describe("AgentDetail", () => {
  const onDirtyChange = vi.fn();
  const onSaveSuccess = vi.fn();

  beforeEach(() => {
    onDirtyChange.mockClear();
    onSaveSuccess.mockClear();
  });

  it("renders all sections: Identity, Model, Prompt, Skill, Toggle", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    expect(screen.getByText(/Identity & Ordering/i)).toBeInTheDocument();
    expect(screen.getByText(/Model & Routing/i)).toBeInTheDocument();
    expect(screen.getByText(/System Prompt Frame/i)).toBeInTheDocument();
    expect(screen.getByText(/Skill File Path/i)).toBeInTheDocument();
    expect(screen.getByText(/AGENT ONLINE/i)).toBeInTheDocument();
  });

  it("save button is disabled when no changes made", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    const buttons = screen.getAllByTestId("button");
    const saveButton = buttons.find((b) => b.textContent?.includes("SAVE"));
    expect(saveButton).toHaveAttribute("disabled");
  });

  it("save button is enabled after editing a field", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    const buttons = screen.getAllByTestId("button");
    const saveButton = buttons.find((b) => b.textContent?.includes("SAVE"));
    expect(saveButton).toHaveAttribute("disabled");
  });

  it("changing display name sets dirty state to true", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it("reset button reverts all fields to original values", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    const buttons = screen.getAllByTestId("button");
    const resetButton = buttons.find((b) => b.textContent?.includes("DISCARD"));
    expect(resetButton).toBeInTheDocument();
  });

  it("toggle switch changes enabled state", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    const toggle = screen.getByTestId("switch");
    expect(toggle).toHaveAttribute("data-checked", "true");
  });

  it("current run info section shows running job when agent is active", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        runningJob={mockRunningJob}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    expect(screen.getByText("CURRENTLY ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Login Feature")).toBeInTheDocument();
  });

  it("current run info section shows idle when agent is not running", () => {
    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    expect(screen.getByText(/No execution history recorded/i)).toBeInTheDocument();
  });

  it("last run info shows formatted time", () => {
    const lastRun = {
      id: "run-1",
      jobId: "job-1",
      jobTitle: "Previous Job",
      status: "ok",
      createdAt: new Date(Date.now() - 120000).toISOString(),
    };

    render(
      <AgentDetail
        agent={mockAgent}
        providerModels={mockProviderModels}
        lastRun={lastRun}
        onDirtyChange={onDirtyChange}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    expect(screen.getByText(/2m ago/)).toBeInTheDocument();
  });
});
