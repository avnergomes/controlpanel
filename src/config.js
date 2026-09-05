// Runtime configuration. The proxy URL comes from config.local.js (window.LOCAL_CONFIG),
// generated in CI from the TRACKING_URL secret and kept out of this module.
const LOCAL = (typeof window !== "undefined" && window.LOCAL_CONFIG) || {};

export const CONFIG = Object.freeze({
  proxyUrl: LOCAL.proxyUrl || "",
  // Polling: refresh while the tab is visible, pause when hidden, catch up on focus.
  pollMs: 120000,
  pollFirstMs: 45000,
  // Local cache of normalized rows (minutes) and GitHub metadata (minutes).
  cacheMinutes: 30,
  githubCacheMinutes: 30,
  // Reference time zone for hour-of-day analytics (owner's zone, not the viewer's).
  timeZone: "America/Sao_Paulo",
  // Rows shown in "latest" tables.
  maxLatest: 25,
  // Sites considered "silent" after this many days without a pageview.
  silentAfterDays: 14,
  // Localstorage keys (bump when the shape changes).
  cacheKey: "controlpanel-cache-v7",
  githubCacheKey: "controlpanel-github-v1",
  sessionKey: "controlpanel-session-token",
  notifyKey: "controlpanel-notify",
});

export function isLocalhost() {
  if (typeof location === "undefined") return false;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

// Mock mode: only on localhost with ?mock=1, serves tests/fixtures instead of the proxy.
export function isMockMode() {
  if (!isLocalhost()) return false;
  try {
    return new URLSearchParams(location.search).get("mock") === "1";
  } catch {
    return false;
  }
}
