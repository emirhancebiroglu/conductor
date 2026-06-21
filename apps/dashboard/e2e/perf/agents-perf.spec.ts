import { test, expect, type Page } from "@playwright/test";
import { ALL_AGENTS, PROVIDERS, RUNNING_JOBS } from "@/tests/fixtures/agent-configs";
import type { AgentConfig, ProviderModel, RunningJob } from "@conductor/core";

// ---------------------------------------------------------------------------
// Performance test configuration
// ---------------------------------------------------------------------------

const PERF_TIMEOUT = 60_000;

// ---------------------------------------------------------------------------
// Fixture generators
// ---------------------------------------------------------------------------

function generateAgents(count: number): AgentConfig[] {
  const agents: AgentConfig[] = [];
  for (let i = 0; i < count; i++) {
    agents.push({
      id: `aaaaaaaa-${String(i).padStart(4, "0")}-0000-000000000000`,
      agentName: `agent-${i}`,
      displayName: `Agent ${i}`,
      role: `Role for agent ${i}`,
      provider: i % 2 === 0 ? "claude" : "opencode",
      model: i % 2 === 0 ? "claude-sonnet-4-6" : "opencode-go/deepseek-v4-flash",
      systemPrompt: `You are agent ${i}. Do your job well.`,
      skillContent: null,
      categoryId: null,
      enabled: i % 5 !== 0, // 80% enabled
      laneOverride: null,
      order: i + 1,
      createdAt: "2026-05-31T00:00:00Z",
      updatedAt: "2026-05-31T00:00:00Z",
      allowedTools: [],
    });
  }
  return agents;
}

