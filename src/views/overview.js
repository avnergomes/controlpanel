// Visão geral: "o ecossistema está saudável e para onde vai a atenção?"
import { byId, h, replace, emptyState } from "../ui/dom.js";
import { kpiCard, barList, healthPill, healthHint } from "../ui/cards.js";
import { lineChart } from "../ui/charts.js";
import { renderHeatmap } from "../ui/heatmap.js";
import { renderWorldMap } from "../ui/worldmap.js";
import { SITES, siteOf } from "../sites.js";
import { setFilters } from "../store.js";
import { navigate } from "../router.js";
import {
  windowStats, dailySeries, hourlySeries, bucketSeries, filterPeriod, topPages, channels,
  geoSplit, topN, loadStats, heatmap, healthSummary, DAY,
} from "../analytics.js";
import { formatNumber, formatCompact, formatMs, formatRelative, formatDayMonth, formatTime, truncate, formatPct } from "../format.js";
import { share } from "../analytics.js";

const PERIOD_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

export function bindOverview(onChange) {
  const select = byId("ov-period");
  if (select) {
    select.addEventListener("change", () => {
      setFilters({ overviewPeriod: select.value });
      onChange();
    });
  }
}

export function renderOverview({ store, now, offsetMinutes, healthBySite }) {
  const period = store.filters.overviewPeriod || "7d";
  const select = byId("ov-period");
  if (select && select.value !== period) select.value = period;
  const rows = store.rows;
  const periodRows = filterPeriod(rows, period, now);
  const periodLabel = { "24h": "24 h", "7d": "7 dias", "30d": "30 dias", "90d": "90 dias" }[period] || period;
  document.querySelectorAll("[data-ov-period-label]").forEach((el) => { el.textContent = periodLabel; });

  renderKpis(rows, now, offsetMinutes, healthBySite);
  renderAlerts(healthBySite, now);
  renderSeries(periodRows, period, now, offsetMinutes);
  renderRanking(store, now, offsetMinutes, healthBySite, period);
  renderPages(periodRows);
  renderChannels(periodRows);
  renderGeo(periodRows);
  renderDevices(periodRows);
  renderHeatmap(byId("ov-heatmap"), heatmap(periodRows, offsetMinutes), { zoneLabel: "America/Sao_Paulo" });
  renderPerf(store, periodRows);
  renderWorldMap(byId("ov-map"), periodRows, { now });
}

function renderKpis(rows, now, offsetMinutes, healthBySite) {
  const target = byId("ov-kpis");
  if (!target) return;
  if (rows.length === 0) {
    replace(target, emptyState("Nenhum dado recebido ainda."));
    return;
  }
  const stats = windowStats(rows, now, offsetMinutes);
  const summary = healthSummary(healthBySite);
  const spark14 = dailySeries(rows, 14, now, offsetMinutes).counts;
  const spark24h = hourlySeries(rows, 24, now).counts;
  replace(target,
    kpiCard({ label: "Hoje", value: formatNumber(stats.today), delta: stats.todayVsYesterday, deltaLabel: "vs ontem até a mesma hora", sub: `ontem inteiro: ${formatNumber(stats.yesterdayFull)}`, spark: spark24h, big: true }),
    kpiCard({ label: "Últimos 7 dias", value: formatNumber(stats.d7), delta: stats.d7Variation, deltaLabel: "vs 7 dias anteriores", sub: `${formatNumber(Math.round(stats.d7 / 7))} por dia`, spark: spark14, big: true }),
    kpiCard({ label: "Últimos 30 dias", value: formatNumber(stats.d30), delta: stats.d30Variation, deltaLabel: "vs 30 dias anteriores", sub: `${formatNumber(Math.round(stats.d30 / 30))} por dia` }),
    kpiCard({ label: "Sites ativos 24 h", value: `${summary.active24h}/${SITES.length}`, sub: `${summary.live} ao vivo · ${summary.quiet + summary.stale + summary.silent} sem tráfego recente`, tone: summary.active24h === 0 ? "bad" : undefined }),
    kpiCard({ label: "Alertas de tracking", value: String(summary.alerts.length), sub: summary.alerts.length ? "ver painel de saúde" : "todos os coletores respondendo", tone: summary.alerts.length ? "warn" : "ok" }),
    kpiCard({ label: "Total histórico", value: formatCompact(stats.total), sub: stats.firstTs ? `desde ${formatDayMonth(stats.firstTs)} ${stats.firstTs.getFullYear()}` : "" }),
  );
}

