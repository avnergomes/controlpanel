import { describe, it, expect } from "vitest";
import {
  windowStats, variation, dailySeries, hourlySeries, bucketSeries, topN, topPages, channels,
  campaigns, geoSplit, percentile, loadStats, heatmap, siteHealth, healthSummary, filterPeriod,
  latest, maxTimestamp, zoneDayStart, zoneDayKey, DAY, HOUR,
} from "../../src/analytics.js";

const NOW = new Date("2026-09-05T15:30:00.000Z"); // 12:30 in America/Sao_Paulo
const SP = -180;

const row = (minutesAgo, extra = {}) => ({
  siteKey: "vbp-parana",
  ts: new Date(NOW.getTime() - minutesAgo * 60000),
  path: "/",
  referrer: "direct",
  timezone: "America/Sao_Paulo",
  loadTime: null,
  ...extra,
});

describe("zone helpers", () => {
  it("zoneDayStart returns local midnight as a UTC instant", () => {
    // 12:30 BRT on 2026-09-05 -> midnight BRT = 03:00Z same day
    expect(zoneDayStart(NOW, SP).toISOString()).toBe("2026-09-05T03:00:00.000Z");
    // 01:00Z on 2026-09-05 is still 2026-09-04 22:00 in BRT
    expect(zoneDayKey(new Date("2026-09-05T01:00:00.000Z"), SP)).toBe("2026-09-04");
  });
});

describe("windowStats", () => {
  it("computes fixed windows and comparisons in a single pass", () => {
    const rows = [
      row(10), row(30),                 // today, last hour
      row(60 * 5),                      // today (07:30 BRT)
      row(60 * 20),                     // yesterday 16:30 BRT (after same-time cut)
      row(60 * 26),                     // yesterday 10:30 BRT (before same-time cut)
      row(60 * 24 * 3),                 // 3 days ago
      row(60 * 24 * 10),                // 10 days ago (prev7)
      row(60 * 24 * 45),                // 45 days ago (prev30)
    ];
    const s = windowStats(rows, NOW, SP);
    expect(s.total).toBe(8);
    expect(s.today).toBe(3);
    expect(s.last1h).toBe(2);
    expect(s.yesterdayFull).toBe(2);
    expect(s.yesterdayToNow).toBe(1);
    expect(s.d7).toBe(6);
    expect(s.prev7).toBe(1);
    expect(s.d30).toBe(7);
    expect(s.prev30).toBe(1);
    expect(s.todayVsYesterday).toBe(200);
    expect(s.lastTs.getTime()).toBe(rows[0].ts.getTime());
  });

  it("ignores rows in the future for windows but keeps them in lastTs", () => {
    const s = windowStats([row(-120)], NOW, SP);
    expect(s.today).toBe(0);
    expect(s.total).toBe(1);
  });

  it("variation returns null without a baseline", () => {
    expect(variation(5, 0)).toBeNull();
    expect(variation(5, 10)).toBe(-50);
  });
});

describe("series", () => {
  it("dailySeries fills gaps and ends today", () => {
    const { labels, counts } = dailySeries([row(0), row(60 * 24 * 2), row(60 * 24 * 2)], 4, NOW, SP);
    expect(counts).toEqual([0, 2, 0, 1]);
    expect(labels[3].toISOString()).toBe("2026-09-05T03:00:00.000Z");
  });

  it("hourlySeries counts the last N hours", () => {
    const { counts } = hourlySeries([row(5), row(65), row(60 * 30)], 3, NOW);
    expect(counts).toEqual([0, 1, 1]);
  });

  it("bucketSeries splits per site and gap-fills days", () => {
    const rows = [row(0), row(60 * 24 * 2, { siteKey: "portfolio" })];
    const { buckets, series, totals } = bucketSeries(rows, "day", SP);
    expect(buckets).toHaveLength(3);
    expect(series["portfolio"]).toEqual([1, 0, 0]);
    expect(series["vbp-parana"]).toEqual([0, 0, 1]);
    expect(totals).toEqual([1, 0, 1]);
  });

  it("bucketSeries month granularity", () => {
    const rows = [row(0), row(60 * 24 * 40)];
    const { buckets } = bucketSeries(rows, "month", SP);
    expect(buckets).toHaveLength(3); // July (40 days ago), August (gap), September
    expect(buckets[0].getUTCMonth()).toBe(6);
    expect(buckets[2].getUTCMonth()).toBe(8);
  });

  it("bucketSeries returns empty structure for no rows", () => {
    expect(bucketSeries([], "day", SP)).toEqual({ buckets: [], series: {}, totals: [] });
  });
});

