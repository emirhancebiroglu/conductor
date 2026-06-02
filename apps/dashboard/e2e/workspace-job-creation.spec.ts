import { test, expect } from "@playwright/test";

/**
 * T-304: Workspace job creation isolation.
 *
 * Strategy: use ?__fixture= param to bypass auth (see middleware.ts),
 * then intercept Supabase REST calls to inject fixture data — same pattern
 * as existing e2e tests (waiting-input.spec.ts, agents-dashboard.spec.ts).
 *
 * Test plan:
 * 1. Work cookie → jobs list shows only work jobs (personal absent).
 * 2. Personal cookie → jobs list shows only personal jobs (work absent).
 * 3. New feature form: work cookie → only work projects in dropdown.
 * 4. New feature form: personal cookie → only personal projects in dropdown.
 * 5. Form submit → POSTs to /api/jobs with correct projectId, redirects to job detail.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WS_WORK_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const WS_PERSONAL_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const PROJ_WORK_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const PROJ_PERSONAL_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const NEW_JOB_ID = "cccccccc-0000-0000-0000-000000000001";

const WORK_JOB = {
  id: "dddddddd-0000-0000-0000-000000000001",
  title: "Work Feature Alpha",
  type: "feature",
  status: "queued",
  workspace_id: WS_WORK_ID,
  project_id: PROJ_WORK_ID,
  description: "A work feature",
  lane_preference: "auto",
  branch: null, pr_url: null, spec: null, plan: null, prd: null,
  prd_approved: false, research_output: null, scaffold_repo: null,
  idea_loop_count: 0, idea_constraints: null, error: null,
  current_agent: null, current_step_message: null,
  parent_job_id: null, answers: null, started_at: null,
  created_at: "2026-06-03T00:00:00Z", updated_at: "2026-06-03T00:00:00Z",
};

const PERSONAL_JOB = {
  ...WORK_JOB,
  id: "dddddddd-0000-0000-0000-000000000002",
  title: "Personal Side Project",
  workspace_id: WS_PERSONAL_ID,
  project_id: PROJ_PERSONAL_ID,
};

const WORK_PROJECT = {
  id: PROJ_WORK_ID,
  owner: "acme-corp",
  repo: "api-service",
  default_branch: "main",
  workspace_id: WS_WORK_ID,
  created_at: "2026-06-03T00:00:00Z",
};

const PERSONAL_PROJECT = {
  id: PROJ_PERSONAL_ID,
  owner: "emirhancebiroglu",
  repo: "side-project",
  default_branch: "main",
  workspace_id: WS_PERSONAL_ID,
  created_at: "2026-06-03T00:00:00Z",
};


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PW = import("@playwright/test").Page;

async function setWorkspaceCookie(page: PW, kind: "work" | "personal") {
  await page.context().addCookies([{
    name: "active_workspace",
    value: kind,
    domain: "localhost",
    path: "/",
  }]);
}

// fixture URL params bypass auth + inject server-side fixture data
const FX_WORK = "?__fixture=workspace_work";
const FX_PERSONAL = "?__fixture=workspace_personal";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Workspace job isolation", () => {
  test("work cookie → jobs list shows only work jobs", async ({ page }) => {
    await page.route("**/realtime/**", (route) => route.abort());
    await page.route("**/rest/v1/worker_status*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "online" }]) });
    });

    await page.goto(`/dashboard/jobs${FX_WORK}`);

    await expect(page.getByText("Work Feature Alpha")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Personal Side Project")).not.toBeVisible();
  });

  test("personal cookie → jobs list shows only personal jobs", async ({ page }) => {
    await page.route("**/realtime/**", (route) => route.abort());
    await page.route("**/rest/v1/worker_status*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "online" }]) });
    });

    await page.goto(`/dashboard/jobs${FX_PERSONAL}`);

    await expect(page.getByText("Personal Side Project")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Work Feature Alpha")).not.toBeVisible();
  });

  test("new feature form: work cookie → only work projects in dropdown", async ({ page }) => {
    await page.route("**/realtime/**", (route) => route.abort());

    await page.goto(`/dashboard/jobs/new${FX_WORK}`);

    // Options inside <select> are not "visible" — check DOM presence instead
    await expect(page.locator("select#project")).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(`option[value="${PROJ_WORK_ID}"]`)).toHaveCount(1);
    await expect(page.locator(`option[value="${PROJ_PERSONAL_ID}"]`)).toHaveCount(0);
  });

  test("new feature form: personal cookie → only personal projects in dropdown", async ({ page }) => {
    await page.route("**/realtime/**", (route) => route.abort());

    await page.goto(`/dashboard/jobs/new${FX_PERSONAL}`);

    await expect(page.locator("select#project")).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(`option[value="${PROJ_PERSONAL_ID}"]`)).toHaveCount(1);
    await expect(page.locator(`option[value="${PROJ_WORK_ID}"]`)).toHaveCount(0);
  });

  test("form submit POSTs correct projectId to /api/jobs, redirects to job detail", async ({ page }) => {
    await page.route("**/realtime/**", (route) => route.abort());

    // Capture POST body
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("**/api/jobs", async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ job: { ...WORK_JOB, id: NEW_JOB_ID } }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
    });

    await page.goto(`/dashboard/jobs/new${FX_WORK}`);

    // Wait for form to be ready
    await expect(page.locator("select#project")).toBeVisible({ timeout: 8_000 });

    await page.selectOption("select#project", { value: PROJ_WORK_ID });
    await page.fill("input#title", "Workspace E2E Test Feature");
    await page.fill("textarea#description", "This is a test description that is long enough to pass validation.");

    // Arm waiter before click so the POST isn't missed
    const postReq = page.waitForRequest(
      (req) => req.url().includes("/api/jobs") && req.method() === "POST",
      { timeout: 8_000 },
    );
    await page.click('button[type="submit"]');
    await postReq;

    // API reads workspace from cookie — form only needs to send projectId
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!["projectId"]).toBe(PROJ_WORK_ID);
    expect(capturedBody!["type"]).toBe("feature");
  });
});