function renderAlerts(healthBySite, now) {
  const target = byId("ov-alerts");
  if (!target) return;
  const problems = Object.entries(healthBySite)
    .filter(([, health]) => ["error", "missing", "silent", "stale"].includes(health.state))
    .sort((a, b) => severity(a[1].state) - severity(b[1].state));
  if (problems.length === 0) {
    replace(target, h("p", { class: "ok-line", text: "Todos os sites enviaram pageviews nos últimos 7 dias e o proxy leu todas as planilhas." }));
    return;
  }
  const list = h("ul", { class: "alert-list", attrs: { role: "list" } });
  for (const [siteKey, health] of problems) {
    const site = siteOf(siteKey);
    list.appendChild(h("li", { class: `alert alert--${health.state}` },
      healthPill(health.state),
      h("a", { class: "alert-site", text: site ? site.name : siteKey, attrs: { href: `#/${siteKey}` } }),
      h("span", { class: "alert-detail", text: health.lastTs ? `último pageview ${formatRelative(health.lastTs, now)} atrás` : healthHint(health.state) }),
    ));
  }
  replace(target, list);
}

function severity(state) {
  return { error: 0, missing: 1, silent: 2, stale: 3 }[state] ?? 9;
}

function renderSeries(periodRows, period, now, offsetMinutes) {
  const canvas = byId("ov-series");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  if (periodRows.length === 0) {
    wrap.classList.add("is-empty");
    return;
  }
  wrap.classList.remove("is-empty");
  const granularity = period === "24h" ? "hour" : "day";
  const days = PERIOD_DAYS[period] || 7;
  const { buckets, series, totals } = bucketSeriesWindow(periodRows, granularity, now, offsetMinutes, days);

  // Top 6 sites in the period, everything else grouped as "Outros".
  const ranked = Object.entries(series).map(([key, values]) => [key, values.reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 6).map(([key]) => key);
  const others = ranked.slice(6).map(([key]) => key);
  const datasets = top.map((key) => {
    const site = siteOf(key);
    return { label: site ? site.short : key, data: series[key], color: site ? site.color : "#8b93a8" };
  });
  if (others.length) {
    datasets.push({ label: "Outros", data: totals.map((_, i) => others.reduce((sum, key) => sum + series[key][i], 0)), color: "#4a5169" });
  }
  const labels = buckets.map((b) => (granularity === "hour" ? `${String(b.getUTCHours()).padStart(2, "0")}h` : `${String(b.getUTCDate()).padStart(2, "0")}/${String(b.getUTCMonth() + 1).padStart(2, "0")}`));
  lineChart(canvas, { labels, datasets, stacked: true, bars: true });
}

// bucketSeries over the exact window (gap-filled to `now`), so the last bucket is today.
function bucketSeriesWindow(rows, granularity, now, offsetMinutes, days) {
  const result = bucketSeries(rows, granularity, offsetMinutes);
  if (!result.buckets.length) return result;
  // Pad the tail up to the current bucket so the chart always ends "now".
  const last = result.buckets[result.buckets.length - 1].getTime();
  const nowBucket = granularity === "hour"
    ? Math.floor((now.getTime() + offsetMinutes * 60000) / 3600000) * 3600000
    : Math.floor((now.getTime() + offsetMinutes * 60000) / DAY) * DAY;
  const step = granularity === "hour" ? 3600000 : DAY;
  const missing = Math.max(0, Math.min(days * (granularity === "hour" ? 24 : 1), Math.round((nowBucket - last) / step)));
  if (missing === 0) return result;
  const buckets = [...result.buckets];
  const totals = [...result.totals];
  const series = {};
  for (let i = 1; i <= missing; i += 1) {
    buckets.push(new Date(last + i * step));
    totals.push(0);
  }
  for (const [key, values] of Object.entries(result.series)) series[key] = [...values, ...new Array(missing).fill(0)];
  return { buckets, series, totals };
}

function renderRanking(store, now, offsetMinutes, healthBySite, period) {
  const target = byId("ov-ranking");
  if (!target) return;
  const items = SITES.map((site) => {
    const rows = store.bySite[site.key] || [];
    const inPeriod = filterPeriod(rows, period, now);
    const health = healthBySite[site.key];
    return {
      key: site.key,
      label: site.name,
      value: inPeriod.length,
      color: site.color,
      sub: health && health.lastTs ? `último ${formatRelative(health.lastTs, now)}` : "sem dados",
      onClick: () => navigate({ view: "site", siteKey: site.key }),
    };
  }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));
  replace(target, barList(items, { ariaLabel: "Ranking de sites por pageviews no período", empty: "Nenhum pageview no período" }));
}

