// Application state. Data arrays are replaced, never mutated in place, so renderers can
// compare references cheaply. Subscribers are notified after every replacement.
import { SITES } from "./sites.js";

const listeners = new Set();

export const store = {
  rows: [],
  bySite: indexBySite([]),
  status: {},
  quality: {},
  serverMeta: { format: "legacy", version: null, fetchedAt: null, delta: false },
  lastFetched: null,
  lastError: null,
  isLoading: false,
  cachePartial: false,
  failures: 0,
  filters: { granularity: "day", period: "30d" },
  github: null,
  route: { view: "overview", siteKey: null },
  charts: {},
};

export function indexBySite(rows) {
  const index = {};
  for (const site of SITES) index[site.key] = [];
  for (const row of rows) {
    if (index[row.siteKey]) index[row.siteKey].push(row);
  }
  return index;
}

export function setRows(rows, meta = {}) {
  store.rows = rows;
  store.bySite = indexBySite(rows);
  if (meta.status) store.status = meta.status;
  if (meta.quality) store.quality = meta.quality;
  if (meta.fetchedAt) store.lastFetched = meta.fetchedAt;
  if (meta.serverMeta) store.serverMeta = { ...store.serverMeta, ...meta.serverMeta };
  emit("rows");
}

export function setStatus(status, error = null) {
  store.status = status;
  store.lastError = error;
  emit("status");
}

export function setFilters(patch) {
  store.filters = { ...store.filters, ...patch };
  emit("filters");
}

export function setRoute(route) {
  store.route = route;
  emit("route");
}

export function setGithub(github) {
  store.github = github;
  emit("github");
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(topic) {
  for (const fn of listeners) {
    try {
      fn(topic, store);
    } catch (err) {
      console.error("[store] listener failed", err);
    }
  }
}
