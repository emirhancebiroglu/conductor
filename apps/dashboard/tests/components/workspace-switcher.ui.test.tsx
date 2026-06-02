import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockCookieKind = "personal";

vi.mock("@/lib/workspace", () => ({
  WORKSPACE_COOKIE: "active_workspace",
  getWorkspaceCookie: () => mockCookieKind as "work" | "personal",
  setWorkspaceCookie: vi.fn((kind: string) => {
    mockCookieKind = kind;
  }),
}));

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPersonalBtn() {
  return screen.getByRole("button", { name: /personal/i });
}

function getWorkBtn() {
  return screen.getByRole("button", { name: /work/i });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkspaceSwitcher", () => {
  const { setWorkspaceCookie } = vi.hoisted(() => ({ setWorkspaceCookie: vi.fn() }));

  beforeEach(() => {
    mockCookieKind = "personal";
    mockRefresh.mockClear();
    vi.clearAllMocks();
  });

  it("renders both workspace buttons", () => {
    render(<WorkspaceSwitcher />);
    expect(getPersonalBtn()).toBeInTheDocument();
    expect(getWorkBtn()).toBeInTheDocument();
  });

  it("has group role with accessible label", () => {
    render(<WorkspaceSwitcher />);
    expect(screen.getByRole("group", { name: /workspace/i })).toBeInTheDocument();
  });

  it("personal button is pressed by default (from cookie)", () => {
    mockCookieKind = "personal";
    render(<WorkspaceSwitcher />);
    expect(getPersonalBtn()).toHaveAttribute("aria-pressed", "true");
    expect(getWorkBtn()).toHaveAttribute("aria-pressed", "false");
  });

  it("work button pressed when cookie is work", () => {
    mockCookieKind = "work";
    render(<WorkspaceSwitcher />);
    expect(getWorkBtn()).toHaveAttribute("aria-pressed", "true");
    expect(getPersonalBtn()).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking work calls setWorkspaceCookie('work') and router.refresh()", async () => {
    const { setWorkspaceCookie } = await import("@/lib/workspace");
    mockCookieKind = "personal";
    render(<WorkspaceSwitcher />);

    fireEvent.click(getWorkBtn());

    expect(setWorkspaceCookie).toHaveBeenCalledWith("work");
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("clicking active workspace does not re-set cookie or refresh", async () => {
    const { setWorkspaceCookie } = await import("@/lib/workspace");
    mockCookieKind = "personal";
    render(<WorkspaceSwitcher />);

    fireEvent.click(getPersonalBtn());

    expect(setWorkspaceCookie).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("active button has aria-pressed=true, inactive has aria-pressed=false", () => {
    mockCookieKind = "work";
    render(<WorkspaceSwitcher />);

    expect(getWorkBtn()).toHaveAttribute("aria-pressed", "true");
    expect(getPersonalBtn()).toHaveAttribute("aria-pressed", "false");
  });

  it("active button has data-active=true attribute", () => {
    mockCookieKind = "personal";
    render(<WorkspaceSwitcher />);

    expect(getPersonalBtn()).toHaveAttribute("data-active", "true");
    expect(getWorkBtn()).toHaveAttribute("data-active", "false");
  });

  it("buttons are keyboard accessible (focusable)", () => {
    render(<WorkspaceSwitcher />);
    const workBtn = getWorkBtn();
    workBtn.focus();
    expect(document.activeElement).toBe(workBtn);
  });
});
