import { test, expect } from "@playwright/test";
import { mockBackend, collectConsoleErrors, login } from "./helpers.mjs";

test.describe("site view", () => {
  test("navigates from the sidebar, renders distributions and reacts to filters", async ({ page }) => {
    await mockBackend(page);
    const errors = collectConsoleErrors(page);
    await login(page);

    await page.click("#nav a[href='#/vbp-parana']");
    await expect(page).toHaveURL(/#\/vbp-parana$/);
    await expect(page.locator("#site-title")).toHaveText("VBP Paraná");
    await expect(page.locator("#site-meta .pill")).toBeVisible();
    await expect(page.locator("#site-kpis .kpi")).toHaveCount(5);
    await expect(page.locator("#site-pages .barlist-item").first()).toBeVisible();
    await expect(page.locator("#site-referrers .barlist-item").first()).toBeVisible();
    await expect(page.locator("#site-campaigns .barlist-item").first()).toBeVisible();
    await expect(page.locator("#site-devices .barlist-item").first()).toBeVisible();
    await expect(page.locator("#site-heatmap .heatmap-cell")).toHaveCount(168);
    await expect(page.locator("#site-map svg")).toBeVisible();
    await expect(page.locator("#site-latest tr")).toHaveCount(25);

    await page.selectOption("#site-period", "7d");
    await page.selectOption("#site-granularity", "hour");
    await expect(page.locator("#site-kpis .kpi").nth(3).locator(".kpi-label")).toHaveText("No período");
    await expect(page.locator("#nav a[href='#/vbp-parana']")).toHaveClass(/active/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("old bookmark routes and unknown routes still resolve", async ({ page }) => {
    await mockBackend(page);
    await login(page);
    await page.goto("/#/site/portfolio");
    await expect(page.locator("#site-title")).toHaveText("Portfólio");
    await page.goto("/#/does-not-exist");
    await expect(page.locator("#view-overview")).toBeVisible();
  });

  test("site missing from the proxy shows an explanatory empty state", async ({ page }) => {
    await mockBackend(page);
    await login(page);
    await page.goto("/#/d3d");
    await expect(page.locator("#site-meta .pill--missing, #site-meta .pill")).toContainText(/não configurado/i);
    await expect(page.locator("#site-empty .empty-state")).toContainText(/SITES do Apps Script/);
  });

  test("CSV export downloads the current site's period", async ({ page }) => {
    await mockBackend(page);
    await login(page);
    await page.goto("/#/precos-diarios");
    await expect(page.locator("#site-latest tr").first()).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-btn")]);
    expect(download.suggestedFilename()).toMatch(/^observatory-precos-diarios-\d{8}\.csv$/);
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(path, "utf8");
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.split("\r\n").length).toBeGreaterThan(10);
    expect(content).toContain("precos-diarios");
  });
});

test.describe("github view", () => {
  test("lists repos, KPIs and untracked Pages suggestions", async ({ page }) => {
    const calls = await mockBackend(page);
    const errors = collectConsoleErrors(page);
    await login(page);
    await page.click("#nav a[href='#/github']");
    await expect(page.locator("#gh-kpis .kpi")).toHaveCount(6);
    await expect(page.locator("#gh-suggestions .suggestion")).toHaveCount(6);
    await expect(page.locator("#gh-suggestions .suggestion-name").first()).toHaveText("avnergomes/controlpanel");
    await expect(page.locator("#gh-repos tbody tr").first()).toBeVisible();
    await expect(page.locator("#gh-repos .tag--ok").first()).toBeVisible();
    await expect(page.locator("#gh-notice")).toContainText("42 chamadas");
    // One request per configured account.
    expect(calls.github.length).toBe(5);

    await page.fill("#gh-filter", "clt");
    await expect(page.locator("#gh-repos tbody tr")).toHaveCount(1);
    await expect(page.locator("#gh-count")).toHaveText(/1 de/);

    // Copy snippet button exists and the snippet has the proxy URL.
    await expect(page.locator("#gh-snippet")).toContainText("script.google.com/macros");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("rate limit is reported without breaking the page", async ({ page }) => {
    await mockBackend(page, { github: { ratelimit: true } });
    await login(page);
    await page.goto("/#/github");
    await expect(page.locator("#gh-kpis .empty-state")).toContainText(/Limite/);
    await expect(page.locator("#toast")).toHaveClass(/show/);
  });
});

test.describe("mock mode (localhost only)", () => {
  test("?mock=1 boots without login using fixtures", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.goto("/?mock=1");
    await expect(page.locator("#login-overlay")).toBeHidden();
    await expect(page.locator("#ov-kpis .kpi")).toHaveCount(6);
    await page.goto("/?mock=1#/github");
    await expect(page.locator("#gh-repos tbody tr").first()).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
