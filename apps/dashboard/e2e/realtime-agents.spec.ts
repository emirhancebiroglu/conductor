import { test, expect, type Page } from "@playwright/test";
import { ALL_AGENTS, PROVIDERS } from "@/tests/fixtures/agent-configs";
import type { AgentConfig, ProviderModel, RunningJob } from "@conductor/core";

// ---------------------------------------------------------------------------
// Fixture overrides
// ---------------------------------------------------------------------------

interface FixtureOverrides {
  agents?: AgentConfig[];
  runningJobs?: RunningJob[];
  providerModels?: ProviderModel[];
}

const FLAT_MODELS = PROVIDERS.flatMap((p) => p.models);

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

async function mockAgentsApi(page: Page, overrides?: FixtureOverrides) {
  const agents = overrides?.agents ?? ALL_AGENTS;
  const runningJobs = overrides?.runningJobs ?? [];
  const models = overrides?.providerModels ?? FLAT_MODELS;

  await page.route("**/rest/v1/agent_config*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agents),
    });
  });

  await page.route("**/rest/v1/provider_models*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(models),
    });
  });

  await page.route("**/rest/v1/jobs*current_agent*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runningJobs),
    });
  });

  await page.route("**/rest/v1/runs*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route("**/rest/v1/jobs?select=id%2Ctitle*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  // Block Supabase Realtime WebSocket — we simulate events via page.evaluate()
  await page.route("**/realtime/**", async (route) => route.abort());
}

/**
 * Simulate a Realtime UPDATE event on a specific table.
 * This bypasses the aborted WebSocket and directly triggers the callback
 * registered in agents-client.tsx via the __test_realtime custom event.
 */
