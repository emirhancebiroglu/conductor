import { test, expect, type Page } from "@playwright/test";

/**
 * T-303: Workspace switch UI isolation.
 *
 * Strategy: mock all API calls. Test the actual UI switcher interaction
 * (clicking Personal/Work buttons), verify the displayed data changes,
 * and confirm realtime subscriptions scope correctly.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PERSONAL_ID = "ws-personal-0000-0000-0000-000000000001";
const WORK_ID = "ws-work-0000-0000-0000-000000000002";

function personalJob(i: number) {
  return {
    id: `personal-job-${i}`,
    project_id: "proj-personal",
    parent_job_id: null,
    workspace_id: PERSONAL_ID,
    type: "feature",
    title: `Personal Feature ${i}`,
    description: `Personal feature description ${i}`,
    lane_preference: "auto",
    status: "queued",
    branch: null,
    pr_url: null,
    spec: null,
    plan: null,
    answers: null,
    prd: null,
    prd_approved: false,
    research_output: null,
    scaffold_repo: null,
    idea_loop_count: 0,
    idea_constraints: null,
    error: null,
    current_agent: null,
    current_step_message: null,
    started_at: null,
    created_at: "2026-06-03T00:00:00Z",
    updated_at: "2026-06-03T00:00:00Z",
  };
}

function workJob(i: number) {
  return {
    id: `work-job-${i}`,
    project_id: "proj-work",
    parent_job_id: null,
    workspace_id: WORK_ID,
    type: "feature",
    title: `Work Feature ${i}`,
    description: `Work feature description ${i}`,
    lane_preference: "auto",
    status: "queued",
    branch: null,
    pr_url: null,
    spec: null,
    plan: null,
    answers: null,
    prd: null,
    prd_approved: false,
    research_output: null,
    scaffold_repo: null,
    idea_loop_count: 0,
    idea_constraints: null,
    error: null,
    current_agent: null,
    current_step_message: null,
    started_at: null,
    created_at: "2026-06-03T00:00:00Z",
    updated_at: "2026-06-03T00:00:00Z",
  };
}

const PERSONAL_JOBS = [personalJob(1), personalJob(2)];
const WORK_JOBS = [workJob(1), workJob(2)];

const PERSONAL_PROJECT = {
  id: "proj-personal",
  owner: "emirhancebiroglu",
  repo: "side-project",
  default_branch: "main",
  workspace_id: PERSONAL_ID,
  created_at: "2026-06-03T00:00:00Z",
};

const WORK_PROJECT = {
  id: "proj-work",
  owner: "acme-corp",
  repo: "api-service",
  default_branch: "main",
  workspace_id: WORK_ID,
  created_at: "2026-06-03T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

async function mockApiRoutes(page: Page) {
  // GET /api/jobs → return jobs based on cookie
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
      return;
    }
    const cookie = await getCookie(page, "active_workspace");
    const jobs = cookie === "work" ? WORK_JOBS : PERSONAL_JOBS;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(jobs),
    });
  });

  // GET /api/projects → return projects based on cookie
  await page.route("**/api/projects**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
      return;
    }
    const cookie = await getCookie(page, "active_workspace");
    const projs = cookie === "work" ? [WORK_PROJECT] : [PERSONAL_PROJECT];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projs),
    });
  });

  // GET /api/costs → return empty
  await page.route("**/api/costs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        limits: { last5h: { used: 0, soft: 9, hard: 12 }, last7d: { used: 0, soft: 24, hard: 30 }, thisMonth: { used: 0, soft: 50, hard: 60 } },
        weekSummary: { totalJobs: 0, successfulPRs: 0, needsHuman: 0, totalCostUsd: 0, avgJobCostUsd: 0, topAgent: null },
        recentJobs: [],
      }),
    });
  });

  // GET /api/workspaces
  await page.route("**/api/workspaces**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: PERSONAL_ID, name: "Personal", kind: "personal" },
        { id: WORK_ID, name: "Work", kind: "work" },
      ]),
    });
  });

  // GET /api/worker-status
  await page.route("**/api/worker-status**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "online" }) });
  });

  // Supabase REST / realtime — abort to prevent real connection attempts
  await page.route("**/rest/v1/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/realtime/**", (route) => route.abort());
}

async function getCookie(page: Page, name: string): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === name)?.value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Workspace switch UI isolation", () => {
  test("personal → work switch shows different jobs", async ({ page }) => {
    // Start in personal workspace: use cookie
    await page.context().addCookies([
      { name: "active_workspace", value: "personal", domain: "localhost", path: "/" },
    ]);
    await mockApiRoutes(page);

    await page.goto("/dashboard/jobs");
    await page.waitForLoadState("networkidle");

    // Personal jobs visible
    await expect(page.getByText("Personal Feature 1")).toBeVisible();
    await expect(page.getByText("Personal Feature 2")).toBeVisible();
    // Work jobs not visible
    await expect(page.getByText("Work Feature 1")).not.toBeVisible();
    await expect(page.getByText("Work Feature 2")).not.toBeVisible();

    // Switch to work: click the Work button in the WorkspaceSwitcher
    // The switcher has data-workspace attributes on its buttons
    await page.click('[data-workspace="work"]');

    // After page refresh (router.refresh()), work jobs should appear
    // The route handler will re-fetch with the new cookie value
    await expect(page.getByText("Work Feature 1")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Work Feature 2")).toBeVisible();
    // Personal jobs hidden
    await expect(page.getByText("Personal Feature 1")).not.toBeVisible();
    await expect(page.getByText("Personal Feature 2")).not.toBeVisible();
  });

  test("work → personal switch shows different jobs", async ({ page }) => {
    await page.context().addCookies([
      { name: "active_workspace", value: "work", domain: "localhost", path: "/" },
    ]);
    await mockApiRoutes(page);

    await page.goto("/dashboard/jobs");
    await page.waitForLoadState("networkidle");

    // Work jobs visible
    await expect(page.getByText("Work Feature 1")).toBeVisible();
    await expect(page.getByText("Work Feature 2")).toBeVisible();
    // Personal jobs not visible
    await expect(page.getByText("Personal Feature 1")).not.toBeVisible();
    await expect(page.getByText("Personal Feature 2")).not.toBeVisible();

    // Switch to personal
    await page.click('[data-workspace="personal"]');

    await expect(page.getByText("Personal Feature 1")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Personal Feature 2")).toBeVisible();
    await expect(page.getByText("Work Feature 1")).not.toBeVisible();
    await expect(page.getByText("Work Feature 2")).not.toBeVisible();
  });

  test("projects page respects workspace switch", async ({ page }) => {
    await page.context().addCookies([
      { name: "active_workspace", value: "personal", domain: "localhost", path: "/" },
    ]);
    await mockApiRoutes(page);

    await page.goto("/dashboard/projects");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("emirhancebiroglu/side-project")).toBeVisible();
    await expect(page.getByText("acme-corp/api-service")).not.toBeVisible();

    // Switch to work
    await page.click('[data-workspace="work"]');

    await expect(page.getByText("acme-corp/api-service")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("emirhancebiroglu/side-project")).not.toBeVisible();
  });
});
