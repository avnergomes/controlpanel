// CSV export of normalized rows: UTF-8 with BOM, ";" separator and CRLF so Excel pt-BR
// opens it directly; visitor-controlled cells are formula-neutralized.
import { formatDateForFilename, formatDateTime } from "./format.js";

const SEPARATOR = ";";

const COLUMNS = [
  ["Data (UTC)", (r) => r.ts.toISOString()],
  ["Data (America/Sao_Paulo)", (r) => formatDateTime(r.ts)],
  ["Site", (r) => r.siteKey],
  ["URL", (r) => r.url],
  ["Path", (r) => r.path],
  ["Título", (r) => r.pageTitle],
  ["Referrer", (r) => r.referrer],
  ["Timezone", (r) => r.timezone],
  ["Idioma", (r) => r.language],
  ["Dispositivo", (r) => r.deviceType],
  ["Conexão", (r) => r.connectionType],
  ["Tema", (r) => r.prefersColorScheme],
  ["Orientação", (r) => r.screenOrientation],
  ["LoadTime (ms)", (r) => (r.loadTime ?? "")],
  ["UTM source", (r) => r.utmSource],
  ["UTM medium", (r) => r.utmMedium],
  ["UTM campaign", (r) => r.utmCampaign],
];

const BOM = "\uFEFF";

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralize spreadsheet formula injection and quote the cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  const header = COLUMNS.map(([name]) => csvCell(name)).join(SEPARATOR);
  const lines = rows.map((row) => COLUMNS.map(([, get]) => csvCell(get(row))).join(SEPARATOR));
  return BOM + [header, ...lines].join("\r\n");
}

export function downloadCsv(rows, name, now = new Date()) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `observatory-${name}-${formatDateForFilename(now)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return a.download;
}
