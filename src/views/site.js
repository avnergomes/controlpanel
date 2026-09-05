// Site view: one site, all its distributions and its latest pageviews.
import { byId, h, replace, emptyState } from "../ui/dom.js";
import { kpiCard, barList, healthPill } from "../ui/cards.js";
import { lineChart } from "../ui/charts.js";
import { renderHeatmap } from "../ui/heatmap.js";
import { renderWorldMap } from "../ui/worldmap.js";
import { siteOf, GROUPS } from "../sites.js";
import { setFilters } from "../store.js";
import {
  windowStats, dailySeries, bucketSeries, filterPeriod, topPages, referrerHosts, channels,
  campaigns, topN, loadStats, heatmap, latest, languageOf,
} from "../analytics.js";
import { normalizeReferrer } from "../normalize.js";
import { regionOf } from "../geo.js";
import { formatNumber, formatMs, formatRelative, formatDateTime, truncate } from "../format.js";
import { CONFIG } from "../config.js";

export function bindSite(onChange) {
  const period = byId("site-period");
  const granularity = byId("site-granularity");
  if (period) period.addEventListener("change", () => { setFilters({ period: period.value }); onChange(); });
  if (granularity) granularity.addEventListener("change", () => { setFilters({ granularity: granularity.value }); onChange(); });
}

export function renderSite({ store, siteKey, now, offsetMinutes, healthBySite }) {
  const site = siteOf(siteKey);
  if (!site) return;
  const rows = store.bySite[siteKey] || [];
  const period = store.filters.period || "30d";
  const requested = store.filters.granularity || "day";
  // Hourly buckets over more than 30 days are unreadable (and capped); coerce to days.
  const granularity = requested === "hour" && !["24h", "7d", "30d"].includes(period) ? "day" : requested;
  syncSelect("site-period", period);
  syncSelect("site-granularity", granularity);
  const periodRows = filterPeriod(rows, period, now);
  const health = healthBySite[siteKey];

  renderHeader(site, health, now, store.quality[siteKey]);
  renderKpis(rows, periodRows, now, offsetMinutes);

  if (rows.length === 0) {
    byId("site-body")?.classList.add("is-empty");
    replace(byId("site-empty"), emptyState(health && health.state === "missing"
      ? "Este site ainda não está na lista SITES do Apps Script: nada foi coletado."
      : "Nenhum pageview recebido para este site."));
    return;
  }
  byId("site-body")?.classList.remove("is-empty");
  replace(byId("site-empty"));

  renderSeries(site, periodRows, granularity, offsetMinutes);
  replace(byId("site-pages"), barList(topPages(periodRows, 10).map((p) => ({ key: p.path, label: truncate(p.path || "/", 56), title: p.title || p.path, value: p.count, sub: formatRelative(p.lastTs, now) })), { total: periodRows.length, ariaLabel: "Páginas mais acessadas" }));
  replace(byId("site-referrers"), barList(referrerHosts(periodRows, 8).map(([label, value]) => ({ key: label, label, value })), { total: periodRows.length, ariaLabel: "Referrers" }));
  replace(byId("site-channels"), barList(channels(periodRows).map(([label, value]) => ({ key: label, label, value })), { total: periodRows.length, ariaLabel: "Canais" }));
  replace(byId("site-campaigns"), barList(campaigns(periodRows, 8).map((c) => ({ key: `${c.campaign}|${c.source}`, label: c.campaign, sub: `${c.source} / ${c.medium}`, value: c.count })), { total: periodRows.length, ariaLabel: "Campanhas UTM", empty: "Nenhum acesso com UTM no período" }));
  replace(byId("site-devices"), barList(topN(periodRows, (r) => r.deviceType || "Unknown", 4).map(([label, value]) => ({ key: label, label, value })), { total: periodRows.length }));
  replace(byId("site-languages"), barList(topN(periodRows, languageOf, 6).map(([label, value]) => ({ key: label, label, value })), { total: periodRows.length }));
  replace(byId("site-connections"), barList(topN(periodRows.filter((r) => r.connectionType), (r) => r.connectionType, 5).map(([label, value]) => ({ key: label, label, value })), { total: periodRows.length, empty: "Sem dados de conexão" }));
  replace(byId("site-themes"), barList(topN(periodRows.filter((r) => r.prefersColorScheme), (r) => (String(r.prefersColorScheme).toLowerCase() === "dark" ? "Escuro" : "Claro"), 2).map(([label, value]) => ({ key: label, label, value })), { total: periodRows.length, empty: "Sem dados de tema" }));
  renderHeatmap(byId("site-heatmap"), heatmap(periodRows, offsetMinutes), { zoneLabel: "America/Sao_Paulo" });
  renderWorldMap(byId("site-map"), periodRows, { now });
  renderLatest(rows, now);
}

