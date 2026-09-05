// Weekday x hour heatmap (DOM grid). Intensity = one accent, luminance ramp.
import { h, replace, emptyState } from "./dom.js";

export const DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function renderHeatmap(container, { matrix, max }, { zoneLabel = "" } = {}) {
  if (!container) return;
  if (!max) {
    replace(container, emptyState("Sem dados no período", { small: true }));
    return;
  }
  const grid = h("div", { class: "heatmap-grid", attrs: { role: "table", "aria-label": `Pageviews por dia da semana e hora${zoneLabel ? ` (${zoneLabel})` : ""}` } });
  grid.appendChild(h("div", { class: "heatmap-corner", attrs: { role: "columnheader" } }));
  for (let hour = 0; hour < 24; hour += 1) {
    grid.appendChild(h("div", { class: "heatmap-header", text: hour % 3 === 0 ? String(hour).padStart(2, "0") : "", attrs: { role: "columnheader" } }));
  }
  for (let day = 0; day < 7; day += 1) {
    grid.appendChild(h("div", { class: "heatmap-day", text: DAYS_PT[day], attrs: { role: "rowheader" } }));
    for (let hour = 0; hour < 24; hour += 1) {
      const count = matrix[day][hour];
      const intensity = count / max;
      const label = `${DAYS_PT[day]} ${String(hour).padStart(2, "0")}h: ${count} pageview${count === 1 ? "" : "s"}`;
      grid.appendChild(h("div", {
        class: "heatmap-cell",
        style: { "--i": intensity.toFixed(3) },
        attrs: { role: "cell", title: label, "aria-label": label, tabindex: count > 0 ? "0" : "-1" },
      }));
    }
  }
  replace(container, grid);
}
