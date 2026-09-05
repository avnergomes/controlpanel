// Network layer: Apps Script proxy (auth + telemetry) and GitHub public API.
// Speaks both proxy formats: v2 (rows as objects, full payload) and v3
// (columnar {headers, values}, optional delta via `since`).
import { CONFIG, isMockMode } from "./config.js";
import { SITES, GITHUB_ACCOUNTS } from "./sites.js";
import { columnarToObjects, dedupeRows, normalizeSiteRows, sortByTime } from "./normalize.js";
import { loadGithub, saveGithub } from "./cache.js";

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// text/plain avoids a CORS preflight, which Apps Script cannot answer.
async function postJson(body, { timeoutMs = 45000 } = {}) {
  if (!CONFIG.proxyUrl) throw new ApiError("Proxy não configurado (config.local.js)", "config");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(CONFIG.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new ApiError(`Proxy respondeu ${response.status}`, "http");
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError("Resposta inválida do proxy", "parse");
    }
  } catch (err) {
    if (err.name === "AbortError") throw new ApiError("Tempo esgotado ao consultar o proxy", "timeout");
    if (err instanceof ApiError) throw err;
    throw new ApiError("Falha de rede ao consultar o proxy", "network");
  } finally {
    clearTimeout(timer);
  }
}

export async function login(password) {
  if (isMockMode()) return { token: "mock-token" };
  const result = await postJson({ action: "login", password });
  if (result && result.success && result.token) return { token: result.token };
  throw new ApiError("Credencial inválida", "unauthorized");
}

async function fetchMockPayload() {
  const response = await fetch("tests/fixtures/payload.json", { cache: "no-store" });
  if (!response.ok) throw new ApiError("Fixture de mock não encontrada", "mock");
  return response.json();
}

// Returns { rows, status, serverMeta }. `since` (Date) asks a v3 proxy for a delta.
export async function fetchTelemetry(token, { since = null } = {}) {
  if (!token && !isMockMode()) throw new ApiError("Sessão ausente", "unauthorized");
  const payload = isMockMode()
    ? await fetchMockPayload()
    : await postJson({ action: "getData", token, since: since ? since.toISOString() : undefined, format: "columnar" });

  if (payload.error === "unauthorized") throw new ApiError("Sessão expirada", "unauthorized");
  if (payload.error) throw new ApiError(String(payload.error), "server");
  if (!payload.sites || typeof payload.sites !== "object") throw new ApiError("Resposta sem 'sites'", "server");

  const status = {};
  const quality = {};
  const rows = [];
  for (const site of SITES) {
    const entry = payload.sites[site.key];
    if (!entry) {
      status[site.key] = "missing";
      continue;
    }
    if (entry.status === "error") {
      status[site.key] = "error";
      quality[site.key] = { received: 0, parsed: 0, dropped: 0, error: entry.error || "" };
      continue;
    }
    status[site.key] = "ok";
    const objects = Array.isArray(entry.values) ? columnarToObjects(entry.headers, entry.values) : entry.rows || [];
    const normalized = normalizeSiteRows(site, objects);
    quality[site.key] = { received: objects.length, parsed: normalized.length, dropped: objects.length - normalized.length };
    rows.push(...normalized);
  }
  const deduped = dedupeRows(rows);
  return {
    rows: sortByTime(deduped),
    duplicates: rows.length - deduped.length,
    quality,
    status,
    serverMeta: {
      format: Array.isArray(Object.values(payload.sites)[0]?.values) ? "columnar" : "legacy",
      version: payload.version || null,
      fetchedAt: payload.fetchedAt || null,
      delta: payload.delta === true,
    },
  };
}

// ── GitHub ────────────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";

async function githubGet(path) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  const remaining = remainingHeader === null || remainingHeader === "" ? null : Number(remainingHeader);
  if (response.status === 403 || response.status === 429) {
    throw new ApiError("Limite da API pública do GitHub atingido (60/h). Tente mais tarde.", "ratelimit");
  }
  if (!response.ok) throw new ApiError(`GitHub respondeu ${response.status}`, "http");
  return { data: await response.json(), remaining: Number.isFinite(remaining) ? remaining : null };
}

function compactRepo(repo) {
  return {
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login || "",
    description: repo.description || "",
    language: repo.language || "",
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    openIssues: repo.open_issues_count || 0,
    hasPages: !!repo.has_pages,
    archived: !!repo.archived,
    fork: !!repo.fork,
    pushedAt: repo.pushed_at || null,
    updatedAt: repo.updated_at || null,
    createdAt: repo.created_at || null,
    htmlUrl: repo.html_url,
    homepage: repo.homepage || "",
    size: repo.size || 0,
    defaultBranch: repo.default_branch || "main",
  };
}

// Repositories of every configured account. Cached in localStorage to respect the
// unauthenticated limit; a stale cache is returned when the API is unavailable.
export async function fetchGithubRepos({ force = false } = {}) {
  if (isMockMode()) {
    const response = await fetch("tests/fixtures/github.json", { cache: "no-store" });
    const payload = await response.json();
    return { ...payload, fromCache: false, fetchedAt: new Date() };
  }
  const cached = loadGithub();
  if (cached && !cached.stale && !force) return { ...cached.payload, fromCache: true, fetchedAt: cached.savedAt };

  try {
    const results = await Promise.all(
      GITHUB_ACCOUNTS.map(async (account) => {
        // /users/ works for both users and organizations.
        const { data, remaining } = await githubGet(`/users/${account}/repos?per_page=100&sort=pushed`);
        return { account, repos: Array.isArray(data) ? data.map(compactRepo) : [], remaining };
      }),
    );
    const payload = {
      accounts: results.map(({ account, repos }) => ({ account, count: repos.length })),
      repos: results.flatMap((r) => r.repos),
      remaining: Math.min(...results.map((r) => (r.remaining === null ? Infinity : r.remaining))),
    };
    if (!Number.isFinite(payload.remaining)) payload.remaining = null;
    saveGithub(payload);
    return { ...payload, fromCache: false, fetchedAt: new Date() };
  } catch (err) {
    if (cached) return { ...cached.payload, fromCache: true, stale: true, fetchedAt: cached.savedAt, error: err.message };
    throw err;
  }
}
