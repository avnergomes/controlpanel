// World map of UTC zones coloured by recency of the last pageview. The base SVG is
// built once from pre-projected paths (assets/world-paths.json) and reused; renders
// only update zone classes and tooltips.
import { h, replace, emptyState } from "./dom.js";
import { utcOffsetOf } from "../geo.js";
import { formatRelative, formatNumber } from "../format.js";
import { HOUR, DAY } from "../analytics.js";

const SVG_NS = "http://www.w3.org/2000/svg";
let pathsPromise = null;

export function loadWorldPaths() {
  if (!pathsPromise) {
    pathsPromise = fetch("assets/world-paths.json").then((r) => {
      if (!r.ok) throw new Error(`world-paths ${r.status}`);
      return r.json();
    }).catch((err) => {
      pathsPromise = null;
      throw err;
    });
  }
  return pathsPromise;
}

export function recencyClass(lastTs, now = new Date()) {
  if (!lastTs) return "tz-inactive";
  const age = now.getTime() - lastTs.getTime();
  if (age < HOUR) return "tz-recent";
  if (age < DAY) return "tz-today";
  if (age < 7 * DAY) return "tz-week";
  return "tz-old";
}

// Aggregate rows into Map<zone, { count, lastTs, timezones:Set }> keyed by the nearest
// available map zone (handles half-hour zones such as India +5:30).
export function zoneAggregate(rows, zones) {
  const available = zones.map((z) => z.zone);
  const nearest = new Map();
  const result = new Map();
  for (const row of rows) {
    const tz = row.timezone;
    if (!tz) continue;
    let zone = nearest.get(tz);
    if (zone === undefined) {
      const offset = utcOffsetOf(tz);
      zone = offset === null ? null : available.reduce((best, z) => (Math.abs(z - offset) < Math.abs(best - offset) ? z : best), available[0]);
      nearest.set(tz, zone);
    }
    if (zone === null || zone === undefined) continue;
    const entry = result.get(zone) || { count: 0, lastTs: null, timezones: new Set() };
    entry.count += 1;
    entry.timezones.add(tz);
    if (!entry.lastTs || row.ts > entry.lastTs) entry.lastTs = row.ts;
    result.set(zone, entry);
  }
  return result;
}

function buildSvg(paths) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${paths.width} ${paths.height}`);
  svg.setAttribute("class", "world-map-svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Mapa-múndi de fusos horários com a recência do último acesso");

  const countries = document.createElementNS(SVG_NS, "g");
  countries.setAttribute("class", "countries-layer");
  for (const d of paths.countries) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", "country-path");
    countries.appendChild(p);
  }
  svg.appendChild(countries);

  const zonesLayer = document.createElementNS(SVG_NS, "g");
  zonesLayer.setAttribute("class", "zones-layer");
  const zoneNodes = new Map();
  for (const zone of paths.zones) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "map-region tz-inactive");
    g.dataset.zone = String(zone.zone);
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", zone.d);
    p.setAttribute("class", "region-path");
    p.dataset.tooltip = zone.label;
    g.appendChild(p);
    zonesLayer.appendChild(g);
    zoneNodes.set(zone.zone, { group: g, path: p, label: zone.label });
  }
  svg.appendChild(zonesLayer);
  return { svg, zoneNodes };
}

let tooltipEl = null;
function showTooltip(event, text) {
  if (!tooltipEl) {
    tooltipEl = h("div", { class: "map-tooltip", attrs: { role: "tooltip" } });
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.textContent = text;
  tooltipEl.style.display = "block";
  const x = Math.min(event.clientX + 12, window.innerWidth - tooltipEl.offsetWidth - 8);
  const y = Math.min(event.clientY + 12, window.innerHeight - tooltipEl.offsetHeight - 8);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}
function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = "none";
}

export async function renderWorldMap(container, rows, { now = new Date() } = {}) {
  if (!container) return;
  let paths;
  try {
    paths = await loadWorldPaths();
  } catch {
    replace(container, emptyState("Mapa indisponível", { small: true }));
    return;
  }
  if (!container.__world) {
    const built = buildSvg(paths);
    container.__world = built;
    replace(container, built.svg);
    built.svg.addEventListener("mousemove", (e) => {
      const target = e.target.closest("[data-tooltip]");
      if (target) showTooltip(e, target.dataset.tooltip);
      else hideTooltip();
    });
    built.svg.addEventListener("mouseleave", hideTooltip);
  } else if (!container.contains(container.__world.svg)) {
    replace(container, container.__world.svg);
  }

  const aggregate = zoneAggregate(rows, paths.zones);
  for (const [zone, node] of container.__world.zoneNodes) {
    const data = aggregate.get(zone);
    node.group.setAttribute("class", `map-region ${data ? recencyClass(data.lastTs, now) : "tz-inactive"}`);
    if (data) {
      const names = Array.from(data.timezones).slice(0, 3).join(", ");
      const more = data.timezones.size > 3 ? ` +${data.timezones.size - 3}` : "";
      node.path.dataset.tooltip = `${node.label}\n${names}${more}\n${formatNumber(data.count)} pageviews · ${formatRelative(data.lastTs, now)}`;
    } else {
      node.path.dataset.tooltip = node.label;
    }
  }
}
