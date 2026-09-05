import { describe, it, expect } from "vitest";
import { packRows, unpackRows } from "../../src/cache.js";
import { referrerHosts, languageOf } from "../../src/analytics.js";

const FIELDS = [
  "siteKey", "ts", "url", "path", "referrer", "timezone", "timezoneOffset", "sessionId",
  "language", "deviceType", "connectionType", "loadTime", "pageTitle", "screenOrientation",
  "prefersColorScheme", "utmSource", "utmMedium", "utmCampaign", "utmTerm", "utmContent",
  "os", "browser", "returning",
];

describe("cache pack/unpack", () => {
  it("round-trips the fields the UI needs and drops the rest", () => {
    const row = {
      siteKey: "d3d", ts: new Date("2026-09-01T10:00:00Z"), url: "https://d3dinovacao.github.io/x", path: "/x", referrer: "direct",
      timezone: "America/Sao_Paulo", timezoneOffset: 180, sessionId: "", language: "pt-BR", deviceType: "Mobile", connectionType: "",
      loadTime: 900, pageTitle: "X", screenOrientation: "portrait", prefersColorScheme: "dark", utmSource: "", utmMedium: "", utmCampaign: "",
      utmTerm: "", utmContent: "", os: "Android", browser: "Chrome", returning: undefined, userAgent: "secret UA", screenWidth: 400,
    };
    const packed = packRows([row]);
    expect(packed[0]).toHaveLength(FIELDS.length);
    expect(JSON.stringify(packed)).not.toContain("secret UA");
    const [back] = unpackRows(FIELDS, packed);
    expect(back.ts.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(back.path).toBe("/x");
    expect(back.loadTime).toBe(900);
    expect(back.connectionType).toBe("");
    expect(back.isMobile).toBe(true);
    expect(back.userAgent).toBeUndefined();
    expect(back.screenWidth).toBeNull();
  });

  it("skips rows whose timestamp is corrupted", () => {
    const rows = unpackRows(FIELDS, [["d3d", "garbage", ...new Array(FIELDS.length - 2).fill(null)]]);
    expect(rows).toEqual([]);
  });
});

describe("referrerHosts + languageOf", () => {
  const row = (referrer, language = "pt-BR") => ({ ts: new Date(), siteKey: "d3d", referrer, language });
  it("excludes direct and internal referrers", () => {
    const rows = [row("direct"), row("https://datageoparana.github.io/"), row("https://www.google.com/"), row("https://www.google.com/x"), row("https://t.co/abc")];
    expect(referrerHosts(rows)).toEqual([["google.com", 2], ["t.co", 1]]);
  });
  it("normalizes languages to the primary subtag", () => {
    expect(languageOf(row("", "pt-BR"))).toBe("pt");
    expect(languageOf(row("", "PT_br"))).toBe("pt");
    expect(languageOf(row("", "en"))).toBe("en");
    expect(languageOf(row("", ""))).toBe("Unknown");
  });
});
