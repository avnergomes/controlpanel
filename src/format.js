// Formatting helpers. Locale is fixed to pt-BR: the panel's chrome is Portuguese and
// numbers/dates must stay consistent regardless of the viewer's browser language.

const LOCALE = "pt-BR";
const numberFmt = new Intl.NumberFormat(LOCALE);
const compactFmt = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short" });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatNumber(value) {
  return numberFmt.format(Number(value) || 0);
}

export function formatCompact(value) {
  const n = Number(value) || 0;
  return n < 10000 ? numberFmt.format(n) : compactFmt.format(n);
}

export function formatPct(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatDelta(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

export function formatMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function formatDayMonth(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : timeFmt.format(d);
}

export function formatRelative(date, now = new Date()) {
  if (!date) return "nunca";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "nunca";
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "agora";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mês${months > 1 ? "es" : ""}`;
  return `${Math.floor(months / 12)} ano${months >= 24 ? "s" : ""}`;
}

export function formatDateForFilename(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function isoDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function truncate(text, max) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}