async function simulateRealtimeUpdate(
  page: Page,
  table: "agent_config" | "jobs" | "runs",
  newRow: Record<string, unknown>,
  oldRow?: Record<string, unknown>,
) {
  await page.evaluate(
    ({ table, newRow, oldRow }) => {
      const event = new CustomEvent("__test_realtime", { detail: { table, payload: { new: newRow, old: oldRow } } });
      window.dispatchEvent(event);
    },
    { table, newRow, oldRow },
  );
  // Allow React to process the state update
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Agent card selectors
// ---------------------------------------------------------------------------

function agentCardSelector(agentName: string) {
  // Agent cards contain the agent display name; use text-based locator
  return (page: Page) => page.locator(`text="${agentName}"`).first().locator("..").locator("..");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("real-time subscription simulation", () => {
  test.beforeEach(async ({ page }) => {
    // Collect console messages for error verification
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    // Attach to test info for afterEach verification
    (test as unknown as Record<string, unknown>).__consoleErrors = consoleErrors;
  });

  // -----------------------------------------------------------------------
  // 1. Agent config change reflected in real-time
  // -----------------------------------------------------------------------

  test("agent config change reflected in real-time", async ({ page }) => {
    const agents = ALL_AGENTS.map((a) => ({ ...a }));
    await mockAgentsApi(page, { agents });

    await page.goto("/dashboard/agents?__fixture=agents_default");
    await page.waitForSelector("h1:text('Agents')");

    // Verify initial state: backend-dev is enabled
    const backendCard = page.locator("text='Backend Developer'").first();
    await expect(backendCard).toBeVisible();

    // Simulate Realtime UPDATE: disable backend-dev
    const now = new Date().toISOString();
    await simulateRealtimeUpdate(page, "agent_config", {
      id: agents.find((a) => a.agentName === "backend-dev")!.id,
      agent_name: "backend-dev",
      display_name: "Backend Developer",
      role: "Implements backend changes",
      provider: "claude",
      model: "claude-sonnet-4-6",
      system_prompt: "You are a Backend Developer...",
      skill_path: null,
      enabled: false,
      lane_override: null,
      order: 4,
      created_at: now,
      updated_at: now,
    });

    // Verify the card now shows disabled state (opacity reduced)
    // AgentCard renders opacity: agent.enabled ? 1 : 0.6
    // The AgentCard div is the grandparent of the display name span
    const card = page.locator("text='Backend Developer'").first().locator("..").locator("..");
    await expect(card).toHaveCSS("opacity", "0.6");
  });

  // -----------------------------------------------------------------------
  // 2. Job starts processing — agent shows running
  // -----------------------------------------------------------------------

  test("job starts processing — agent shows running", async ({ page }) => {
    await mockAgentsApi(page);

    await page.goto("/dashboard/agents?__fixture=agents_default");
    await page.waitForSelector("h1:text('Agents')");

    // Verify no running indicator initially
    const runningCount = page.getByText("Running").locator("..");
    await expect(runningCount).toContainText("0");

    // Simulate Realtime UPDATE on jobs: a job starts running with backend-dev
    const jobId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const now = new Date().toISOString();
    await simulateRealtimeUpdate(page, "jobs", {
      id: jobId,
      title: "Add authentication",
      current_agent: "backend-dev",
      started_at: now,
      current_step_message: "Implementing backend changes",
      status: "running",
    }, {
      id: jobId,
      title: "Add authentication",
      current_agent: null,
      started_at: null,
      current_step_message: null,
      status: "queued",
    });

    // Verify backend-dev card now shows running indicator (amber pulse dot)
    const backendCard = page.locator("text='Backend Developer'").first().locator("..").locator("..");
    // The running indicator is an amber pulse dot in the "Working on:" link
    const pulseDot = backendCard.locator(".bg-amber-500").first();
    await expect(pulseDot).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // 3. Job finishes processing — agent returns to idle
  // -----------------------------------------------------------------------

  test("job finishes processing — agent returns to idle", async ({ page }) => {
    // Use fixture that has a running job for backend-dev
    await mockAgentsApi(page, { runningJobs: [] });

    await page.goto("/dashboard/agents?__fixture=agents_with_running");
    await page.waitForSelector("h1:text('Agents')");

    // Verify backend-dev shows running initially
    const backendCard = page.locator("text='Backend Developer'").first().locator("..").locator("..");
    const pulseDot = backendCard.locator(".bg-amber-500").first();
    await expect(pulseDot).toBeVisible();

    // Simulate Realtime UPDATE on jobs: job finishes (current_agent goes to null)
    const now = new Date().toISOString();
    await simulateRealtimeUpdate(page, "jobs", {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "Add user authentication",
      current_agent: null,
      started_at: null,
      current_step_message: null,
      status: "pr_opened",
    }, {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "Add user authentication",
      current_agent: "backend-dev",
      started_at: now,
      current_step_message: "Implementing backend changes",
      status: "running",
    });

    // Verify amber pulse dot is gone
    await expect(pulseDot).not.toBeVisible();
  });

  // -----------------------------------------------------------------------
  // 4. Multiple real-time updates don't cause render thrash
  // -----------------------------------------------------------------------

  test("multiple real-time updates don't cause render thrash", async ({ page }) => {
    const agents = ALL_AGENTS.map((a) => ({ ...a }));
    await mockAgentsApi(page, { agents });

    await page.goto("/dashboard/agents?__fixture=agents_default");
    await page.waitForSelector("h1:text('Agents')");

    // Collect console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    // Send 10 rapid updates to agent_config for product-owner
    const now = new Date().toISOString();
    for (let i = 0; i < 10; i++) {
      await simulateRealtimeUpdate(page, "agent_config", {
        id: agents.find((a) => a.agentName === "product-owner")!.id,
        agent_name: "product-owner",
        display_name: `Product Owner v${i + 1}`,
        role: "Gathers requirements",
        provider: "claude",
        model: "claude-sonnet-4-6",
        system_prompt: "You are a Product Owner...",
        skill_path: null,
        enabled: true,
        lane_override: null,
        order: 1,
        created_at: now,
        updated_at: now,
      });
    }

    // Wait for all updates to process
    await page.waitForTimeout(500);

    // Verify no console errors
    expect(errors).toHaveLength(0);

    // Verify final state: last update should be applied (display name = "Product Owner v10")
    const displayName = page.locator("text='Product Owner v10'");
    await expect(displayName).toBeVisible();

    // Verify page didn't crash
    await expect(page.locator("h1:text('Agents')")).toBeVisible();
  });
});
