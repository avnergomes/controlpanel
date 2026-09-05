import { test, expect } from "@playwright/test";
import { mockBackend, collectConsoleErrors, login, PASSWORD } from "./helpers.mjs";
import { SITES } from "../../src/sites.js";

test.describe("login and overview", () => {
  test("rejects a wrong password and accepts the right one without console errors", async ({ page }) => {
    const calls = await mockBackend(page);
    const errors = collectConsoleErrors(page);
    await page.goto("/");
    await expect(page.locator("#login-overlay")).toBeVisible();
    await page.fill("#login-password", "errada");
    await page.click("#login-form button[type=submit]");
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(page.locator("#login-error")).toHaveText(/inválida/i);
    // Button keeps its icon + label (no textContent overwrite).
    await expect(page.locator("#login-form button[type=submit] svg")).toHaveCount(1);

    await page.fill("#login-password", PASSWORD);
    await page.click("#login-form button[type=submit]");
    await expect(page.locator("#login-overlay")).toBeHidden();
    await expect(page.locator("#ov-kpis .kpi")).toHaveCount(6);
    await expect(page.locator("#status-label")).toHaveText("LIVE");
    expect(calls.login).toHaveLength(2);
    expect(calls.getData.length).toBeGreaterThanOrEqual(1);
    expect(calls.getData[0].token).toBe("tok-123");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("overview renders every panel, health alerts and the stacked chart", async ({ page }) => {
    await mockBackend(page);
    const errors = collectConsoleErrors(page);
    await login(page);

    // KPI "Hoje" has a value and a delta chip.
    const today = page.locator("#ov-kpis .kpi").first();
    await expect(today.locator(".kpi-label")).toHaveText("Hoje");
    await expect(today.locator(".kpi-value")).not.toHaveText("");

    // Health: fixture has one proxy error (cwbtopo), one missing (d3d), one stale, one silent.
    const alerts = page.locator("#ov-alerts .alert");
    await expect(alerts).toHaveCount(4);
    await expect(page.locator("#ov-alerts .alert--error .alert-site")).toHaveText("CWB Topografia");
    await expect(page.locator("#ov-alerts .alert--missing .alert-site")).toHaveText("D3D Inovação");
    await expect(page.locator("#ov-alerts .alert--silent .alert-site")).toHaveText("Segurança Paraná");
    await expect(page.locator("#ov-alerts .alert--stale .alert-site")).toHaveText("Crédito Rural Paraná");

    await expect(page.locator("#ov-ranking .barlist-item")).toHaveCount(SITES.length);
    await expect(page.locator("#ov-pages .barlist-item").first()).toBeVisible();
    await expect(page.locator("#ov-channels .barlist-item").first()).toBeVisible();
    await expect(page.locator("#ov-geo .geo-chip").first()).toBeVisible();
    await expect(page.locator("#ov-heatmap .heatmap-cell")).toHaveCount(7 * 24);
    await expect(page.locator("#ov-perf .barlist-item").first()).toBeVisible();
    await expect(page.locator("#ov-map svg .map-region")).toHaveCount(40);
    await expect(page.locator("#ov-map svg .map-region.tz-recent, #ov-map svg .map-region.tz-today").first()).toBeVisible();

    // Chart.js drew on the canvas (non-blank).
    const drawn = await page.locator("#ov-series").evaluate((c) => {
      const ctx = c.getContext("2d");
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    });
    expect(drawn).toBe(true);

    // Sidebar shows all sites with health dots and 24h counts.
    await expect(page.locator("#nav .nav-link")).toHaveCount(2 + SITES.length);
    await expect(page.locator("#nav .nav-dot--live, #nav .nav-dot--active")).not.toHaveCount(0);
    await expect(page.locator("#nav .nav-dot--error")).toHaveCount(1);

    // Period switch re-renders labels.
    await page.selectOption("#ov-period", "30d");
    await expect(page.locator("[data-ov-period-label]").first()).toHaveText("30 dias");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("session persists across reload via cache and sessionStorage", async ({ page }) => {
    const calls = await mockBackend(page);
    await login(page);
    await page.reload();
    await expect(page.locator("#login-overlay")).toBeHidden();
    await expect(page.locator("#ov-kpis .kpi").first()).toBeVisible();
    // Second load sends `since` for a delta (server may ignore it).
    const withSince = calls.getData.filter((c) => c.since);
    expect(withSince.length).toBeGreaterThanOrEqual(1);
  });

  test("expired session returns to the login gate with a message", async ({ page }) => {
    await mockBackend(page, { proxy: { unauthorized: true } });
    await page.goto("/");
    await page.evaluate(() => sessionStorage.setItem("controlpanel-session-token", "stale-token"));
    await page.reload();
    await expect(page.locator("#login-overlay")).toBeVisible();
    await expect(page.locator("#login-error")).toHaveText(/expirada/i);
  });

  test("proxy failure shows a toast and keeps the UI usable", async ({ page }) => {
    await mockBackend(page, { proxy: { fail: true } });
    await page.goto("/");
    await page.fill("#login-password", PASSWORD);
    await page.click("#login-form button[type=submit]");
    await expect(page.locator("#login-overlay")).toBeHidden();
    await expect(page.locator("#toast")).toHaveClass(/show/);
    await expect(page.locator("#status-label")).toHaveText("FALHA");
    await expect(page.locator("#ov-kpis .empty-state")).toBeVisible();
  });
});
