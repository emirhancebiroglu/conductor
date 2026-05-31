import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PromptEditor } from "@/app/dashboard/agents/components/prompt-editor";

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({
    value,
    onChange,
    placeholder,
    id,
  }: {
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    placeholder?: string;
    id?: string;
  }) => (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange({ target: { value: e.target.value } })}
      placeholder={placeholder}
      data-testid="prompt-textarea"
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

describe("PromptEditor", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it("renders textarea with correct initial value", () => {
    render(
      <PromptEditor
        value="Hello World"
        onChange={onChange}
      />,
    );

    const textarea = screen.getByTestId("prompt-textarea");
    expect(textarea).toHaveValue("Hello World");
  });

  it("typing updates the value", () => {
    render(
      <PromptEditor
        value=""
        onChange={onChange}
      />,
    );

    const textarea = screen.getByTestId("prompt-textarea");
    expect(textarea).toHaveValue("");
  });

  it("character count displays correct number", () => {
    render(
      <PromptEditor
        value="12345"
        onChange={onChange}
      />,
    );

    expect(screen.getByText("5 chars")).toBeInTheDocument();
  });

  it("warning shown when text < 50 characters", () => {
    render(
      <PromptEditor
        value="Short text"
        onChange={onChange}
      />,
    );

    expect(screen.getByText(/Warning: System prompt is very short/)).toBeInTheDocument();
  });

  it("warning hidden when text >= 50 characters", () => {
    render(
      <PromptEditor
        value="This is a longer text that has more than fifty characters in it for testing purposes."
        onChange={onChange}
      />,
    );

    expect(screen.queryByText(/Warning: System prompt is very short/)).not.toBeInTheDocument();
  });

  it("placeholder text visible when value is empty", () => {
    render(
      <PromptEditor
        value=""
        onChange={onChange}
        placeholder="Enter your prompt here"
      />,
    );

    const textarea = screen.getByTestId("prompt-textarea");
    expect(textarea).toHaveAttribute("placeholder", "Enter your prompt here");
  });

  it("textarea has monospace font style", () => {
    render(
      <PromptEditor
        value="Test"
        onChange={onChange}
      />,
    );

    const textarea = screen.getByTestId("prompt-textarea");
    expect(textarea).toBeInTheDocument();
  });

  it("onChange is provided to textarea", () => {
    render(
      <PromptEditor
        value="Initial"
        onChange={onChange}
      />,
    );

    const textarea = screen.getByTestId("prompt-textarea");
    expect(textarea).toBeInTheDocument();
  });
});
