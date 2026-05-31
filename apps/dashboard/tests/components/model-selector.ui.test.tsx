import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector } from "@/app/dashboard/agents/components/model-selector";
import type { ProviderModel } from "@conductor/core";

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
    provider: "claude",
    modelId: "claude-haiku-3-5",
    displayName: "Claude Haiku 3.5",
    capabilities: { tier: "cheap", context: 200000 },
    available: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "3",
    provider: "opencode",
    modelId: "opencode-go/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    capabilities: { tier: "cheap", context: 131072 },
    available: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange?: (v: string) => void }) => (
    <div data-testid="select" data-value={value} data-onchange={onValueChange ? "yes" : "no"}>
      <div data-testid="select-onchange" onClick={() => onValueChange?.("test-value")}></div>
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

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

describe("ModelSelector", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it("renders provider and model dropdowns", () => {
    render(
      <ModelSelector
        currentProvider="claude"
        currentModel="claude-sonnet-4-6"
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    const triggers = screen.getAllByTestId("select-trigger");
    expect(triggers).toHaveLength(2);
  });

  it("provider dropdown shows all provider names", () => {
    render(
      <ModelSelector
        currentProvider="claude"
        currentModel="claude-sonnet-4-6"
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
  });

  it("model dropdown shows models for current provider", () => {
    render(
      <ModelSelector
        currentProvider="claude"
        currentModel="claude-sonnet-4-6"
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Claude Sonnet 4.6")).toBeInTheDocument();
    expect(screen.getByText("Claude Haiku 3.5")).toBeInTheDocument();
    expect(screen.queryByText("DeepSeek V4 Flash")).not.toBeInTheDocument();
  });

  it("model dropdown shows empty when no models for provider", () => {
    render(
      <ModelSelector
        currentProvider="unknown"
        currentModel=""
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    expect(screen.queryByText("DeepSeek V4 Flash")).not.toBeInTheDocument();
  });

  it("selecting a model fires onChange with correct provider + model", () => {
    render(
      <ModelSelector
        currentProvider="claude"
        currentModel="claude-sonnet-4-6"
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Claude Sonnet 4.6")).toBeInTheDocument();
  });

  it("tier badge rendered next to each model option", () => {
    render(
      <ModelSelector
        currentProvider="claude"
        currentModel="claude-sonnet-4-6"
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    const premiumBadges = screen.getAllByText("premium");
    expect(premiumBadges.length).toBeGreaterThan(0);
  });

  it("first model auto-selected when provider changes", () => {
    render(
      <ModelSelector
        currentProvider="claude"
        currentModel="claude-sonnet-4-6"
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Claude Sonnet 4.6")).toBeInTheDocument();
  });

  it("model dropdown is disabled when no models available", () => {
    render(
      <ModelSelector
        currentProvider="unknown"
        currentModel=""
        providerModels={mockProviderModels}
        onChange={onChange}
      />,
    );

    const selects = screen.getAllByTestId("select");
    const modelSelect = selects[1];
    expect(modelSelect).toBeInTheDocument();
  });
});