function renderPages(rows) {
  const target = byId("ov-pages");
  if (!target) return;
  const items = topPages(rows, 10).map((page) => {
    const site = siteOf(page.siteKey);
    return {
      key: `${page.siteKey}${page.path}`,
      label: `${site ? site.short : page.siteKey} · ${truncate(page.path || "/", 48)}`,
      title: page.title || page.path,
      value: page.count,
      color: site ? site.color : undefined,
    };
  });
  replace(target, barList(items, { total: rows.length, ariaLabel: "Páginas mais acessadas" }));
}

function renderChannels(rows) {
  const target = byId("ov-channels");
  if (!target) return;
  const items = channels(rows).map(([label, value]) => ({ key: label, label, value }));
  replace(target, barList(items, { total: rows.length, ariaLabel: "Canais de origem" }));
}

function renderGeo(rows) {
  const target = byId("ov-geo");
  if (!target) return;
  const total = rows.length;
  const split = geoSplit(rows).filter(([, v]) => v > 0);
  const regions = topN(rows.filter((r) => r.timezone), (r) => r.timezone, 6).map(([label, value]) => ({ key: label, label, value }));
  const summary = h("p", { class: "geo-summary" },
    ...split.map(([label, value]) => h("span", { class: "geo-chip" }, h("b", { text: label }), ` ${formatPct(share(value, total))}`)),
  );
  replace(target, summary, barList(regions, { total, ariaLabel: "Fusos horários mais frequentes" }));
}

function renderDevices(rows) {
  const target = byId("ov-devices");
  if (!target) return;
  const devices = topN(rows, (r) => r.deviceType || "Unknown", 4).map(([label, value]) => ({ key: label, label, value }));
  const themes = topN(rows.filter((r) => r.prefersColorScheme), (r) => (String(r.prefersColorScheme).toLowerCase() === "dark" ? "Escuro" : "Claro"), 2).map(([label, value]) => ({ key: label, label: `Tema ${label.toLowerCase()}`, value }));
  replace(target, barList([...devices, ...themes], { total: rows.length, ariaLabel: "Dispositivos e tema" }));
}

function renderPerf(store, periodRows) {
  const target = byId("ov-perf");
  if (!target) return;
  const items = SITES.map((site) => {
    const rows = periodRows.filter((r) => r.siteKey === site.key);
    const stats = loadStats(rows);
    return stats.n >= 3 ? { key: site.key, label: site.short, value: stats.p95, color: site.color, sub: `p50 ${formatMs(stats.p50)} · n=${stats.n}` } : null;
  }).filter(Boolean).sort((a, b) => b.value - a.value);
  replace(target, barList(items, { valueFormat: formatMs, showShare: false, ariaLabel: "Tempo de carga p95 por site", empty: "Sem medições de tempo de carga no período" }));
}

export function overviewRowsForExport(store) {
  return filterPeriod(store.rows, store.filters.overviewPeriod || "7d");
}

// Exposed for tests.
export const _internal = { bucketSeriesWindow, severity };
export { formatTime };
