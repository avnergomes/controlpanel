// Raw spreadsheet rows → normalized pageview records. Pure functions, no DOM.
import { FIELD_SCHEMAS, RETURNING_FIELDS, RETURNING_PATTERN } from "./schemas.js";
import { OWN_HOSTS } from "./sites.js";

const TIMESTAMP_PATTERN = /^(timestamp|time|date|data|hora|created|criado)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function parseBool(value) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "sim" || s === "1";
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) || n < 0 ? null : n;
}

export function normalizeDeviceType(value) {
  if (!value) return "Unknown";
  const s = String(value).toLowerCase();
  if (s.includes("tablet") || s.includes("ipad")) return "Tablet";
  if (s.includes("mobile")) return "Mobile";
  if (s.includes("desktop")) return "Desktop";
  return "Unknown";
}

export function parseUserAgent(ua) {
  const v = String(ua || "").toLowerCase();
  let os = "";
  let browser = "";
  let deviceType = "Desktop";
  if (v.includes("android")) os = "Android";
  else if (v.includes("iphone") || v.includes("ipad")) os = "iOS";
  else if (v.includes("mac os")) os = "macOS";
  else if (v.includes("windows")) os = "Windows";
  else if (v.includes("linux")) os = "Linux";

  if (v.includes("edg/")) browser = "Edge";
  else if (v.includes("chrome") && !v.includes("chromium")) browser = "Chrome";
  else if (v.includes("safari") && !v.includes("chrome")) browser = "Safari";
  else if (v.includes("firefox")) browser = "Firefox";

  if (v.includes("ipad") || v.includes("tablet")) deviceType = "Tablet";
  else if (v.includes("mobi") || v.includes("android") || v.includes("iphone")) deviceType = "Mobile";
  return { os, browser, deviceType };
}

export function extractPath(url) {
  if (!url) return "";
  try {
    return new URL(url).pathname || "";
  } catch {
    return "";
  }
}

// Build a lowercase lookup once per row; every getValue call reuses it.
function lowerLookup(row) {
  const out = {};
  for (const key of Object.keys(row)) out[key.toLowerCase()] = row[key];
  return out;
}

