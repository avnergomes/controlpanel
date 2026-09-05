import { describe, it, expect } from "vitest";
import {
  normalizeRow, normalizeSiteRows, columnarToObjects, dedupeRows, parseBool, toNumber,
  normalizeDeviceType, parseUserAgent, normalizeReferrer, referrerGroup, getValue, sortByTime,
} from "../../src/normalize.js";
import { siteOf } from "../../src/sites.js";

const lgpdRow = {
  site: "Censo Parana",
  timestamp: "2026-09-04T13:05:00.000Z",
  timezone: "America/Sao_Paulo",
  timezoneOffset: 180,
  page: "https://datageoparana.github.io/censo-parana/mapa?x=1",
  pathname: "/censo-parana/mapa",
  referrer: "https://www.google.com/",
  pageTitle: "Censo · Mapa",
  language: "pt-BR",
  deviceType: "mobile",
  screenOrientation: "portrait",
  connectionType: "4g",
  loadTime: "1234",
  utmSource: "linkedin",
  utmMedium: "social",
  utmCampaign: "lancamento",
  utmTerm: "",
  utmContent: "",
  prefersColorScheme: "dark",
};

describe("normalizeRow", () => {
  it("maps the unified LGPD schema", () => {
    const row = normalizeRow(lgpdRow, "censo-parana", "lgpd");
    expect(row.siteKey).toBe("censo-parana");
    expect(row.ts.toISOString()).toBe("2026-09-04T13:05:00.000Z");
    expect(row.path).toBe("/censo-parana/mapa");
    expect(row.deviceType).toBe("Mobile");
    expect(row.isMobile).toBe(true);
    expect(row.loadTime).toBe(1234);
    expect(row.timezoneOffset).toBe(180);
    expect(row.utmCampaign).toBe("lancamento");
    expect(row.prefersColorScheme).toBe("dark");
    expect(row.returning).toBeUndefined();
  });

  it("is case-insensitive on column names and falls back to url path", () => {
    const row = normalizeRow({ Timestamp: "2026-01-01T00:00:00Z", URL: "https://x.io/a/b", Language: "en" }, "portfolio", "portfolio");
    expect(row.path).toBe("/a/b");
    expect(row.language).toBe("en");
  });

  it("finds a timestamp by pattern or by ISO value when the header is unknown", () => {
    const byPattern = normalizeRow({ "Data de acesso": "2026-02-02T10:00:00Z", page: "/" }, "vbp-parana", "vbp");
    expect(byPattern.ts.toISOString()).toBe("2026-02-02T10:00:00.000Z");
    const byValue = normalizeRow({ weird: "2026-03-03T10:00:00Z", page: "/" }, "vbp-parana", "vbp");
    expect(byValue.ts.toISOString()).toBe("2026-03-03T10:00:00.000Z");
  });

  it("drops rows without a parsable timestamp", () => {
    expect(normalizeRow({ page: "/" }, "d3d", "lgpd")).toBeNull();
    expect(normalizeRow({ timestamp: "not a date" }, "d3d", "lgpd")).toBeNull();
    expect(normalizeRow(null, "d3d", "lgpd")).toBeNull();
  });

  it("derives os/browser/device from the user agent for legacy schemas", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const row = normalizeRow({ timestamp: "2026-01-01T00:00:00Z", "User Agent": ua }, "datageoparana", "datageo");
    expect(row.os).toBe("iOS");
    expect(row.browser).toBe("Safari");
    expect(row.deviceType).toBe("Mobile");
  });

  it("uses the VBP timezone pattern fallback", () => {
    const row = normalizeRow({ timestamp: "2026-01-01T00:00:00Z", "Fuso horário do visitante": "Europe/Lisbon" }, "vbp-parana", "vbp");
    expect(row.timezone).toBe("Europe/Lisbon");
  });

  it("does not mutate the input row", () => {
    const input = { ...lgpdRow };
    normalizeRow(input, "censo-parana", "lgpd");
    expect(input).toEqual(lgpdRow);
  });
});

describe("helpers", () => {
  it("parseBool / toNumber / normalizeDeviceType", () => {
    expect(parseBool("sim")).toBe(true);
    expect(parseBool("0")).toBe(false);
    expect(parseBool("")).toBeUndefined();
    expect(toNumber("-5")).toBeNull();
    expect(toNumber("12.5")).toBe(12.5);
    expect(normalizeDeviceType("iPad")).toBe("Tablet");
    expect(normalizeDeviceType("")).toBe("Unknown");
  });

  it("parseUserAgent detects Edge before Chrome", () => {
    expect(parseUserAgent("Mozilla/5.0 Windows Chrome/120 Safari/537 Edg/120").browser).toBe("Edge");
    expect(parseUserAgent("Mozilla/5.0 Windows Chrome/120 Safari/537").browser).toBe("Chrome");
  });

  it("normalizeReferrer strips www and handles direct", () => {
    expect(normalizeReferrer("https://www.google.com/search?q=x")).toBe("google.com");
    expect(normalizeReferrer("direct")).toBe("Direct");
    expect(normalizeReferrer("")).toBe("Direct");
    expect(normalizeReferrer("garbage")).toBe("garbage");
  });

  it("referrerGroup classifies channels", () => {
    expect(referrerGroup("direct")).toBe("Direto");
    expect(referrerGroup("https://www.google.com/")).toBe("Busca");
    expect(referrerGroup("https://www.linkedin.com/feed/")).toBe("Social");
    expect(referrerGroup("https://chatgpt.com/")).toBe("IA");
    expect(referrerGroup("https://datageoparana.github.io/")).toBe("Interno");
    expect(referrerGroup("https://someone.github.io/x")).toBe("GitHub");
    expect(referrerGroup("https://example.org/")).toBe("Outros");
  });

  it("getValue supports a fallback pattern", () => {
    expect(getValue({ "Fuso": "America/Manaus" }, [], /fuso/i)).toBe("America/Manaus");
    expect(getValue({ a: 1 }, ["b"])).toBeNull();
  });
});

describe("columnar + dedupe", () => {
  it("columnarToObjects builds objects and ignores empty headers", () => {
    const objects = columnarToObjects(["timestamp", "", "page"], [["2026-01-01T00:00:00Z", "x", "/a"], ["2026-01-02T00:00:00Z", "y", "/b"]]);
    expect(objects).toEqual([{ timestamp: "2026-01-01T00:00:00Z", page: "/a" }, { timestamp: "2026-01-02T00:00:00Z", page: "/b" }]);
    expect(columnarToObjects(null, null)).toEqual([]);
  });

  it("dedupeRows removes identical (site, ts, session, path) tuples and keeps order", () => {
    const site = siteOf("d3d");
    const rows = normalizeSiteRows(site, [
      { timestamp: "2026-01-01T00:00:00Z", pathname: "/" },
      { timestamp: "2026-01-01T00:00:00Z", pathname: "/" },
      { timestamp: "2026-01-01T00:00:00Z", pathname: "/x" },
    ]);
    expect(rows).toHaveLength(3);
    expect(dedupeRows(rows)).toHaveLength(2);
  });

  it("sortByTime returns a new sorted array", () => {
    const a = { ts: new Date("2026-01-02T00:00:00Z") };
    const b = { ts: new Date("2026-01-01T00:00:00Z") };
    const input = [a, b];
    const sorted = sortByTime(input);
    expect(sorted).toEqual([b, a]);
    expect(input[0]).toBe(a);
  });
});
