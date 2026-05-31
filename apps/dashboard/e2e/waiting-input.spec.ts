import { test, expect } from "@playwright/test";

/**
 * T-406: waiting_input flow E2E tests.
 *
 * Strategy: intercept Supabase REST calls to inject fixture data so tests
 * run without a live DB. The answer API route is also intercepted to verify
 * the correct payload is sent.
 */

const JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const JOB_URL = `/dashboard/jobs/${JOB_ID}?__fixture=waiting_input`;

const OPEN_QUESTIONS = [
  "Hangi kimlik doğrulama yöntemi kullanılacak? (email/password, OAuth, SSO)",
  "Mevcut kullanıcı tablosu var mı yoksa sıfırdan mı oluşturulsun?",
];

const WAITING_JOB = {
  id: JOB_ID,
  project_id: "proj-1111",
  type: "feature",
  title: "Login ekle",
  description: "Kullanıcıların sisteme giriş yapabilmesini istiyorum.",
  lane_preference: "auto",
  status: "waiting_input",
  branch: null,
  pr_url: null,
  spec: {
    summary: "Login ekle",
    user_stories: [],
    acceptance_criteria: [],
    out_of_scope: [],
    open_questions: OPEN_QUESTIONS,
    research_notes: [],
  },
  plan: null,
  answers: null,
  error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mockSupabaseJob(page: import("@playwright/test").Page, job: typeof WAITING_JOB) {
  // Intercept Supabase REST: jobs table single fetch
  await page.route(`**/rest/v1/jobs?id=eq.${JOB_ID}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(job),
    });
  });
  // Supabase maybeSingle wraps in array or returns object depending on headers
  await page.route(`**/rest/v1/jobs?select=*&id=eq.${JOB_ID}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(job),
    });
  });
  // Runs (empty)
  await page.route(`**/rest/v1/runs?*job_id=eq.${JOB_ID}*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  // Child jobs (empty)
  await page.route(`**/rest/v1/jobs?select=id%2Ctitle%2Cstatus&parent_job_id=eq.${JOB_ID}*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  // usage_log (empty)
  await page.route(`**/rest/v1/usage_log*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  // Supabase Realtime websocket — allow through (won't connect in test)
  await page.route(`**/realtime/**`, async (route) => route.abort());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("T-406: waiting_input flow", () => {
  test("waiting_input job shows orange banner with question heading", async ({ page }) => {
    await mockSupabaseJob(page, WAITING_JOB);
    await page.goto(JOB_URL);

    // Banner heading
    const heading = page.getByText("Product Owner şu soruları soruyor", { exact: false });
    await expect(heading).toBeVisible({ timeout: 8_000 });
  });

  test("each open_question renders as bold label + textarea", async ({ page }) => {
    await mockSupabaseJob(page, WAITING_JOB);
    await page.goto(JOB_URL);

    for (const q of OPEN_QUESTIONS) {
      const label = page.getByText(q, { exact: true });
      await expect(label).toBeVisible({ timeout: 8_000 });
    }

    const textareas = page.locator("textarea");
    await expect(textareas).toHaveCount(OPEN_QUESTIONS.length);
  });

  test("submit button is disabled / shows error when answer is empty", async ({ page }) => {
    await mockSupabaseJob(page, WAITING_JOB);
    await page.goto(JOB_URL);

    // Click submit without filling any textarea
    const submitBtn = page.getByRole("button", { name: /cevapla ve devam et/i });
    await expect(submitBtn).toBeVisible({ timeout: 8_000 });
    await submitBtn.click();

    await expect(page.getByText("Lütfen tüm soruları cevaplayın")).toBeVisible();
  });

  test("filled form POSTs correct payload to /api/jobs/[id]/answer", async ({ page }) => {
    let capturedBody: unknown = null;

    await page.route(`**/api/jobs/${JOB_ID}/answer`, async (route) => {
      capturedBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto(JOB_URL);

    const textareas = page.locator("textarea");
    await expect(textareas.nth(0)).toBeVisible({ timeout: 8_000 });
    await textareas.nth(0).fill("email/password kullanılacak");
    await textareas.nth(1).fill("Sıfırdan oluşturulsun");

    const [response] = await Promise.all([
      page.waitForResponse(`**/api/jobs/${JOB_ID}/answer`, { timeout: 10_000 }),
      page.getByRole("button", { name: /cevapla ve devam et/i }).click(),
    ]);

    expect(response.status()).toBe(200);
    const [q0, q1] = OPEN_QUESTIONS;
    expect(capturedBody).toMatchObject({
      answers: {
        [q0!]: "email/password kullanılacak",
        [q1!]: "Sıfırdan oluşturulsun",
      },
    });
  });

  test("after submit, waiting_input form hides when job status changes to queued (Realtime sim)", async ({ page }) => {
    // Mock answer API
    await page.route(`**/api/jobs/${JOB_ID}/answer`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.goto(JOB_URL);

    const form = page.getByText("Product Owner şu soruları soruyor", { exact: false });
    await expect(form).toBeVisible({ timeout: 8_000 });

    // Fill + submit
    const textareas = page.locator("textarea");
    await expect(textareas.nth(0)).toBeVisible({ timeout: 5_000 });
    await textareas.nth(0).fill("email/password");
    await textareas.nth(1).fill("Sıfırdan oluşturulsun");
    await page.getByRole("button", { name: /cevapla ve devam et/i }).click();

    // Simulate Realtime job UPDATE by navigating to queued_no_questions fixture
    // (In real app this arrives via WebSocket; in test we verify the component
    //  correctly hides the form when job.status !== 'waiting_input')
    await page.goto(`/dashboard/jobs/${JOB_ID}?__fixture=queued_no_questions`);
    await expect(form).not.toBeVisible({ timeout: 4_000 });

    // Should show QUEUED badge instead
    const badge = page.getByText("QUEUED", { exact: true });
    await expect(badge).toBeVisible({ timeout: 4_000 });
  });

  test("status badge shows WAITING INPUT for waiting_input jobs", async ({ page }) => {
    await mockSupabaseJob(page, WAITING_JOB);
    await page.goto(JOB_URL);

    const badge = page.getByText("WAITING INPUT", { exact: true });
    await expect(badge).toBeVisible({ timeout: 8_000 });
  });

  test("job with no open_questions does not show waiting_input form", async ({ page }) => {
    const url = `/dashboard/jobs/${JOB_ID}?__fixture=queued_no_questions`;
    await page.goto(url);

    const heading = page.getByText("Product Owner şu soruları soruyor", { exact: false });
    await expect(heading).not.toBeVisible({ timeout: 4_000 });
  });
});
