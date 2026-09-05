// Shared Playwright helpers: intercept the Apps Script proxy and the GitHub API so the
// suite never touches the network, and fail on console errors / CSP violations.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";

const PAYLOAD = JSON.parse(readFileSync(resolve("tests/fixtures/payload.json"), "utf8"));
const GITHUB = JSON.parse(readFileSync(resolve("tests/fixtures/github.json"), "utf8"));
export const PASSWORD = "segredo-de-teste";

function toApiRepo(repo) {
  return {
    full_name: repo.fullName, name: repo.name, owner: { login: repo.owner }, description: repo.description, language: repo.language,
    stargazers_count: repo.stars, forks_count: repo.forks, open_issues_count: repo.openIssues, has_pages: repo.hasPages,
    archived: repo.archived, fork: repo.fork, pushed_at: repo.pushedAt, updated_at: repo.updatedAt, created_at: repo.createdAt,
    html_url: repo.htmlUrl, homepage: repo.homepage, size: repo.size, default_branch: repo.defaultBranch,
  };
}

export async function mockBackend(page, { proxy = {}, github = {} } = {}) {
  const calls = { login: [], getData: [], github: [] };
  await page.route("**/macros/s/**", async (route) => {
    const request = route.request();
    let body = {};
    try { body = JSON.parse(request.postData() || "{}"); } catch { body = {}; }
    if (body.action === "login") {
      calls.login.push(body);
      const ok = body.password === PASSWORD;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ok ? { success: true, token: "tok-123" } : { success: false, error: "invalid_password" }) });
    }
    if (body.action === "getData") {
      calls.getData.push(body);
      if (proxy.unauthorized) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
      if (proxy.fail) return route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
      if (body.token !== "tok-123") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proxy.payload || PAYLOAD) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
  });
  await page.route("https://api.github.com/**", async (route) => {
    calls.github.push(route.request().url());
    if (github.ratelimit) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "API rate limit exceeded" }) });
    const url = route.request().url();
    const account = url.match(/\/users\/([^/]+)\/repos/)?.[1];
    const repos = GITHUB.repos.filter((r) => r.owner === account).map(toApiRepo);
    // GitHub exposes the rate-limit headers via CORS; the mock must do the same.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-ratelimit-remaining": "42", "access-control-allow-origin": "*", "access-control-expose-headers": "x-ratelimit-remaining" },
      body: JSON.stringify(repos),
    });
  });
  // Google Fonts are irrelevant for assertions; short-circuit them to keep runs fast/offline.
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("https://fonts.gstatic.com/**", (route) => route.fulfill({ status: 404, body: "" }));
  return calls;
}

export function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export async function login(page) {
  await page.goto("/");
  await expect(page.locator("#login-overlay")).toBeVisible();
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-form button[type=submit]");
  await expect(page.locator("#login-overlay")).toBeHidden();
  await expect(page.locator("#ov-kpis .kpi").first()).toBeVisible();
}

export { PAYLOAD, GITHUB };
