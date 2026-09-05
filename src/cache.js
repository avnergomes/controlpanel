// localStorage persistence. Every read/write is guarded: storage may be full, disabled
// or corrupted, and the app must keep working without it.
//
// Rows are cached in a compact columnar form (one header list + one array per row),
// limited to the most recent rows that fit the quota. A partial cache is flagged so the
// next refresh asks the proxy for the full history instead of a delta.
import { CONFIG } from "./config.js";

const MAX_BYTES = 4_500_000; // stay under common 5 MB quotas
const MAX_ROWS = 40_000;

// Fields worth persisting (userAgent, screen size and paint timings are dropped: LGPD
// minimization and they are not used by any view).
const FIELDS = [
  "siteKey", "ts", "url", "path", "referrer", "timezone", "timezoneOffset", "sessionId",
  "language", "deviceType", "connectionType", "loadTime", "pageTitle", "screenOrientation",
  "prefersColorScheme", "utmSource", "utmMedium", "utmCampaign", "utmTerm", "utmContent",
  "os", "browser", "returning",
];

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

function write(key, value) {
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_BYTES) return false;
    localStorage.setItem(key, json);
    return true;
  } catch {
    return false;
  }
}

export function packRows(rows) {
  return rows.map((row) => FIELDS.map((field) => {
    const v = row[field];
    if (field === "ts") return row.ts.toISOString();
    return v === undefined || v === "" ? null : v;
  }));
}

export function unpackRows(fields, values) {
  const out = [];
  for (const cells of values) {
    const row = {};
    fields.forEach((field, i) => {
      const v = cells[i];
      row[field] = v === null || v === undefined ? (field === "loadTime" || field === "timezoneOffset" || field === "returning" ? (field === "returning" ? undefined : null) : "") : v;
    });
    row.ts = new Date(row.ts);
    if (Number.isNaN(row.ts.getTime())) continue;
    row.isMobile = row.deviceType === "Mobile";
    row.screenWidth = null;
    row.screenHeight = null;
    row.firstContentfulPaint = null;
    row.domInteractiveTime = null;
    row.userAgent = undefined;
    out.push(row);
  }
  return out;
}

// Rows must be sorted by time ascending (they are, from the API layer).
export function saveRows(rows, meta) {
  let keep = rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload = {
      v: 7,
      fetchedAt: meta.fetchedAt ? new Date(meta.fetchedAt).toISOString() : null,
      status: meta.status || {},
      serverMeta: meta.serverMeta || null,
      partial: keep.length < rows.length,
      fields: FIELDS,
      values: packRows(keep),
    };
    if (write(CONFIG.cacheKey, payload)) return { saved: true, rows: keep.length, partial: payload.partial };
    keep = keep.slice(Math.floor(keep.length / 2));
    if (keep.length < 500) break;
  }
  return { saved: false, rows: 0, partial: true };
}

export function loadRows(maxAgeMinutes = CONFIG.cacheMinutes) {
  const cached = read(CONFIG.cacheKey);
  if (!cached || cached.v !== 7 || !Array.isArray(cached.values)) return null;
  const fetchedAt = cached.fetchedAt ? new Date(cached.fetchedAt) : null;
  const ageMinutes = fetchedAt ? (Date.now() - fetchedAt.getTime()) / 60000 : Infinity;
  const rows = unpackRows(cached.fields || FIELDS, cached.values);
  return {
    rows,
    fetchedAt,
    status: cached.status || {},
    serverMeta: cached.serverMeta || null,
    partial: !!cached.partial,
    stale: ageMinutes > maxAgeMinutes,
  };
}

export function saveGithub(payload) {
  return write(CONFIG.githubCacheKey, { savedAt: new Date().toISOString(), payload });
}

export function loadGithub(maxAgeMinutes = CONFIG.githubCacheMinutes) {
  const cached = read(CONFIG.githubCacheKey);
  if (!cached || !cached.payload) return null;
  const savedAt = new Date(cached.savedAt);
  const ageMinutes = (Date.now() - savedAt.getTime()) / 60000;
  return { payload: cached.payload, savedAt, stale: ageMinutes > maxAgeMinutes };
}

export function readFlag(key, fallback = false) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch { /* ignore */ }
}

export function clearAll() {
  try {
    localStorage.removeItem(CONFIG.cacheKey);
    localStorage.removeItem(CONFIG.githubCacheKey);
    // Legacy keys from previous versions.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("controlpanel-cache-") || key.startsWith("controlpanel-geojson")) localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