function pick(lookup, names) {
  if (!names || names.length === 0) return null;
  for (const name of names) {
    const v = lookup[name.toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function pickByPattern(row, pattern) {
  for (const key of Object.keys(row)) {
    if (pattern.test(key)) {
      const v = row[key];
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return null;
}

// Public alias kept for tests/back-compat: case-insensitive name lookup with pattern fallback.
export function getValue(row, names, fallbackPattern = null) {
  const value = pick(lowerLookup(row), names);
  if (value !== null) return value;
  return fallbackPattern ? pickByPattern(row, fallbackPattern) : null;
}

function findTimestamp(row, lookup, schema) {
  let ts = parseDate(pick(lookup, schema.timestamp));
  if (!ts) ts = parseDate(pickByPattern(row, TIMESTAMP_PATTERN));
  if (!ts) {
    for (const key of Object.keys(row)) {
      const v = row[key];
      if (typeof v === "string" && ISO_DATE.test(v)) {
        ts = parseDate(v);
        if (ts) break;
      }
    }
  }
  return ts;
}

export function normalizeRow(row, siteKey, kind, schema = FIELD_SCHEMAS[kind]) {
  if (!row || typeof row !== "object" || !schema) return null;
  const lookup = lowerLookup(row);
  const ts = findTimestamp(row, lookup, schema);
  if (!ts) return null;

  const url = String(pick(lookup, schema.url) || "");
  const userAgent = String(pick(lookup, schema.userAgent) || "");
  const derived = userAgent ? parseUserAgent(userAgent) : { os: "", browser: "", deviceType: "" };

  const timezone = schema.timezonePattern
    ? pick(lookup, schema.timezone) || pickByPattern(row, schema.timezonePattern) || ""
    : pick(lookup, schema.timezone) || "";

  const deviceType = normalizeDeviceType(pick(lookup, schema.deviceType) || derived.deviceType);
  const isMobileRaw = schema.isMobile?.length ? parseBool(pick(lookup, schema.isMobile)) : undefined;

  const returning = kind === "emprego"
    ? undefined
    : parseBool(pick(lookup, RETURNING_FIELDS) ?? pickByPattern(row, RETURNING_PATTERN));

  return {
    siteKey,
    ts,
    url,
    path: String(pick(lookup, schema.path) || extractPath(url) || ""),
    referrer: String(pick(lookup, schema.referrer) || ""),
    timezone: String(timezone),
    timezoneOffset: toNumberSigned(pick(lookup, schema.timezoneOffset)),
    sessionId: String(pick(lookup, schema.sessionId) || ""),
    userAgent: userAgent || undefined,
    os: String(pick(lookup, schema.os) || derived.os || ""),
    browser: String(pick(lookup, schema.browser) || derived.browser || ""),
    deviceType,
    isMobile: isMobileRaw === undefined ? deviceType === "Mobile" : isMobileRaw,
    language: String(pick(lookup, schema.language) || ""),
    connectionType: String(pick(lookup, schema.connectionType) || ""),
    screenWidth: toNumber(pick(lookup, schema.screenWidth)),
    screenHeight: toNumber(pick(lookup, schema.screenHeight)),
    loadTime: toNumber(pick(lookup, schema.loadTime)),
    firstContentfulPaint: toNumber(pick(lookup, schema.firstContentfulPaint)),
    domInteractiveTime: toNumber(pick(lookup, schema.domInteractiveTime)),
    utmSource: String(pick(lookup, schema.utmSource) || ""),
    utmMedium: String(pick(lookup, schema.utmMedium) || ""),
    utmCampaign: String(pick(lookup, schema.utmCampaign) || ""),
    utmTerm: String(pick(lookup, schema.utmTerm) || ""),
    utmContent: String(pick(lookup, schema.utmContent) || ""),
    pageTitle: String(pick(lookup, schema.pageTitle) || ""),
    screenOrientation: String(pick(lookup, schema.screenOrientation) || ""),
    prefersColorScheme: String(pick(lookup, schema.prefersColorScheme) || ""),
    returning,
  };
}

// timezoneOffset is minutes WEST of UTC (Date#getTimezoneOffset semantics) and may be negative.
function toNumberSigned(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export function normalizeSiteRows(site, rows) {
  if (!site || !Array.isArray(rows)) return [];
  const schema = FIELD_SCHEMAS[site.kind];
  if (!schema) return [];
  const out = [];
  for (const row of rows) {
    const record = normalizeRow(row, site.key, site.kind, schema);
    if (record) out.push(record);
  }
  return out;
}

// Columnar payload ({headers, values}) → array of objects, without touching the input.
export function columnarToObjects(headers, values) {
  if (!Array.isArray(headers) || !Array.isArray(values)) return [];
  return values.map((cells) => {
    const obj = {};
    headers.forEach((header, i) => {
      if (header) obj[header] = cells[i];
    });
    return obj;
  });
}

export function dedupeKey(row) {
  return `${row.siteKey}|${row.ts.toISOString()}|${row.sessionId || ""}|${row.path || row.url || ""}`;
}

export function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || !row.ts) continue;
    const key = dedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function sortByTime(rows) {
  return [...rows].sort((a, b) => a.ts - b.ts);
}

export function normalizeReferrer(value) {
  if (!value || value === "direct" || value === "Direct") return "Direct";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return String(value);
  }
}

const SEARCH_HOSTS = /(google\.|bing\.com|duckduckgo\.com|yahoo\.|yandex\.|baidu\.com|ecosia\.org)/i;
const SOCIAL_HOSTS = /(linkedin\.|instagram\.com|facebook\.com|fb\.com|twitter\.com|x\.com|t\.co$|whatsapp\.com|youtube\.com|youtu\.be|reddit\.com|threads\.net|tiktok\.com|telegram)/i;
const AI_HOSTS = /(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google|copilot\.microsoft)/i;

// Acquisition channel derived from the referrer host (no personal data involved).
export function referrerGroup(value) {
  const host = normalizeReferrer(value);
  if (host === "Direct") return "Direto";
  if (OWN_HOSTS.includes(host)) return "Interno";
  if (host.endsWith("github.io") || host === "github.com") return "GitHub";
  if (SEARCH_HOSTS.test(host)) return "Busca";
  if (SOCIAL_HOSTS.test(host)) return "Social";
  if (AI_HOSTS.test(host)) return "IA";
  return "Outros";
}
