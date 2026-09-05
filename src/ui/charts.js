// Chart.js wrapper for time series. Instances are reused (data swap + update) instead
// of destroyed and recreated on every refresh.
import { cssVar } from "./dom.js";
import { formatNumber } from "../format.js";

const instances = new Map();

function theme() {
  return {
    text: cssVar("--text-muted", "#8b93a8"),
    grid: cssVar("--hairline", "rgba(220,230,255,0.06)"),
    tooltipBg: cssVar("--surface-2", "#11141f"),
    tooltipText: cssVar("--text", "#e9ecf3"),
    accent: cssVar("--accent", "#00f5d4"),
    mono: "'JetBrains Mono', ui-monospace, monospace",
  };
}

export function hasChartLib() {
  return typeof window !== "undefined" && typeof window.Chart === "function";
}

function baseOptions({ stacked, yLabel, tickFormat, t }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        display: true,
        position: "bottom",
        labels: { color: t.text, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "rect", font: { family: t.mono, size: 10 }, padding: 12 },
      },
      tooltip: {
        backgroundColor: t.tooltipBg,
        titleColor: t.tooltipText,
        bodyColor: t.text,
        borderColor: t.accent,
        borderWidth: 1,
        padding: 10,
        titleFont: { family: t.mono, size: 11 },
        bodyFont: { family: t.mono, size: 11 },
        callbacks: {
          label(ctx) {
            return ` ${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`;
          },
          footer(items) {
            if (!stacked || items.length < 2) return "";
            const total = items.reduce((sum, i) => sum + (i.parsed.y || 0), 0);
            return `Total: ${formatNumber(total)}`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: !!stacked,
        grid: { display: false },
        // An explicit `callback: undefined` overrides Chart.js' default category formatter
        // (labels would render as indices), so the key is only set when provided.
        ticks: { color: t.text, font: { family: t.mono, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12, ...(tickFormat ? { callback: (v, i, ticks) => tickFormat(v, i, ticks) } : {}) },
        border: { color: t.grid },
      },
      y: {
        stacked: !!stacked,
        beginAtZero: true,
        grid: { color: t.grid },
        ticks: { color: t.text, font: { family: t.mono, size: 10 }, precision: 0, callback: (v) => formatNumber(v) },
        border: { display: false },
        title: yLabel ? { display: true, text: yLabel, color: t.text, font: { family: t.mono, size: 10 } } : undefined,
      },
    },
  };
}

// datasets: [{ label, data, color, fill }]
export function lineChart(canvas, { labels, datasets, stacked = false, yLabel = "", tickFormat = null, bars = false }) {
  if (!canvas) return null;
  if (!hasChartLib()) {
    // Chart.js failed to load: say so instead of leaving a blank panel.
    const wrap = canvas.parentElement;
    const empty = wrap?.querySelector(".chart-empty");
    if (wrap) wrap.classList.add("is-empty");
    if (empty) empty.textContent = "Biblioteca de gráficos não carregou (vendor/chart.umd.min.js)";
    return null;
  }
  const t = theme();
  const chartDatasets = datasets.map((d) => ({
    label: d.label,
    data: d.data,
    borderColor: d.color,
    backgroundColor: bars ? d.color : toAlpha(d.color, stacked ? 0.35 : 0.12),
    fill: bars ? false : (d.fill ?? (stacked ? (datasets.length > 1 ? "-1" : "origin") : "origin")),
    tension: 0.25,
    borderWidth: bars ? 0 : 1.5,
    pointRadius: 0,
    pointHoverRadius: 3,
    type: bars ? "bar" : "line",
    stack: stacked ? "total" : undefined,
  }));
  if (stacked && !bars && chartDatasets.length) chartDatasets[0].fill = "origin";

  const existing = instances.get(canvas);
  const options = baseOptions({ stacked, yLabel, tickFormat, t });
  options.plugins.legend.display = datasets.length > 1;
  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets = chartDatasets;
    existing.options = options;
    existing.update("none");
    return existing;
  }
  const chart = new window.Chart(canvas, { type: bars ? "bar" : "line", data: { labels, datasets: chartDatasets }, options });
  instances.set(canvas, chart);
  return chart;
}

export function destroyChart(canvas) {
  const chart = instances.get(canvas);
  if (chart) {
    chart.destroy();
    instances.delete(canvas);
  }
}

export function destroyAllCharts() {
  for (const canvas of Array.from(instances.keys())) destroyChart(canvas);
}

function toAlpha(color, alpha) {
  const c = String(color || "");
  if (!c.startsWith("#")) return c;
  const hex = c.slice(1);
  const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
