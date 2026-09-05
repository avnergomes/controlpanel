import { describe, it, expect } from "vitest";
import { parseRoute, routeHash } from "../../src/router.js";
import { toCsv } from "../../src/export.js";
import { untrackedPages, pagesUrl, summarize } from "../../src/views/github.js";
import { SITES, siteByRepo, OWN_HOSTS } from "../../src/sites.js";
import { FIELD_SCHEMAS } from "../../src/schemas.js";
import { formatRelative, formatDelta, formatMs, formatCompact } from "../../src/format.js";
import { regionOf, geoBucket, zoneOffsetMinutes } from "../../src/geo.js";

describe("router", () => {
  it("parses overview, github and site routes (old and new forms)", () => {
    expect(parseRoute("")).toEqual({ view: "overview", siteKey: null });
    expect(parseRoute("#/overview")).toEqual({ view: "overview", siteKey: null });
    expect(parseRoute("#/github")).toEqual({ view: "github", siteKey: null });
    expect(parseRoute("#/vbp-parana")).toEqual({ view: "site", siteKey: "vbp-parana" });
    expect(parseRoute("#/site/vbp-parana/")).toEqual({ view: "site", siteKey: "vbp-parana" });
    expect(parseRoute("#/nope").view).toBe("overview");
  });

  it("round-trips through routeHash", () => {
    for (const hash of ["#/overview", "#/github", "#/d3d"]) expect(routeHash(parseRoute(hash))).toBe(hash);
  });
});

describe("sites registry", () => {
  it("has unique keys, codes and colors, and every kind has a schema", () => {
    const keys = new Set(SITES.map((s) => s.key));
    const codes = new Set(SITES.map((s) => s.code));
    const colors = new Set(SITES.map((s) => s.color.toLowerCase()));
    expect(keys.size).toBe(SITES.length);
    expect(codes.size).toBe(SITES.length);
    expect(colors.size).toBe(SITES.length);
    for (const site of SITES) expect(FIELD_SCHEMAS[site.kind], site.kind).toBeDefined();
  });

  it("cross-references repos case-insensitively", () => {
    expect(siteByRepo("AvnerGomes/VBP-Parana").key).toBe("vbp-parana");
    expect(siteByRepo("x/y")).toBeNull();
    expect(OWN_HOSTS).toContain("datageoparana.github.io");
  });
});

describe("export", () => {
  it("writes a BOM, CRLF lines, quotes and neutralizes formulas", () => {
    const csv = toCsv([{ ts: new Date("2026-01-01T00:00:00Z"), siteKey: "d3d", url: "u", path: '=SUM(1)', pageTitle: 'He said "hi"', referrer: "", timezone: "", language: "", deviceType: "", connectionType: "", prefersColorScheme: "", screenOrientation: "", loadTime: null, utmSource: "", utmMedium: "", utmCampaign: "" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('"Data (UTC)";"Data (America/Sao_Paulo)";"Site"')).toBe(true);
    expect(lines[1]).toContain('"\'=SUM(1)"');
    expect(lines[1]).toContain('"He said ""hi"""');
  });
});

describe("github helpers", () => {
  const NOW = new Date("2026-09-05T12:00:00Z");
  const repo = (owner, name, extra = {}) => ({ fullName: `${owner}/${name}`, owner, name, hasPages: true, archived: false, fork: false, pushedAt: "2026-09-01T00:00:00Z", openIssues: 0, stars: 0, homepage: "", ...extra });

  it("untrackedPages lists Pages repos not in the registry, newest push first", () => {
    const repos = [
      repo("avnergomes", "vbp-parana"),
      repo("avnergomes", "clt-brasil", { pushedAt: "2026-08-01T00:00:00Z" }),
      repo("avnergomes", "serra", { pushedAt: "2026-08-20T00:00:00Z" }),
      repo("avnergomes", "nopages", { hasPages: false }),
      repo("avnergomes", "archived", { archived: true }),
      repo("avnergomes", "fork", { fork: true }),
    ];
    expect(untrackedPages(repos).map((r) => r.name)).toEqual(["serra", "clt-brasil"]);
  });

  it("pagesUrl handles user sites, project sites and homepage overrides", () => {
    expect(pagesUrl(repo("cwbtopo", "cwbtopo.github.io"))).toBe("https://cwbtopo.github.io/");
    expect(pagesUrl(repo("avnergomes", "clt-brasil"))).toBe("https://avnergomes.github.io/clt-brasil/");
    expect(pagesUrl(repo("a", "b", { homepage: "https://x.dev" }))).toBe("https://x.dev");
  });

  it("summarize counts monitored, untracked and stale repos", () => {
    const s = summarize([repo("avnergomes", "vbp-parana", { openIssues: 3, stars: 1 }), repo("avnergomes", "old", { pushedAt: "2026-01-01T00:00:00Z" })], NOW);
    expect(s).toMatchObject({ total: 2, withPages: 2, monitored: 1, untracked: 1, stale: 1, openIssues: 3, stars: 1, pushedLast7d: 1 });
  });
});

describe("format + geo", () => {
  it("formatRelative buckets", () => {
    const now = new Date("2026-09-05T12:00:00Z");
    expect(formatRelative(new Date("2026-09-05T11:59:30Z"), now)).toBe("agora");
    expect(formatRelative(new Date("2026-09-05T11:15:00Z"), now)).toBe("45 min");
    expect(formatRelative(new Date("2026-09-05T02:00:00Z"), now)).toBe("10 h");
    expect(formatRelative(new Date("2026-09-01T12:00:00Z"), now)).toBe("4 d");
    expect(formatRelative(null, now)).toBe("nunca");
  });

  it("formatDelta / formatMs / formatCompact", () => {
    expect(formatDelta(12.4)).toBe("+12%");
    expect(formatDelta(-0.4)).toBe("0%");
    expect(formatDelta(null)).toBe("—");
    expect(formatMs(850)).toBe("850 ms");
    expect(formatMs(2345)).toBe("2.35 s");
    expect(formatCompact(999)).toBe("999");
  });

  it("regionOf / geoBucket", () => {
    expect(regionOf("America/Sao_Paulo").region).toBe("Brasil");
    expect(regionOf("Asia/Tashkent").region).toBe("Outros");
    expect(regionOf("").region).toBe("Desconhecido");
    expect(geoBucket("Europe/Paris")).toBe("Exterior");
  });

  it("zoneOffsetMinutes for Sao Paulo is -180 (no DST since 2019)", () => {
    expect(zoneOffsetMinutes("America/Sao_Paulo", new Date("2026-09-05T12:00:00Z"))).toBe(-180);
    expect(zoneOffsetMinutes("UTC", new Date("2026-09-05T12:00:00Z"))).toBe(0);
  });
});
