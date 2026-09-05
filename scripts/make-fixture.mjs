// Deterministic synthetic telemetry + GitHub fixtures for tests and the ?mock=1 mode.
// Usage: node scripts/make-fixture.mjs [--now 2026-09-05T12:00:00Z] [--out tests/fixtures]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITES } from "../src/sites.js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const now = new Date(argOf("--now", new Date().toISOString()));
const outDir = resolve(argOf("--out", "tests/fixtures"));

// mulberry32: tiny seeded PRNG so fixtures are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMEZONES = ["America/Sao_Paulo", "America/Sao_Paulo", "America/Sao_Paulo", "America/Cuiaba", "America/Recife", "America/New_York", "Europe/Lisbon", "Europe/Berlin", "Asia/Kolkata", "America/Buenos_Aires"];
const LANGS = ["pt-BR", "pt-BR", "pt-BR", "en-US", "es-ES"];
const DEVICES = ["desktop", "desktop", "mobile", "mobile", "tablet"];
const REFERRERS = ["direct", "direct", "https://www.google.com/", "https://www.linkedin.com/", "https://datageoparana.github.io/", "https://chatgpt.com/", "https://www.bing.com/"];
const CONN = ["4g", "4g", "wifi", "3g", ""];
const PATHS = ["/", "/", "/", "/mapa", "/tabela", "/sobre", "/produtos", "/regionais/oeste", "/serie-historica", "/exportar"];

const DAY = 86400000;

// Per-site profile: daily volume and recency behaviour to exercise every health state.
const PROFILES = {
  datageoparana: { perDay: 40, lastDaysAgo: 0 },
  "vbp-parana": { perDay: 28, lastDaysAgo: 0 },
  "precos-diarios": { perDay: 35, lastDaysAgo: 0 },
  "precos-florestais": { perDay: 12, lastDaysAgo: 0.2 },
  "precos-terras": { perDay: 9, lastDaysAgo: 0.5 },
  "comexstat-parana": { perDay: 7, lastDaysAgo: 2 },
  "emprego-agro-parana": { perDay: 6, lastDaysAgo: 3 },
  "censo-parana": { perDay: 5, lastDaysAgo: 1 },
  "credito-rural-parana": { perDay: 4, lastDaysAgo: 9 },      // stale
  "saude-parana": { perDay: 3, lastDaysAgo: 0.1 },
  "seguranca-parana": { perDay: 2, lastDaysAgo: 21 },         // silent
  "c2-parana": { perDay: 3, lastDaysAgo: 0.05 },
  portfolio: { perDay: 15, lastDaysAgo: 0.01 },
  cwbtopo: { perDay: 4, lastDaysAgo: 0.3, serverError: true }, // proxy error
  "dayane-psicologia": { perDay: 6, lastDaysAgo: 0.02 },
  d3d: { perDay: 0, lastDaysAgo: null, missing: true },        // absent from proxy SITES
};

function hourWeight(hour) {
  // Business-hours bias in BRT (UTC-3): peak 09-18 local = 12-21 UTC.
  const local = (hour - 3 + 24) % 24;
  if (local >= 9 && local <= 18) return 1.6;
  if (local >= 7 && local <= 22) return 0.9;
  return 0.25;
}

