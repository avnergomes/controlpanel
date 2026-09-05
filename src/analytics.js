// Pure analytics over normalized pageview records. No DOM, no globals, deterministic
// given (rows, now, offsetMinutes). offsetMinutes = minutes EAST of UTC of the
// reference time zone (America/Sao_Paulo = -180), so "today" means the owner's today.
import { geoBucket } from "./geo.js";
import { normalizeReferrer, referrerGroup } from "./normalize.js";

export const HOUR = 3600000;
export const DAY = 86400000;

// ── time helpers (zone-aware without Intl in the hot path) ────────────────

// Shift an instant so that UTC getters return wall-clock parts of the reference zone.
export function shifted(date, offsetMinutes) {
  return new Date(date.getTime() + offsetMinutes * 60000);
}

// UTC instant at which the reference-zone day containing `date` starts.
export function zoneDayStart(date, offsetMinutes) {
  const local = date.getTime() + offsetMinutes * 60000;
  const localMidnight = Math.floor(local / DAY) * DAY;
  return new Date(localMidnight - offsetMinutes * 60000);
}

export function zoneDayKey(date, offsetMinutes) {
  const s = shifted(date, offsetMinutes);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
}

// ── windows & variation ────────────────────────────────────────────────────

export function variation(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// One pass over rows for every headline window. Rows may be unsorted.
export function windowStats(rows, now = new Date(), offsetMinutes = 0) {
  const nowMs = now.getTime();
  const todayStart = zoneDayStart(now, offsetMinutes).getTime();
  const yesterdayStart = todayStart - DAY;
  const yesterdaySameTime = nowMs - DAY;
  const stats = {
    total: rows.length,
    today: 0,
    yesterdayToNow: 0,
    yesterdayFull: 0,
    last1h: 0,
    last24h: 0,
    prev24h: 0,
    d7: 0,
    prev7: 0,
    d30: 0,
    prev30: 0,
    firstTs: null,
    lastTs: null,
  };
  for (const row of rows) {
    const t = row.ts.getTime();
    if (stats.firstTs === null || t < stats.firstTs) stats.firstTs = t;
    if (stats.lastTs === null || t > stats.lastTs) stats.lastTs = t;
    if (t > nowMs) continue;
    const age = nowMs - t;
    if (t >= todayStart) stats.today += 1;
    if (t >= yesterdayStart && t < todayStart) {
      stats.yesterdayFull += 1;
      if (t < yesterdaySameTime) stats.yesterdayToNow += 1;
    }
    if (age < HOUR) stats.last1h += 1;
    if (age < DAY) stats.last24h += 1;
    else if (age < 2 * DAY) stats.prev24h += 1;
    if (age < 7 * DAY) stats.d7 += 1;
    else if (age < 14 * DAY) stats.prev7 += 1;
    if (age < 30 * DAY) stats.d30 += 1;
    else if (age < 60 * DAY) stats.prev30 += 1;
  }
  return {
    ...stats,
    firstTs: stats.firstTs === null ? null : new Date(stats.firstTs),
    lastTs: stats.lastTs === null ? null : new Date(stats.lastTs),
    todayVsYesterday: variation(stats.today, stats.yesterdayToNow),
    d7Variation: variation(stats.d7, stats.prev7),
    d30Variation: variation(stats.d30, stats.prev30),
  };
}

// ── series ────────────────────────────────────────────────────────────────

// Counts per reference-zone day for the last `days` days (oldest first, gaps = 0).
export function dailySeries(rows, days, now = new Date(), offsetMinutes = 0) {
  const todayStart = zoneDayStart(now, offsetMinutes).getTime();
  const firstStart = todayStart - (days - 1) * DAY;
  const counts = new Array(days).fill(0);
  for (const row of rows) {
    const t = row.ts.getTime();
    if (t < firstStart || t > now.getTime()) continue;
    const index = Math.floor((t - firstStart) / DAY);
    if (index >= 0 && index < days) counts[index] += 1;
  }
  const labels = counts.map((_, i) => new Date(firstStart + i * DAY));
  return { labels, counts };
}

// Counts per hour for the last `hours` hours ending now (oldest first).
export function hourlySeries(rows, hours, now = new Date()) {
  const end = Math.floor(now.getTime() / HOUR) * HOUR + HOUR;
  const start = end - hours * HOUR;
  const counts = new Array(hours).fill(0);
  for (const row of rows) {
    const t = row.ts.getTime();
    if (t < start || t >= end) continue;
    counts[Math.floor((t - start) / HOUR)] += 1;
  }
  const labels = counts.map((_, i) => new Date(start + i * HOUR));
  return { labels, counts };
}

function bucketOf(date, granularity, offsetMinutes) {
  const s = shifted(date, offsetMinutes);
  const y = s.getUTCFullYear();
  const m = s.getUTCMonth();
  const d = s.getUTCDate();
  const h = s.getUTCHours();
  if (granularity === "hour") return Date.UTC(y, m, d, h);
  if (granularity === "month") return Date.UTC(y, m, 1);
  return Date.UTC(y, m, d);
}

function nextBucket(bucketMs, granularity) {
  if (granularity === "hour") return bucketMs + HOUR;
  if (granularity === "month") {
    const d = new Date(bucketMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return bucketMs + DAY;
}

// Time series bucketed by hour/day/month, split per site, gap-filled between first and
// last bucket. `buckets` are "shifted UTC" instants: use getUTC* to read wall-clock parts.
export function bucketSeries(rows, granularity = "day", offsetMinutes = 0, maxBuckets = 2000) {
  const perSite = new Map();
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const b = bucketOf(row.ts, granularity, offsetMinutes);
    if (b < min) min = b;
    if (b > max) max = b;
    let siteMap = perSite.get(row.siteKey);
    if (!siteMap) {
      siteMap = new Map();
      perSite.set(row.siteKey, siteMap);
    }
    siteMap.set(b, (siteMap.get(b) || 0) + 1);
  }
  if (!Number.isFinite(min)) return { buckets: [], series: {}, totals: [] };

  const buckets = [];
  for (let b = min; b <= max && buckets.length < maxBuckets; b = nextBucket(b, granularity)) buckets.push(b);

  const series = {};
  const totals = new Array(buckets.length).fill(0);
  for (const [siteKey, siteMap] of perSite) {
    series[siteKey] = buckets.map((b, i) => {
      const n = siteMap.get(b) || 0;
      totals[i] += n;
      return n;
    });
  }
  return { buckets: buckets.map((b) => new Date(b)), series, totals };
}

// ── distributions ─────────────────────────────────────────────────────────

export function countBy(rows, accessor) {
  const map = new Map();
  for (const row of rows) {
    const key = accessor(row) || "Unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

export function topN(rows, accessor, n = 8) {
  return Array.from(countBy(rows, accessor).entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n);
}

export function topPages(rows, n = 10) {
  const pages = new Map();
  for (const row of rows) {
    const path = row.path || row.url || "/";
    const key = `${row.siteKey}|${path}`;
    const entry = pages.get(key);
    if (entry) {
      entry.count += 1;
      if (row.ts > entry.lastTs) {
        entry.lastTs = row.ts;
        if (row.pageTitle) entry.title = row.pageTitle;
      }
    } else {
      pages.set(key, { siteKey: row.siteKey, path, title: row.pageTitle || "", count: 1, lastTs: row.ts });
    }
  }
  return Array.from(pages.values())
    .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
    .slice(0, n);
}

// External referrer hosts only: direct and ecosystem-internal navigation are reported
// through channels() so they do not crowd out real acquisition sources.
export function referrerHosts(rows, n = 8) {
  const external = rows.filter((row) => {
    const group = referrerGroup(row.referrer);
    return group !== "Direto" && group !== "Interno";
  });
  return topN(external, (row) => normalizeReferrer(row.referrer), n);
}

// Primary language subtag ("pt-BR", "pt-br", "pt" → "pt"); empty stays "Unknown".
export function languageOf(row) {
  const raw = String(row.language || "").trim().toLowerCase();
  if (!raw) return "Unknown";
  return raw.split(/[-_]/)[0];
}

export function channels(rows) {
  const order = ["Direto", "Busca", "Social", "IA", "GitHub", "Interno", "Outros"];
  const counts = countBy(rows, (row) => referrerGroup(row.referrer));
  return order.map((name) => [name, counts.get(name) || 0]).filter(([, count]) => count > 0);
}

export function campaigns(rows, n = 8) {
  const map = new Map();
  for (const row of rows) {
    if (!row.utmCampaign && !row.utmSource) continue;
    const key = `${row.utmCampaign || "—"}|${row.utmSource || "—"}|${row.utmMedium || "—"}`;
    const entry = map.get(key);
    if (entry) entry.count += 1;
    else map.set(key, { campaign: row.utmCampaign || "—", source: row.utmSource || "—", medium: row.utmMedium || "—", count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, n);
}

export function geoSplit(rows) {
  const counts = countBy(rows, (row) => geoBucket(row.timezone));
  return ["Brasil", "Exterior", "Desconhecido"].map((k) => [k, counts.get(k) || 0]);
}

export function share(count, total) {
  return total > 0 ? (count / total) * 100 : 0;
}

// ── performance ───────────────────────────────────────────────────────────

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

// Load-time percentiles; values above 2 minutes are treated as measurement noise.
export function loadStats(rows, maxMs = 120000) {
  const values = [];
  for (const row of rows) {
    const v = row.loadTime;
    if (v !== null && v !== undefined && v > 0 && v <= maxMs) values.push(v);
  }
  return { n: values.length, p50: percentile(values, 50), p95: percentile(values, 95) };
}

// ── heatmap ───────────────────────────────────────────────────────────────

// 7 x 24 matrix (Sunday first) of pageviews by reference-zone weekday and hour.
export function heatmap(rows, offsetMinutes = 0) {
  const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let max = 0;
  for (const row of rows) {
    const s = shifted(row.ts, offsetMinutes);
    const d = s.getUTCDay();
    const h = s.getUTCHours();
    matrix[d][h] += 1;
    if (matrix[d][h] > max) max = matrix[d][h];
  }
  return { matrix, max };
}

// ── health ────────────────────────────────────────────────────────────────

export const HEALTH_ORDER = ["error", "silent", "stale", "quiet", "active", "live", "empty"];

// Tracking health for one site. `serverStatus` is the proxy's per-site status.
export function siteHealth(rows, serverStatus, now = new Date(), options = {}) {
  const silentAfterDays = options.silentAfterDays ?? 14;
  const offsetMinutes = options.offsetMinutes ?? 0;
  const stats = windowStats(rows, now, offsetMinutes);
  let state = "empty";
  if (serverStatus === "error") state = "error";
  else if (stats.lastTs) {
    const age = now.getTime() - stats.lastTs.getTime();
    if (age < HOUR) state = "live";
    else if (age < DAY) state = "active";
    else if (age < 7 * DAY) state = "quiet";
    else if (age < silentAfterDays * DAY) state = "stale";
    else state = "silent";
  }
  return { state, ...stats };
}

export function healthSummary(healthBySite) {
  const summary = { live: 0, active: 0, quiet: 0, stale: 0, silent: 0, empty: 0, error: 0, active24h: 0, alerts: [] };
  for (const [siteKey, health] of Object.entries(healthBySite)) {
    summary[health.state] = (summary[health.state] || 0) + 1;
    if (health.state === "live" || health.state === "active") summary.active24h += 1;
    if (health.state === "error" || health.state === "silent" || health.state === "stale") summary.alerts.push(siteKey);
  }
  return summary;
}

// ── filters ───────────────────────────────────────────────────────────────

export function resolvePeriod(period, now = new Date()) {
  const days = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[period];
  if (!days) return { start: null, end: null };
  return { start: new Date(now.getTime() - days * DAY), end: now };
}

export function filterPeriod(rows, period, now = new Date()) {
  const { start, end } = resolvePeriod(period, now);
  if (!start) return rows;
  return rows.filter((row) => row.ts >= start && row.ts <= end);
}

export function latest(rows, n = 25) {
  return [...rows].sort((a, b) => b.ts - a.ts).slice(0, n);
}

export function maxTimestamp(rows) {
  let max = null;
  for (const row of rows) if (!max || row.ts > max) max = row.ts;
  return max;
}