describe("distributions", () => {
  it("topN sorts by count then label", () => {
    const rows = [row(0, { language: "pt" }), row(0, { language: "en" }), row(0, { language: "pt" }), row(0, { language: "" })];
    expect(topN(rows, (r) => r.language || "Unknown", 2)).toEqual([["pt", 2], ["en", 1]]);
    expect(topN(rows, (r) => r.language || "Unknown", 3)[2]).toEqual(["Unknown", 1]);
  });

  it("topPages aggregates by site+path and keeps the latest title", () => {
    const rows = [row(10, { path: "/a", pageTitle: "old" }), row(0, { path: "/a", pageTitle: "new" }), row(0, { path: "/b" })];
    const pages = topPages(rows, 5);
    expect(pages[0]).toMatchObject({ path: "/a", count: 2, title: "new" });
  });

  it("channels, campaigns and geoSplit", () => {
    const rows = [
      row(0, { referrer: "https://www.google.com/" }),
      row(0, { referrer: "direct", utmCampaign: "c1", utmSource: "s", utmMedium: "m" }),
      row(0, { referrer: "direct", utmCampaign: "c1", utmSource: "s", utmMedium: "m", timezone: "Europe/Lisbon" }),
      row(0, { timezone: "" }),
    ];
    expect(channels(rows)).toEqual([["Direto", 3], ["Busca", 1]]);
    expect(campaigns(rows)).toEqual([{ campaign: "c1", source: "s", medium: "m", count: 2 }]);
    expect(geoSplit(rows)).toEqual([["Brasil", 2], ["Exterior", 1], ["Desconhecido", 1]]);
  });
});

describe("performance", () => {
  it("percentile uses nearest-rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });

  it("loadStats ignores nulls, zeros and absurd values", () => {
    const rows = [row(0, { loadTime: 500 }), row(0, { loadTime: 0 }), row(0, { loadTime: null }), row(0, { loadTime: 999999 }), row(0, { loadTime: 1500 })];
    expect(loadStats(rows)).toEqual({ n: 2, p50: 500, p95: 1500 });
  });
});

describe("heatmap", () => {
  it("places rows by reference-zone weekday and hour", () => {
    // 2026-09-05T15:30Z = Saturday 12:30 BRT
    const { matrix, max } = heatmap([row(0), row(0)], SP);
    expect(matrix[6][12]).toBe(2);
    expect(max).toBe(2);
  });
});

describe("health", () => {
  it("classifies recency states", () => {
    expect(siteHealth([row(10)], "ok", NOW).state).toBe("live");
    expect(siteHealth([row(60 * 5)], "ok", NOW).state).toBe("active");
    expect(siteHealth([row(60 * 24 * 2)], "ok", NOW).state).toBe("quiet");
    expect(siteHealth([row(60 * 24 * 9)], "ok", NOW).state).toBe("stale");
    expect(siteHealth([row(60 * 24 * 20)], "ok", NOW).state).toBe("silent");
    expect(siteHealth([], "ok", NOW).state).toBe("empty");
    expect(siteHealth([row(1)], "error", NOW).state).toBe("error");
    expect(siteHealth([row(60 * 24 * 9)], "ok", NOW, { silentAfterDays: 8 }).state).toBe("silent");
  });

  it("healthSummary counts active sites and alerts", () => {
    const summary = healthSummary({ a: { state: "live" }, b: { state: "stale" }, c: { state: "error" }, d: { state: "quiet" } });
    expect(summary.active24h).toBe(1);
    expect(summary.alerts).toEqual(["b", "c"]);
  });
});

describe("filters", () => {
  it("filterPeriod and latest", () => {
    const rows = [row(0), row(60 * 24 * 8), row(60 * 24 * 40)];
    expect(filterPeriod(rows, "7d", NOW)).toHaveLength(1);
    expect(filterPeriod(rows, "30d", NOW)).toHaveLength(2);
    expect(filterPeriod(rows, "all", NOW)).toHaveLength(3);
    expect(latest(rows, 2).map((r) => r.ts.getTime())).toEqual([rows[0].ts.getTime(), rows[1].ts.getTime()]);
    expect(maxTimestamp(rows).getTime()).toBe(rows[0].ts.getTime());
    expect(maxTimestamp([])).toBeNull();
  });

  it("constants", () => {
    expect(DAY).toBe(24 * HOUR);
  });
});