function makeRows(site, profile, random) {
  const rows = [];
  if (!profile.perDay || profile.lastDaysAgo === null) return rows;
  const lastTs = now.getTime() - profile.lastDaysAgo * DAY;
  for (let day = 120; day >= 0; day -= 1) {
    const dayStart = now.getTime() - day * DAY;
    const weekday = new Date(dayStart).getUTCDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.45 : 1;
    const trend = 0.7 + (120 - day) / 120 * 0.6; // slow growth over time
    const count = Math.round(profile.perDay * weekendFactor * trend * (0.6 + random() * 0.8));
    for (let i = 0; i < count; i += 1) {
      const hour = Math.floor(random() * 24);
      if (random() > hourWeight(hour) / 1.6) continue;
      const ts = dayStart - random() * DAY;
      if (ts > lastTs) continue;
      const tz = TIMEZONES[Math.floor(random() * TIMEZONES.length)];
      const path = PATHS[Math.floor(random() * PATHS.length)];
      const utm = random() < 0.08;
      rows.push({
        timestamp: new Date(ts).toISOString(),
        timezone: tz,
        timezoneOffset: tz === "America/Sao_Paulo" ? 180 : tz === "Europe/Berlin" ? -120 : 0,
        page: `${site.url.replace(/\/$/, "")}${path}`,
        pathname: path,
        referrer: REFERRERS[Math.floor(random() * REFERRERS.length)],
        pageTitle: `${site.name} · ${path === "/" ? "Início" : path.slice(1)}`,
        language: LANGS[Math.floor(random() * LANGS.length)],
        deviceType: DEVICES[Math.floor(random() * DEVICES.length)],
        screenOrientation: random() < 0.6 ? "landscape" : "portrait",
        connectionType: CONN[Math.floor(random() * CONN.length)],
        loadTime: Math.round(400 + random() * random() * 4200),
        utmSource: utm ? "linkedin" : "",
        utmMedium: utm ? "social" : "",
        utmCampaign: utm ? "lancamento-2026" : "",
        utmTerm: "",
        utmContent: "",
        prefersColorScheme: random() < 0.55 ? "dark" : "light",
      });
    }
  }
  return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function toColumnar(rows) {
  const headers = Object.keys(rows[0] || { timestamp: "" });
  return { headers, values: rows.map((r) => headers.map((h) => r[h])) };
}

function buildPayload() {
  const random = rng(20260905);
  const sites = {};
  SITES.forEach((site, index) => {
    const profile = PROFILES[site.key] || { perDay: 5, lastDaysAgo: 0 };
    if (profile.missing) return;
    if (profile.serverError) {
      sites[site.key] = { name: site.name, kind: site.kind, rows: [], status: "error", error: "Exception: Planilha não encontrada" };
      return;
    }
    const rows = makeRows(site, profile, random);
    // Alternate legacy (objects) and columnar formats to exercise both client paths.
    sites[site.key] = index % 2 === 0
      ? { name: site.name, kind: site.kind, rows, status: "ok" }
      : { name: site.name, kind: site.kind, status: "ok", ...toColumnar(rows) };
  });
  return { fetchedAt: now.toISOString(), version: "3.0-mock", sites };
}

function buildGithub() {
  const iso = (daysAgo) => new Date(now.getTime() - daysAgo * DAY).toISOString();
  const repo = (owner, name, extra = {}) => ({
    fullName: `${owner}/${name}`, name, owner, description: extra.description || "", language: extra.language || "JavaScript",
    stars: extra.stars || 0, forks: 0, openIssues: extra.openIssues || 0, hasPages: extra.hasPages !== false, archived: !!extra.archived,
    fork: !!extra.fork, pushedAt: iso(extra.pushedDays ?? 3), updatedAt: iso(extra.pushedDays ?? 3), createdAt: iso(400),
    htmlUrl: `https://github.com/${owner}/${name}`, homepage: extra.homepage || "", size: 1200, defaultBranch: "main",
  });
  const repos = [
    ...SITES.map((site, i) => {
      const [owner, name] = site.repo.split("/");
      return repo(owner, name, { pushedDays: i * 2, openIssues: i % 3 === 0 ? 20 : 0, stars: i % 4 === 0 ? 1 : 0, homepage: site.url });
    }),
    repo("avnergomes", "controlpanel", { pushedDays: 0, openIssues: 4 }),
    repo("avnergomes", "clt-brasil", { pushedDays: 40, language: "HTML" }),
    repo("avnergomes", "serra-do-mar-webgis", { pushedDays: 51, language: "HTML", stars: 1, description: "Interactive 3D Web GIS of the Serra do Mar" }),
    repo("avnergomes", "casa-sempre-ganha", { pushedDays: 59, language: "HTML", description: "Relatório interativo trilíngue sobre apostas online" }),
    repo("avnergomes", "parana-rural-access-equity", { pushedDays: 66, language: "HTML" }),
    repo("avnergomes", "aguasegura", { pushedDays: 115, description: "Programa Água Segura" }),
    repo("avnergomes", "BDGeo", { pushedDays: 230, hasPages: false, language: "" }),
    repo("avnergomes", "rtv", { pushedDays: 320, hasPages: false, language: "Python" }),
    repo("avnergomes", "old-experiment", { pushedDays: 500, archived: true }),
    repo("avnergomes", "some-fork", { pushedDays: 100, fork: true }),
  ];
  return { accounts: [{ account: "avnergomes", count: repos.length }], repos, remaining: 55 };
}

mkdirSync(outDir, { recursive: true });
const payload = buildPayload();
writeFileSync(resolve(outDir, "payload.json"), JSON.stringify(payload));
writeFileSync(resolve(outDir, "github.json"), JSON.stringify(buildGithub()));
const total = Object.values(payload.sites).reduce((sum, s) => sum + (s.rows ? s.rows.length : s.values.length), 0);
console.log(`fixtures written to ${outDir}: ${Object.keys(payload.sites).length} sites, ${total} rows, now=${now.toISOString()}`);