function syncSelect(id, value) {
  const el = byId(id);
  if (el && el.value !== value) el.value = value;
}

function renderHeader(site, health, now, quality) {
  const title = byId("site-title");
  const meta = byId("site-meta");
  if (title) title.textContent = site.name;
  if (!meta) return;
  const group = GROUPS.find((g) => g.key === site.group);
  replace(meta,
    health ? healthPill(health.state) : null,
    h("a", { class: "site-url mono", text: site.url.replace(/^https?:\/\//, ""), attrs: { href: site.url, target: "_blank", rel: "noopener" } }),
    h("a", { class: "site-repo mono", text: site.repo, attrs: { href: `https://github.com/${site.repo}`, target: "_blank", rel: "noopener" } }),
    group ? h("span", { class: "site-group", text: group.label }) : null,
    health && health.lastTs ? h("span", { class: "site-last", text: `último pageview ${formatRelative(health.lastTs, now)} atrás` }) : null,
    quality && quality.dropped > 0 ? h("span", { class: "site-quality", text: `${quality.dropped} linha(s) da planilha sem data válida ignoradas`, attrs: { title: "Qualidade: linhas recebidas do proxy que não puderam ser interpretadas" } }) : null,
    quality && quality.error ? h("span", { class: "site-quality", text: `proxy: ${quality.error}` }) : null,
  );
}

function renderKpis(rows, periodRows, now, offsetMinutes) {
  const target = byId("site-kpis");
  if (!target) return;
  const stats = windowStats(rows, now, offsetMinutes);
  const perf = loadStats(periodRows);
  replace(target,
    kpiCard({ label: "Hoje", value: formatNumber(stats.today), delta: stats.todayVsYesterday, deltaLabel: "vs ontem até a mesma hora" }),
    kpiCard({ label: "7 dias", value: formatNumber(stats.d7), delta: stats.d7Variation, deltaLabel: "vs 7 dias anteriores", spark: dailySeries(rows, 14, now, offsetMinutes).counts }),
    kpiCard({ label: "30 dias", value: formatNumber(stats.d30), delta: stats.d30Variation, deltaLabel: "vs 30 dias anteriores" }),
    kpiCard({ label: "No período", value: formatNumber(periodRows.length), sub: `de ${formatNumber(stats.total)} no histórico` }),
    kpiCard({ label: "Carga p95", value: formatMs(perf.p95), sub: perf.n ? `p50 ${formatMs(perf.p50)} · ${formatNumber(perf.n)} medições` : "sem medições" }),
  );
}

function renderSeries(site, periodRows, granularity, offsetMinutes) {
  const canvas = byId("site-series");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  if (periodRows.length === 0) {
    wrap.classList.add("is-empty");
    return;
  }
  wrap.classList.remove("is-empty");
  const { buckets, series } = bucketSeries(periodRows, granularity, offsetMinutes);
  const labels = buckets.map((b) => {
    if (granularity === "hour") return `${String(b.getUTCDate()).padStart(2, "0")}/${String(b.getUTCMonth() + 1).padStart(2, "0")} ${String(b.getUTCHours()).padStart(2, "0")}h`;
    if (granularity === "month") return `${String(b.getUTCMonth() + 1).padStart(2, "0")}/${b.getUTCFullYear()}`;
    return `${String(b.getUTCDate()).padStart(2, "0")}/${String(b.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  lineChart(canvas, { labels, datasets: [{ label: site.short, data: series[site.key] || [], color: site.color }], bars: granularity !== "hour" && buckets.length <= 62 });
}

function renderLatest(rows, now) {
  const tbody = byId("site-latest");
  if (!tbody) return;
  const items = latest(rows, CONFIG.maxLatest);
  replace(tbody, items.map((row) => {
    const region = regionOf(row.timezone);
    return h("tr", {},
      h("td", { class: "mono", text: formatDateTime(row.ts), attrs: { title: `${formatRelative(row.ts, now)} atrás` } }),
      h("td", { class: "mono cell-path", text: truncate(row.path || row.url || "—", 60), attrs: { title: row.pageTitle || row.path } }),
      h("td", { text: normalizeReferrer(row.referrer) }),
      h("td", { text: `${region.flag} ${row.timezone || "—"}` }),
      h("td", { text: row.deviceType || "—" }),
      h("td", { text: row.language || "—" }),
      h("td", { class: "mono", text: formatMs(row.loadTime) }),
    );
  }));
}
