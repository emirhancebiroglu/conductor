# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: perf\agents-perf.spec.ts >> agents dashboard performance >> 1500 agent configs load without crashing
- Location: e2e\perf\agents-perf.spec.ts:162:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByText('Total').locator('..')
Expected substring: "1500"
Received string:    "Total8"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for getByText('Total').locator('..')
    14 × locator resolved to <div class="agents-stat">…</div>
       - unexpected value "Total8"

```

```yaml
- text: Total 8
```

# Test source

```ts
  101 |       body: "[]",
  102 |     });
  103 |   });
  104 | 
  105 |   // Block Supabase Realtime WebSocket
  106 |   await page.route("**/realtime/**", async (route) => route.abort());
  107 | }
  108 | 
  109 | async function simulateRealtimeUpdate(
  110 |   page: Page,
  111 |   table: "agent_config" | "jobs" | "runs",
  112 |   newRow: Record<string, unknown>,
  113 | ) {
  114 |   await page.evaluate(
  115 |     ({ table, newRow }) => {
  116 |       const event = new CustomEvent("__test_realtime", {
  117 |         detail: { table, payload: { new: newRow } },
  118 |       });
  119 |       window.dispatchEvent(event);
  120 |     },
  121 |     { table, newRow },
  122 |   );
  123 |   await page.waitForTimeout(50);
  124 | }
  125 | 
  126 | // ---------------------------------------------------------------------------
  127 | // Tests
  128 | // ---------------------------------------------------------------------------
  129 | 
  130 | test.describe("agents dashboard performance", () => {
  131 |   test.skip(
  132 |     process.env["RUN_PERF_TESTS"] !== "1",
  133 |     "performance tests are skipped by default — set RUN_PERF_TESTS=1 to enable",
  134 |   );
  135 | 
  136 |   // -----------------------------------------------------------------------
  137 |   // 1. Page load time under 3 seconds
  138 |   // -----------------------------------------------------------------------
  139 | 
  140 |   test(
  141 |     "page load time under 3 seconds",
  142 |     async ({ page }) => {
  143 |       await mockAgentsApi(page);
  144 | 
  145 |       const startTime = Date.now();
  146 |       await page.goto("/dashboard/agents?__fixture=1", {
  147 |         waitUntil: "networkidle",
  148 |       });
  149 |       const loadTime = Date.now() - startTime;
  150 | 
  151 |       await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  152 | 
  153 |       expect(loadTime).toBeLessThan(3000);
  154 |     },
  155 |     PERF_TIMEOUT,
  156 |   );
  157 | 
  158 |   // -----------------------------------------------------------------------
  159 |   // 2. 1500 agent configs load without crashing
  160 |   // -----------------------------------------------------------------------
  161 | 
  162 |   test(
  163 |     "1500 agent configs load without crashing",
  164 |     async ({ page }) => {
  165 |       // Load page with standard fixture first
  166 |       await mockAgentsApi(page);
  167 |       await page.goto("/dashboard/agents?__fixture=agents_default", {
  168 |         waitUntil: "networkidle",
  169 |       });
  170 | 
  171 |       const consoleErrors: string[] = [];
  172 |       page.on("console", (msg) => {
  173 |         if (msg.type() === "error") {
  174 |           consoleErrors.push(msg.text());
  175 |         }
  176 |       });
  177 | 
  178 |       // Verify initial page rendered
  179 |       await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  180 | 
  181 |       // Wait for realtime handlers to be registered
  182 |       await page.waitForTimeout(500);
  183 | 
  184 |       // Inject 1500 agents directly into React state via custom event
  185 |       const agents = generateAgents(1500);
  186 |       await page.evaluate(
  187 |         ({ agents }) => {
  188 |           const event = new CustomEvent("__test_load_agents", { detail: { agents } });
  189 |           window.dispatchEvent(event);
  190 |         },
  191 |         { agents },
  192 |       );
  193 | 
  194 |       await page.waitForTimeout(1000);
  195 | 
  196 |       // Verify page didn't crash
  197 |       await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  198 | 
  199 |       // Verify total count shows 1500
  200 |       const totalSection = page.getByText("Total").locator("..");
> 201 |       await expect(totalSection).toContainText("1500");
      |                                  ^ Error: expect(locator).toContainText(expected) failed
  202 | 
  203 |       // Verify no console errors
  204 |       expect(consoleErrors).toHaveLength(0);
  205 |     },
  206 |     PERF_TIMEOUT,
  207 |   );
  208 | 
  209 |   // -----------------------------------------------------------------------
  210 |   // 3. 50 running jobs display correctly
  211 |   // -----------------------------------------------------------------------
  212 | 
  213 |   test(
  214 |     "50 running jobs display correctly",
  215 |     async ({ page }) => {
  216 |       const runningJobs = generateRunningJobs(50);
  217 |       await mockAgentsApi(page, { runningJobs });
  218 | 
  219 |       await page.goto("/dashboard/agents?__fixture=agents_default", {
  220 |         waitUntil: "networkidle",
  221 |       });
  222 | 
  223 |       // Simulate 50 jobs starting via realtime updates
  224 |       const now = "2026-05-31T00:00:00Z";
  225 |       for (let i = 0; i < 50; i++) {
  226 |         await page.evaluate(
  227 |           ({ job, now }) => {
  228 |             const event = new CustomEvent("__test_realtime", {
  229 |               detail: {
  230 |                 table: "jobs",
  231 |                 payload: {
  232 |                   new: {
  233 |                     id: job.jobId,
  234 |                     title: job.jobTitle,
  235 |                     current_agent: job.agentName,
  236 |                     started_at: now,
  237 |                     current_step_message: job.stepMessage,
  238 |                     status: "running",
  239 |                   },
  240 |                   old: {
  241 |                     id: job.jobId,
  242 |                     title: job.jobTitle,
  243 |                     current_agent: null,
  244 |                     started_at: null,
  245 |                     current_step_message: null,
  246 |                     status: "queued",
  247 |                   },
  248 |                 },
  249 |               },
  250 |             });
  251 |             window.dispatchEvent(event);
  252 |           },
  253 |           { job: runningJobs[i], now },
  254 |         );
  255 |       }
  256 | 
  257 |       await page.waitForTimeout(1000);
  258 | 
  259 |       // Verify running count shows 50
  260 |       const runningLabel = page.locator("text='Running'").first();
  261 |       await expect(runningLabel).toBeVisible();
  262 |       const runningSection = runningLabel.locator("..");
  263 |       await expect(runningSection).toContainText("50");
  264 | 
  265 |       // Verify no layout breakage — page should be scrollable and responsive
  266 |       const viewportSize = page.viewportSize();
  267 |       expect(viewportSize).not.toBeNull();
  268 | 
  269 |       // Verify the page didn't crash
  270 |       await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  271 |     },
  272 |     PERF_TIMEOUT,
  273 |   );
  274 | 
  275 |   // -----------------------------------------------------------------------
  276 |   // 4. Memory usage after 10 rapid Realtime updates
  277 |   // -----------------------------------------------------------------------
  278 | 
  279 |   test(
  280 |     "memory usage after 10 rapid Realtime updates",
  281 |     async ({ page }) => {
  282 |       await mockAgentsApi(page);
  283 | 
  284 |       await page.goto("/dashboard/agents?__fixture=1", {
  285 |         waitUntil: "networkidle",
  286 |       });
  287 | 
  288 |       // Measure initial heap size via performance.memory (Chrome-only)
  289 |       const initialMemory = await page.evaluate(() => {
  290 |         const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
  291 |         return perf.memory?.usedJSHeapSize ?? 0;
  292 |       });
  293 | 
  294 |       // Skip if memory API not available (non-Chromium browsers)
  295 |       test.skip(initialMemory === 0, "performance.memory not available in this browser");
  296 | 
  297 |       // Simulate 10 rapid config updates
  298 |       for (let i = 0; i < 10; i++) {
  299 |         await simulateRealtimeUpdate(page, "agent_config", {
  300 |           id: "aaaaaaaa-0001-0000-0000-000000000001",
  301 |           agent_name: "product-owner",
```