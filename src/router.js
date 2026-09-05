// Hash router. Routes: #/overview (default) · #/github · #/<siteKey> (kept for old links).
import { siteOf } from "./sites.js";

export const VIEWS = Object.freeze(["overview", "github", "site"]);

export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "").replace(/\/+$/, "");
  const [head, tail] = raw.split("/");
  if (!head || head === "overview") return { view: "overview", siteKey: null };
  if (head === "github") return { view: "github", siteKey: null };
  if (head === "site" && tail && siteOf(tail)) return { view: "site", siteKey: tail };
  if (siteOf(head)) return { view: "site", siteKey: head };
  return { view: "overview", siteKey: null, unknown: raw };
}

export function routeHash(route) {
  if (route.view === "site" && route.siteKey) return `#/${route.siteKey}`;
  if (route.view === "github") return "#/github";
  return "#/overview";
}

export function navigate(route) {
  const next = routeHash(route);
  if (location.hash !== next) location.hash = next;
}

export function currentRoute() {
  return parseRoute(location.hash);
}

export function onRouteChange(handler) {
  const listener = () => handler(currentRoute());
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
