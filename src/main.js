// Boot: session gate, navigation, data refresh loop, view rendering.
import { CONFIG, isMockMode } from "./config.js";
import { SITES, siteOf } from "./sites.js";
import { store, setRows, setStatus, setRoute, subscribe } from "./store.js";
import { login, fetchTelemetry, ApiError } from "./api.js";
import { loadRows, saveRows, readFlag, writeFlag, clearAll } from "./cache.js";
import { currentRoute, onRouteChange, navigate, parseRoute } from "./router.js";
import { dedupeRows, sortByTime } from "./normalize.js";
import { siteHealth, maxTimestamp, filterPeriod } from "./analytics.js";
import { zoneOffsetMinutes } from "./geo.js";
import { buildNav } from "./ui/nav.js";
import { byId } from "./ui/dom.js";
import { showToast, setLoading, setSyncStatus } from "./ui/feedback.js";
import { destroyAllCharts } from "./ui/charts.js";
import { downloadCsv } from "./export.js";
import { bindOverview, renderOverview } from "./views/overview.js";
import { bindSite, renderSite } from "./views/site.js";
import { bindGithub, renderGithub } from "./views/github.js";
import { formatDateTime } from "./format.js";

const session = {
  get token() { return sessionStorage.getItem(CONFIG.sessionKey); },
  set(token) { sessionStorage.setItem(CONFIG.sessionKey, token); },
  clear() { sessionStorage.removeItem(CONFIG.sessionKey); },
};

const MAX_BACKOFF_MS = 10 * 60000;

let nav = null;
let pollTimer = null;
let healthBySite = {};
let started = false;
let renderQueued = false;

function offsetMinutes() {
  return zoneOffsetMinutes(CONFIG.timeZone);
}

function computeHealth(now = new Date()) {
  const next = {};
  for (const site of SITES) {
    next[site.key] = siteHealth(store.bySite[site.key] || [], store.status[site.key], now, { silentAfterDays: CONFIG.silentAfterDays, offsetMinutes: offsetMinutes() });
    if (store.status[site.key] === "missing") next[site.key].state = "missing";
  }
  healthBySite = next;
  return next;
}

function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const now = new Date();
    const route = store.route;
    const offset = offsetMinutes();
    computeHealth(now);
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === route.view));
    document.body.dataset.view = route.view;
    nav?.update({ route, healthBySite });
    try {
      if (route.view === "overview") renderOverview({ store, now, offsetMinutes: offset, healthBySite });
      else if (route.view === "site") renderSite({ store, siteKey: route.siteKey, now, offsetMinutes: offset, healthBySite });
      else if (route.view === "github") renderGithub({ store, now });
    } catch (err) {
      console.error("[observatory] render failed", err);
      showToast("Falha ao desenhar a view; veja o console.", { tone: "error" });
    }
    updateTitle(route);
  });
}

function updateTitle(route) {
  const site = route.view === "site" ? siteOf(route.siteKey) : null;
  document.title = site ? `${site.name} · Observatory` : route.view === "github" ? "Repositórios · Observatory" : "Observatory · Control Panel";
}

// ── data refresh ──────────────────────────────────────────────────────────

// Full (non-delta) responses replace everything, except that sites the proxy failed to
// read keep the rows we already had: a transient sheet error must not erase history.
function mergeFull(previousBySite, fresh, status) {
  const kept = [];
  for (const site of SITES) {
    if ((status[site.key] === "error" || status[site.key] === "missing") && previousBySite[site.key]?.length) kept.push(...previousBySite[site.key]);
  }
  return kept.length ? sortByTime(dedupeRows([...fresh, ...kept])) : fresh;
}

