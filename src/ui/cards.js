// KPI cards and ranked bar lists (HTML, no canvas): readable, accessible, printable.
import { h, emptyState } from "./dom.js";
import { drawSparkline } from "./sparkline.js";
import { formatDelta, formatNumber, formatPct } from "../format.js";
import { share } from "../analytics.js";

function deltaChip(delta, label) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return h("span", { class: "delta neutral", text: "—", attrs: { title: label ? `${label}: sem base de comparação` : "" } });
  }
  const rounded = Math.round(delta);
  const tone = rounded > 0 ? "up" : rounded < 0 ? "down" : "neutral";
  return h("span", { class: `delta ${tone}`, text: formatDelta(delta), attrs: { title: label || "" } });
}

// { label, value, delta, deltaLabel, sub, spark, color, tone, big }
export function kpiCard(opts) {
  const card = h("article", { class: `kpi${opts.tone ? ` kpi--${opts.tone}` : ""}${opts.big ? " kpi--big" : ""}`, style: opts.color ? { "--kpi-color": opts.color } : undefined });
  card.appendChild(h("h3", { class: "kpi-label", text: opts.label }));
  const row = h("div", { class: "kpi-row" }, h("span", { class: "kpi-value", text: opts.value }));
  if (opts.delta !== undefined) row.appendChild(deltaChip(opts.delta, opts.deltaLabel));
  card.appendChild(row);
  if (opts.spark && opts.spark.length > 1) {
    const canvas = h("canvas", { class: "spark", attrs: { "aria-hidden": "true" } });
    card.appendChild(h("div", { class: "spark-wrap" }, canvas));
    requestAnimationFrame(() => drawSparkline(canvas, opts.spark, opts.color));
  }
  if (opts.sub) card.appendChild(h("div", { class: "kpi-sub", text: opts.sub }));
  return card;
}

// items: [{ key, label, value, sub, color, href, onClick }], sorted by caller.
// options: { total, max, color, valueFormat, showShare, empty, ariaLabel }
export function barList(items, options = {}) {
  if (!items || items.length === 0) return emptyState(options.empty || "Sem dados no período", { small: true });
  const max = options.max ?? Math.max(...items.map((i) => i.value));
  const total = options.total ?? items.reduce((sum, i) => sum + i.value, 0);
  const format = options.valueFormat || formatNumber;
  const list = h("ol", { class: "barlist", attrs: { "aria-label": options.ariaLabel || "" } });
  for (const item of items) {
    const pct = max > 0 ? (item.value / max) * 100 : 0;
    const labelProps = { class: "barlist-label", text: item.label, attrs: { title: item.title || item.label } };
    const label = item.href
      ? h("a", { ...labelProps, attrs: { ...labelProps.attrs, href: item.href, target: "_blank", rel: "noopener" } })
      : item.onClick
        ? h("button", { ...labelProps, attrs: { ...labelProps.attrs, type: "button" }, on: { click: item.onClick } })
        : h("span", labelProps);
    const meta = h("span", { class: "barlist-meta" }, h("span", { class: "barlist-value", text: format(item.value) }));
    if (options.showShare !== false) meta.appendChild(h("span", { class: "barlist-share", text: formatPct(share(item.value, total)) }));
    if (item.sub) meta.appendChild(h("span", { class: "barlist-sub", text: item.sub }));
    const li = h("li", { class: "barlist-item", style: { "--bar": `${pct.toFixed(1)}%`, "--bar-color": item.color || options.color || "var(--accent)" } },
      h("div", { class: "barlist-head" }, label, meta),
      h("div", { class: "barlist-track", attrs: { role: "presentation" } }, h("div", { class: "barlist-fill" })),
    );
    list.appendChild(li);
  }
  return list;
}

export const HEALTH_LABEL = Object.freeze({
  live: "ao vivo",
  active: "ativo",
  quiet: "quieto",
  stale: "parado",
  silent: "silêncio",
  empty: "sem dados",
  error: "erro",
  missing: "não configurado",
});

export function healthPill(state) {
  return h("span", { class: `pill pill--${state}`, text: HEALTH_LABEL[state] || state, attrs: { title: healthHint(state) } });
}

export function healthHint(state) {
  return {
    live: "Pageview na última hora",
    active: "Pageview nas últimas 24 h",
    quiet: "Sem pageviews há mais de 1 dia",
    stale: "Sem pageviews há mais de 7 dias: verifique o snippet",
    silent: "Sem pageviews há mais de 14 dias: tracking provavelmente quebrado",
    empty: "Nenhum registro recebido",
    error: "O proxy falhou ao ler a planilha deste site",
    missing: "Site não existe na lista SITES do Apps Script",
  }[state] || "";
}