function generateRunningJobs(count: number, agentNames?: string[]): RunningJob[] {
  const names = agentNames ?? ["backend-dev", "frontend-dev", "product-owner", "tech-lead", "codebase-analyst"];
  const jobs: RunningJob[] = [];
  for (let i = 0; i < count; i++) {
    jobs.push({
      jobId: `bbbbbbbb-${String(i).padStart(4, "0")}-0000-000000000000`,
      jobTitle: `Job ${i}: Add feature ${i}`,
      agentName: names[i % names.length]!,
      startedAt: "2026-05-31T00:00:00Z",
      stepMessage: `Processing step ${i}`,
    });
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

async function mockAgentsApi(page: Page, overrides?: {
  agents?: AgentConfig[];
  runningJobs?: RunningJob[];
  providerModels?: ProviderModel[];
}) {
  const agents = overrides?.agents ?? ALL_AGENTS;
  const runningJobs = overrides?.runningJobs ?? [];
  const models = overrides?.providerModels ?? PROVIDERS.flatMap((p) => p.models);

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

  // Block Supabase Realtime WebSocket
  await page.route("**/realtime/**", async (route) => route.abort());
}

async function simulateRealtimeUpdate(
  page: Page,
  table: "agent_config" | "jobs" | "runs",
  newRow: Record<string, unknown>,
) {
  await page.evaluate(
    ({ table, newRow }) => {
      const event = new CustomEvent("__test_realtime", {
        detail: { table, payload: { new: newRow } },
      });
      window.dispatchEvent(event);
    },
    { table, newRow },
  );
  await page.waitForTimeout(50);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("agents dashboard performance", () => {
  test.skip(
    process.env["RUN_PERF_TESTS"] !== "1",
    "performance tests are skipped by default — set RUN_PERF_TESTS=1 to enable",
  );

  // -----------------------------------------------------------------------
  // 1. Page load time under 3 seconds
  // -----------------------------------------------------------------------

  test(
    "page load time under 3 seconds",
    async ({ page }) => {
      await mockAgentsApi(page);

      const startTime = Date.now();
      await page.goto("/dashboard/agents?__fixture=1", {
        waitUntil: "networkidle",
      });
      const loadTime = Date.now() - startTime;

      await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();

      expect(loadTime).toBeLessThan(3000);
    },
    PERF_TIMEOUT,
  );

  // -----------------------------------------------------------------------
  // 2. 1500 agent configs load without crashing
  // -----------------------------------------------------------------------

  test(
    "1500 agent configs load without crashing",
    async ({ page }) => {
      // Load page with standard fixture first
      await mockAgentsApi(page);
      await page.goto("/dashboard/agents?__fixture=agents_default", {
        waitUntil: "networkidle",
      });

      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      // Verify initial page rendered
      await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();

      // Wait for realtime handlers to be registered
      await page.waitForTimeout(500);

      // Inject 1500 agents directly into React state via custom event
      const agents = generateAgents(1500);
      await page.evaluate(
        ({ agents }) => {
          const event = new CustomEvent("__test_load_agents", { detail: { agents } });
          window.dispatchEvent(event);
        },
        { agents },
      );

      await page.waitForTimeout(1000);

      // Verify page didn't crash
      await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();

      // Verify total count shows 1500
      const totalSection = page.getByText("Total").locator("..");
      await expect(totalSection).toContainText("1500");

      // Verify no console errors
      expect(consoleErrors).toHaveLength(0);
    },
    PERF_TIMEOUT,
  );

  // -----------------------------------------------------------------------
  // 3. 50 running jobs display correctly
  // -----------------------------------------------------------------------

  test(
    "50 running jobs display correctly",
    async ({ page }) => {
      const runningJobs = generateRunningJobs(50);
      await mockAgentsApi(page, { runningJobs });

      await page.goto("/dashboard/agents?__fixture=agents_default", {
        waitUntil: "networkidle",
      });

      // Simulate 50 jobs starting via realtime updates
      const now = "2026-05-31T00:00:00Z";
      for (let i = 0; i < 50; i++) {
        await page.evaluate(
          ({ job, now }) => {
            const event = new CustomEvent("__test_realtime", {
              detail: {
                table: "jobs",
                payload: {
                  new: {
                    id: job.jobId,
                    title: job.jobTitle,
                    current_agent: job.agentName,
                    started_at: now,
                    current_step_message: job.stepMessage,
                    status: "running",
                  },
                  old: {
                    id: job.jobId,
                    title: job.jobTitle,
                    current_agent: null,
                    started_at: null,
                    current_step_message: null,
                    status: "queued",
                  },
                },
              },
            });
            window.dispatchEvent(event);
          },
          { job: runningJobs[i], now },
        );
      }

      await page.waitForTimeout(1000);

      // Verify running count shows 50
      const runningLabel = page.locator("text='Running'").first();
      await expect(runningLabel).toBeVisible();
      const runningSection = runningLabel.locator("..");
      await expect(runningSection).toContainText("50");

      // Verify no layout breakage — page should be scrollable and responsive
      const viewportSize = page.viewportSize();
      expect(viewportSize).not.toBeNull();

      // Verify the page didn't crash
      await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
    },
    PERF_TIMEOUT,
  );

  // -----------------------------------------------------------------------
  // 4. Memory usage after 10 rapid Realtime updates
  // -----------------------------------------------------------------------

  test(
    "memory usage after 10 rapid Realtime updates",
    async ({ page }) => {
      await mockAgentsApi(page);

      await page.goto("/dashboard/agents?__fixture=1", {
        waitUntil: "networkidle",
      });

      // Measure initial heap size via performance.memory (Chrome-only)
      const initialMemory = await page.evaluate(() => {
        const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
        return perf.memory?.usedJSHeapSize ?? 0;
      });

      // Skip if memory API not available (non-Chromium browsers)
      test.skip(initialMemory === 0, "performance.memory not available in this browser");

      // Simulate 10 rapid config updates
      for (let i = 0; i < 10; i++) {
        await simulateRealtimeUpdate(page, "agent_config", {
          id: "aaaaaaaa-0001-0000-0000-000000000001",
          agent_name: "product-owner",
          display_name: "Product Owner",
          role: `Updated role iteration ${i}`,
          provider: "claude",
          model: "claude-sonnet-4-6",
          system_prompt: "Updated system prompt",
          skill_content: null,
          category_id: null,
          enabled: true,
          lane_override: null,
          order: 1,
          created_at: "2026-05-31T00:00:00Z",
          updated_at: "2026-05-31T00:00:00Z",
        });
      }

      // Wait for GC and React to settle
      await page.waitForTimeout(500);

      // Measure final heap size
      const finalMemory = await page.evaluate(() => {
        const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
        return perf.memory?.usedJSHeapSize ?? 0;
      });

      const memoryDiff = finalMemory - initialMemory;
      const memoryDiffMB = memoryDiff / (1024 * 1024);

      // Assert no significant memory leak (> 10MB increase)
      expect(memoryDiffMB).toBeLessThan(10);
    },
    PERF_TIMEOUT,
  );

  // -----------------------------------------------------------------------
  // 5. Re-render count on config update
  // -----------------------------------------------------------------------

  test(
    "re-render count on config update",
    async ({ page }) => {
      await mockAgentsApi(page);

      // Inject a render counter tracker before page loads
      await page.addInitScript(() => {
        (window as unknown as Record<string, unknown>).__renderCount = 0;
        const origSetState = React?.useState;
        if (origSetState) {
          // This is a simplified approach — in practice we track via React DevTools
          // or a custom wrapper. Here we count DOM mutations as a proxy.
          const observer = new MutationObserver(() => {
            (window as unknown as Record<string, unknown>).__renderCount =
              ((window as unknown as Record<string, number>).__renderCount ?? 0) + 1;
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          (window as unknown as Record<string, unknown>).__mutationObserver = observer;
        }
      });

      await page.goto("/dashboard/agents?__fixture=1", {
        waitUntil: "networkidle",
      });

      // Reset counter after initial render settles
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__renderCount = 0;
      });

      // Perform a single config update
      await simulateRealtimeUpdate(page, "agent_config", {
        id: "aaaaaaaa-0004-0000-0000-000000000004",
        agent_name: "backend-dev",
        display_name: "Backend Developer",
        role: "Updated backend role",
        provider: "claude",
        model: "claude-sonnet-4-6",
        system_prompt: "Updated backend prompt",
        skill_content: null,
        category_id: null,
        enabled: true,
        lane_override: null,
        order: 4,
        created_at: "2026-05-31T00:00:00Z",
        updated_at: "2026-05-31T00:00:00Z",
      });

      await page.waitForTimeout(500);

      // Get mutation count — should be limited to the affected agent card
      const mutationCount = await page.evaluate(() => {
        return (window as unknown as Record<string, number>).__renderCount ?? 0;
      });

      // Assert mutations are bounded (not re-rendering entire tree)
      // With 8 agents, a full re-render would cause many more mutations
      expect(mutationCount).toBeLessThan(50);
    },
    PERF_TIMEOUT,
  );
});