function sameStatus(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

async function refresh({ force = false, silent = false } = {}) {
  if (store.isLoading) return;
  const token = session.token;
  if (!token && !isMockMode()) return;
  store.isLoading = true;
  if (!silent) setLoading(true);
  setSyncStatus("loading", { lastFetched: store.lastFetched });
  try {
    const wantDelta = !force && !store.cachePartial && store.rows.length > 0;
    const since = wantDelta ? maxTimestamp(store.rows) : null;
    const result = await fetchTelemetry(token, { since });
    const rows = result.serverMeta.delta && since
      ? sortByTime(dedupeRows([...store.rows, ...result.rows]))
      : mergeFull(store.bySite, result.rows, result.status);
    const fetchedAt = new Date();
    const previousMax = maxTimestamp(store.rows);
    const nextMax = maxTimestamp(rows);
    const changed = force || rows.length !== store.rows.length || nextMax?.getTime() !== previousMax?.getTime() || !sameStatus(result.status, store.status);
    store.cachePartial = false;
    store.failures = 0;
    if (changed) {
      setRows(rows, { status: result.status, quality: result.quality, fetchedAt, serverMeta: result.serverMeta });
      const saved = saveRows(rows, { fetchedAt, status: result.status, serverMeta: result.serverMeta });
      store.cachePartial = saved.partial;
    } else {
      store.lastFetched = fetchedAt;
    }
    setSyncStatus("ok", { lastFetched: fetchedAt, message: `Formato ${result.serverMeta.format}${result.serverMeta.delta ? " (delta)" : ""} · v${result.serverMeta.version || "2"}` });
    const errors = SITES.filter((site) => result.status[site.key] === "error");
    if (errors.length && (force || changed)) showToast(`Proxy falhou em ${errors.length} site(s): ${errors.map((s) => s.short).join(", ")}`, { tone: "warn" });
    if (changed && previousMax && readFlag(CONFIG.notifyKey)) notifyNew(rows, previousMax);
    if (pollTimer) startPolling(CONFIG.pollMs);
  } catch (err) {
    if (err instanceof ApiError && err.code === "unauthorized") {
      endSession("Sessão expirada. Entre novamente.");
    } else {
      store.failures += 1;
      setStatus(store.status, err.message);
      setSyncStatus(store.rows.length ? "stale" : "error", { lastFetched: store.lastFetched, message: err.message });
      if (store.failures === 1 || force) showToast(err.message || "Falha ao atualizar", { tone: "error" });
      if (pollTimer) startPolling(Math.min(MAX_BACKOFF_MS, CONFIG.pollMs * 2 ** store.failures));
    }
  } finally {
    store.isLoading = false;
    setLoading(false);
  }
}

function notifyNew(rows, previousMax) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const fresh = rows.filter((row) => row.ts > previousMax).slice(-5);
  for (const row of fresh) {
    const site = siteOf(row.siteKey);
    new Notification("Novo pageview", {
      body: `${site ? site.name : row.siteKey} · ${row.path || "/"} · ${formatDateTime(row.ts)}`,
      tag: `visit-${row.siteKey}-${row.ts.getTime()}`,
    });
  }
}

function startPolling(delay = CONFIG.pollMs) {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") refresh({ silent: true });
  }, delay);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !started) return;
  const age = store.lastFetched ? Date.now() - store.lastFetched.getTime() : Infinity;
  if (age > CONFIG.pollMs / 2) refresh({ silent: true });
});

// ── session / login ───────────────────────────────────────────────────────

function showLogin(message = "") {
  const overlay = byId("login-overlay");
  const error = byId("login-error");
  overlay?.classList.remove("hidden");
  overlay?.removeAttribute("aria-hidden");
  if (error) {
    error.textContent = message;
    error.hidden = !message;
  }
  byId("login-password")?.focus();
}

function hideLogin() {
  const overlay = byId("login-overlay");
  overlay?.classList.add("hidden");
  overlay?.setAttribute("aria-hidden", "true");
}

function endSession(message) {
  session.clear();
  stopPolling();
  started = false;
  showLogin(message);
}

