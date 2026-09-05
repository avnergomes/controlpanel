// Toast notifications, top progress bar and sync status indicator.
import { byId } from "./dom.js";
import { formatDateTime } from "../format.js";

let toastTimer = null;

export function showToast(message, { tone = "info", timeout = 4500 } = {}) {
  const toast = byId("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show toast--${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), timeout);
}

export function setLoading(isLoading) {
  const bar = byId("progress");
  if (bar) bar.classList.toggle("active", !!isLoading);
  document.body.classList.toggle("is-loading", !!isLoading);
}

// state: 'ok' | 'error' | 'stale' | 'loading'
export function setSyncStatus(state, { lastFetched = null, message = "" } = {}) {
  const dot = byId("status-dot");
  const label = byId("status-label");
  const updated = byId("updated-at");
  if (dot) dot.className = `status-dot status-dot--${state}`;
  if (label) label.textContent = { ok: "LIVE", error: "FALHA", stale: "CACHE", loading: "SYNC" }[state] || state;
  if (updated) {
    updated.textContent = lastFetched ? formatDateTime(lastFetched) : "--:--";
    updated.setAttribute("datetime", lastFetched ? new Date(lastFetched).toISOString() : "");
    updated.title = message || "";
  }
}
