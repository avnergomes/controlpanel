// Tiny DOM helpers. Text is always set via textContent (never innerHTML from data).

export function byId(id) {
  return document.getElementById(id);
}

export function clear(el) {
  if (!el) return el;
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// h('div', { class: 'x', text: 'hi', attrs: {...}, data: {...}, style: {...}, on: {...} }, ...children)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined && props.text !== null) el.textContent = String(props.text);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = String(v);
  if (props.style) for (const [k, v] of Object.entries(props.style)) {
    if (k.startsWith("--")) el.style.setProperty(k, String(v));
    else el.style[k] = v;
  }
  if (props.on) for (const [evt, fn] of Object.entries(props.on)) el.addEventListener(evt, fn);
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export function svgIcon(pathD, { size = 14, stroke = 1.6 } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", stroke);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", pathD);
  svg.appendChild(path);
  return svg;
}

export function emptyState(message, { small = false } = {}) {
  return h("div", { class: `empty-state${small ? " small" : ""}`, attrs: { role: "status" } }, h("p", { text: message }));
}

export function cssVar(name, fallback = "") {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}