async function handleLogin(event) {
  event.preventDefault();
  const input = byId("login-password");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const error = byId("login-error");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (error) error.hidden = true;
  try {
    const { token } = await login(input.value);
    session.set(token);
    input.value = "";
    hideLogin();
    start();
  } catch (err) {
    if (error) {
      error.textContent = err instanceof ApiError && err.code === "unauthorized" ? "Credencial inválida" : (err.message || "Erro de conexão");
      error.hidden = false;
    }
    input.value = "";
    input.focus();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function logout() {
  clearAll();
  setRows([], { status: {}, quality: {} });
  destroyAllCharts();
  endSession("");
}

// ── boot ──────────────────────────────────────────────────────────────────

function start() {
  if (started) return;
  started = true;
  store.failures = 0;
  document.body.classList.add("loaded");
  const cached = loadRows();
  if (cached && cached.rows.length) {
    store.cachePartial = cached.partial;
    setRows(cached.rows, { status: cached.status, fetchedAt: cached.fetchedAt, serverMeta: cached.serverMeta || undefined });
    setSyncStatus(cached.stale ? "stale" : "ok", { lastFetched: cached.fetchedAt });
  }
  render();
  refresh({ force: !cached, silent: !!(cached && cached.rows.length) });
  startPolling(cached ? CONFIG.pollMs : CONFIG.pollFirstMs);
}

function bindChrome() {
  byId("login-form")?.addEventListener("submit", handleLogin);
  byId("refresh-btn")?.addEventListener("click", () => refresh({ force: true }));
  byId("logout-btn")?.addEventListener("click", logout);
  byId("export-btn")?.addEventListener("click", () => {
    const route = store.route;
    const rows = route.view === "site"
      ? filterPeriod(store.bySite[route.siteKey] || [], store.filters.period || "30d")
      : filterPeriod(store.rows, store.filters.overviewPeriod || "7d");
    if (!rows.length) {
      showToast("Nenhum dado para exportar", { tone: "warn" });
      return;
    }
    const name = downloadCsv(rows, route.view === "site" ? route.siteKey : "overview");
    showToast(`Exportado: ${name}`, { tone: "ok" });
  });
  const notifyBtn = byId("notify-btn");
  if (notifyBtn) {
    if (!("Notification" in window)) {
      notifyBtn.hidden = true;
    } else {
      const sync = () => notifyBtn.setAttribute("aria-pressed", readFlag(CONFIG.notifyKey) && Notification.permission === "granted" ? "true" : "false");
      sync();
      notifyBtn.addEventListener("click", async () => {
        if (readFlag(CONFIG.notifyKey)) {
          writeFlag(CONFIG.notifyKey, false);
        } else {
          const permission = await Notification.requestPermission();
          writeFlag(CONFIG.notifyKey, permission === "granted");
          if (permission !== "granted") showToast("Notificações bloqueadas pelo navegador", { tone: "warn" });
        }
        sync();
      });
    }
  }
  const clock = byId("utc-clock");
  if (clock) {
    const tick = () => {
      const d = new Date();
      clock.textContent = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} Z`;
    };
    tick();
    setInterval(tick, 1000);
  }
  const year = byId("footer-year");
  if (year) year.textContent = String(new Date().getFullYear());
  const menu = byId("nav-toggle");
  if (menu) {
    menu.addEventListener("click", () => {
      const open = document.body.classList.toggle("nav-open");
      menu.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
}

function closeDrawer() {
  document.body.classList.remove("nav-open");
  byId("nav-toggle")?.setAttribute("aria-expanded", "false");
}

function boot() {
  nav = buildNav(byId("nav"));
  bindChrome();
  bindOverview(render);
  bindSite(render);
  bindGithub(render);
  setRoute(currentRoute());
  onRouteChange((route) => {
    setRoute(route);
    closeDrawer();
    window.scrollTo({ top: 0 });
  });
  subscribe((topic) => {
    if (topic === "route" || topic === "rows" || topic === "github") render();
  });
  byId("nav")?.addEventListener("click", (e) => {
    const link = e.target.closest("a[href^='#/']");
    if (!link) return;
    e.preventDefault();
    navigate(parseRoute(link.getAttribute("href")));
  });
  if (session.token || isMockMode()) {
    hideLogin();
    start();
  } else {
    showLogin();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

// Debug hook for manual QA (read-only).
window.__observatory = { store, refresh, health: () => healthBySite };
