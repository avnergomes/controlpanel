// Sidebar / channel strip: primary views + every site grouped, each with a live
// health dot and its 24 h count. Built once, updated in place.
import { h, replace } from "./dom.js";
import { GROUPS, SITES, sitesInGroup } from "../sites.js";
import { routeHash } from "../router.js";
import { formatCompact } from "../format.js";
import { healthHint } from "./cards.js";

export function buildNav(root) {
  const items = new Map();
  const primary = h("ul", { class: "nav-list", attrs: { role: "list" } });
  primary.appendChild(navItem({ view: "overview" }, { code: "00", label: "Visão geral", i18n: "panels.visaoGeral" }, items));
  primary.appendChild(navItem({ view: "github" }, { code: "GH", label: "Repositórios" }, items));

  const sections = [h("div", { class: "nav-section" }, primary)];
  for (const group of GROUPS) {
    const list = h("ul", { class: "nav-list", attrs: { role: "list" } });
    for (const site of sitesInGroup(group.key)) {
      list.appendChild(navItem({ view: "site", siteKey: site.key }, { code: site.code, label: site.short, color: site.color, title: site.name }, items));
    }
    sections.push(h("div", { class: "nav-section" }, h("h2", { class: "nav-heading", text: group.label }), list));
  }
  replace(root, sections);

  return {
    update({ route, healthBySite }) {
      for (const [key, item] of items) {
        const active = key === routeKey(route);
        item.link.classList.toggle("active", active);
        item.link.setAttribute("aria-current", active ? "page" : "false");
        if (item.siteKey && healthBySite) {
          const health = healthBySite[item.siteKey];
          if (health) {
            item.dot.className = `nav-dot nav-dot--${health.state}`;
            item.dot.title = healthHint(health.state);
            item.count.textContent = health.last24h ? formatCompact(health.last24h) : "";
            item.count.title = `${health.last24h} pageviews nas últimas 24 h`;
          }
        }
      }
    },
  };
}

function routeKey(route) {
  return route.view === "site" ? `site:${route.siteKey}` : route.view;
}

function navItem(route, { code, label, color, title, i18n }, items) {
  const key = routeKey(route);
  const dot = h("span", { class: "nav-dot", attrs: { "aria-hidden": "true" } });
  const count = h("span", { class: "nav-count mono" });
  const link = h("a", {
    class: "nav-link",
    attrs: { href: routeHash(route), title: title || label, "aria-current": "false" },
    style: color ? { "--site-color": color } : undefined,
  },
    h("span", { class: "nav-code mono", text: `[${code}]` }),
    // Site names are data, not chrome: never let the i18n walker rewrite them.
    h("span", { class: "nav-label", text: label, attrs: i18n ? { "data-i18n": i18n } : (route.view === "site" ? { "data-i18n-skip": "" } : undefined) }),
    route.view === "site" ? count : null,
    route.view === "site" ? dot : null,
  );
  items.set(key, { link, dot, count, siteKey: route.siteKey || null });
  return h("li", {}, link);
}

export function siteTabs() {
  return SITES.map((site) => ({ key: site.key, label: site.short }));
}
