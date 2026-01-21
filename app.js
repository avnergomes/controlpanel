const state = {
  data: [],
  bySite: {},
  lastFetched: null,
  status: {},
  charts: {},
  filters: {
    granularity: "day",
    period: "all",
    customStart: "",
    customEnd: "",
  },
};

const CACHE_KEY = "controlpanel-cache-v3";

document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("loaded");
  bindNavigation();
  bindControls();
  document.getElementById("refresh-btn").addEventListener("click", () => refreshData(true));

  const cached = loadCache();
  if (cached) {
    state.data = cached.data;
    state.lastFetched = cached.fetchedAt;
    indexData();
    renderCurrentView();
    updateStatus();
  }

  refreshData(false);
  setInterval(() => refreshData(false), CONFIG.pollMs);
});

function bindNavigation() {
  window.addEventListener("hashchange", renderCurrentView);
  renderCurrentView();
}

function bindControls() {
  document.querySelectorAll("[data-filter='granularity']").forEach((select) => {
    select.addEventListener("change", (event) => {
      state.filters.granularity = event.target.value;
      renderCurrentView();
    });
  });

  document.querySelectorAll("[data-filter='period']").forEach((select) => {
    select.addEventListener("change", (event) => {
      state.filters.period = event.target.value;
      toggleCustomRange();
      renderCurrentView();
    });
  });

  document.querySelectorAll("[data-filter='start']").forEach((input) => {
    input.addEventListener("change", (event) => {
      state.filters.customStart = event.target.value;
      renderCurrentView();
    });
  });

  document.querySelectorAll("[data-filter='end']").forEach((input) => {
    input.addEventListener("change", (event) => {
      state.filters.customEnd = event.target.value;
      renderCurrentView();
    });
  });

  toggleCustomRange();
}

function toggleCustomRange() {
  document.querySelectorAll("[data-custom-range]").forEach((wrap) => {
    wrap.classList.toggle("active", state.filters.period === "custom");
  });
}

function renderCurrentView() {
  const route = (location.hash || "#/overview").replace("#/", "");
  const isOverview = route === "overview" || route === "";
  const viewOverview = document.getElementById("view-overview");
  const viewSite = document.getElementById("view-site");

  viewOverview.classList.toggle("active", isOverview);
  viewSite.classList.toggle("active", !isOverview);

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route || (isOverview && link.dataset.route === "overview"));
  });

  if (isOverview) {
    renderOverview();
  } else {
    renderSite(route);
  }
}

async function refreshData(force) {
  const previousMax = getMaxTimestamp(state.data);
  const { data, status } = await fetchAllSites();
  const nextMax = getMaxTimestamp(data);

  state.status = status;
  state.lastFetched = new Date();
  updateStatus();

  if (force || !previousMax || (nextMax && nextMax > previousMax)) {
    state.data = data;
    indexData();
    saveCache();
    renderCurrentView();
  }
}

async function fetchAllSites() {
  const results = [];
  const status = {};

  for (const site of CONFIG.sites) {
    const gids = site.gids.filter(Boolean);
    let siteRows = [];

    try {
      for (const gid of gids) {
        const response = await fetchGviz(site.sheetId, gid);
        const rows = gvizToObjects(response);
        siteRows = siteRows.concat(normalizeSiteRows(site, rows));
      }
      status[site.key] = "ok";
    } catch (error) {
      status[site.key] = "error";
      showToast(`Erro ao carregar ${site.name}`);
    }

    results.push(...dedupeRows(siteRows));
  }

  results.sort((a, b) => a.ts - b.ts);
  return { data: results, status };
}

function fetchGviz(sheetId, gid) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout"));
    }, 15000);

    window.google = window.google || {};
    window.google.visualization = window.google.visualization || {};
    window.google.visualization.Query = window.google.visualization.Query || {};
    const previous = window.google.visualization.Query.setResponse;

    function cleanup() {
      clearTimeout(timeout);
      script.remove();
      if (previous) {
        window.google.visualization.Query.setResponse = previous;
      } else {
        delete window.google.visualization.Query.setResponse;
      }
    }

    window.google.visualization.Query.setResponse = (response) => {
      cleanup();
      if (response.status !== "ok") {
        reject(new Error(response.errors?.[0]?.message || "GViz error"));
      } else {
        resolve(response);
      }
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Script load error"));
    };

    script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?gid=${gid}&tqx=out:json`;
    document.body.appendChild(script);
  });
}

function gvizToObjects(response) {
  const cols = response.table.cols.map((col) => (col.label || col.id || "").trim());
  return response.table.rows.map((row) => {
    const obj = {};
    row.c.forEach((cell, index) => {
      obj[cols[index]] = cell ? cell.v : null;
    });
    return obj;
  });
}

function normalizeSiteRows(site, rows) {
  switch (site.kind) {
    case "portfolio":
      return rows.map((row) => normalizePortfolio(row)).filter(Boolean);
    case "vbp":
      return rows.map((row) => normalizeVbp(row)).filter(Boolean);
    case "precos":
      return rows.map((row) => normalizePrecos(row)).filter(Boolean);
    default:
      return [];
  }
}

function normalizePortfolio(row) {
  const ts = parseDate(getValue(row, ["Client Timestamp", "Timestamp", "client timestamp"]));
  if (!ts) return null;
  const url = getValue(row, ["Page URL", "URL", "page url"]);
  const returning = getReturningValue(row);
  return {
    siteKey: "portfolio",
    ts,
    url: url || "",
    path: extractPath(url),
    referrer: getValue(row, ["Referrer", "referrer"]) || "",
    timezone: getValue(row, ["Timezone", "timezone"]) || "",
    sessionId: getValue(row, ["Session ID", "session id"]) || "",
    os: getValue(row, ["OS", "os"]) || "",
    browser: getValue(row, ["Browser", "browser"]) || "",
    deviceType: normalizeDeviceType(getValue(row, ["Device", "device"])),
    returning,
    userAgent: getValue(row, ["User Agent", "user agent"]) || undefined,
  };
}

function normalizePrecos(row) {
  const ts = parseDate(getValue(row, ["Timestamp", "timestamp"]));
  if (!ts) return null;
  const url = getValue(row, ["URL", "url"]) || "";
  const returning = getReturningValue(row);
  return {
    siteKey: "precos-florestais",
    ts,
    url,
    path: getValue(row, ["Caminho", "caminho"]) || extractPath(url),
    referrer: getValue(row, ["Referrer", "referrer"]) || "",
    timezone: getValue(row, ["Timezone", "timezone"]) || "",
    sessionId: getValue(row, ["Session ID", "session id"]) || "",
    os: getValue(row, ["Sistema Operacional", "sistema operacional"]) || "",
    browser: getValue(row, ["Navegador", "navegador"]) || "",
    deviceType: normalizeDeviceType(getValue(row, ["Dispositivo", "dispositivo"])),
    returning,
    userAgent: getValue(row, ["User Agent", "user agent"]) || undefined,
  };
}

function normalizeVbp(row) {
  const ts = parseDate(getValue(row, ["timestamp", "Timestamp", "Date", "date"]));
  if (!ts) return null;
  const path = getValue(row, ["page", "pathname", "path"]) || "";
  const userAgent = getValue(row, ["userAgent", "User Agent", "user agent"]) || "";
  const derived = userAgent ? parseUserAgent(userAgent) : {};
  const returning = getReturningValue(row);

  const timezone =
    getValue(row, ["timezone", "Timezone", "Fuso Horario", "Fuso horário", "Fuso", "Time Zone", "time zone", "tz", "K", "k"]) ||
    getValueByKeyMatch(row, /(fuso|time\s*zone|timezone|tz)/i) ||
    "";

  return {
    siteKey: "vbp-parana",
    ts,
    url: getValue(row, ["url", "URL", "Page URL"]) || "",
    path,
    referrer: getValue(row, ["referrer", "Referrer"]) || "",
    timezone,
    sessionId: getValue(row, ["sessionId", "Session ID", "session id"]) || "",
    os: getValue(row, ["os", "OS"]) || derived.os || "",
    browser: getValue(row, ["browser", "Browser"]) || derived.browser || "",
    deviceType: normalizeDeviceType(getValue(row, ["device", "Device"]) || derived.deviceType),
    returning,
    userAgent: userAgent || undefined,
  };
}

function parseUserAgent(ua) {
  const value = ua.toLowerCase();
  let os = "";
  let browser = "";
  let deviceType = "Desktop";

  if (value.includes("android")) os = "Android";
  else if (value.includes("iphone") || value.includes("ipad")) os = "iOS";
  else if (value.includes("mac os")) os = "macOS";
  else if (value.includes("windows")) os = "Windows";
  else if (value.includes("linux")) os = "Linux";

  if (value.includes("edg/")) browser = "Edge";
  else if (value.includes("chrome") && !value.includes("chromium")) browser = "Chrome";
  else if (value.includes("safari") && !value.includes("chrome")) browser = "Safari";
  else if (value.includes("firefox")) browser = "Firefox";

  if (value.includes("ipad") || value.includes("tablet")) deviceType = "Tablet";
  else if (value.includes("mobi") || value.includes("android") || value.includes("iphone")) deviceType = "Mobile";

  return { os, browser, deviceType };
}

function getValue(row, names) {
  const lookup = Object.keys(row).reduce((acc, key) => {
    acc[key.toLowerCase()] = row[key];
    return acc;
  }, {});

  for (const name of names) {
    const value = lookup[name.toLowerCase()];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function getValueByKeyMatch(row, pattern) {
  const keys = Object.keys(row);
  for (const key of keys) {
    if (pattern.test(key)) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return null;
}

function getReturningValue(row) {
  const value =
    getValue(row, [
      "Returning Visitor",
      "returning visitor",
      "Returning",
      "returning",
      "ReturningVisitor",
      "returningVisitor",
      "Returning_Visitor",
      "returning_visitor",
      "Is Returning",
      "isReturning",
      "is_returning",
      "Visitante Recorrente",
      "visitante recorrente",
      "Retornando",
      "retornando",
      "Retorno",
      "retorno",
    ]) || getValueByKeyMatch(row, /(return|retorn)/i);

  return parseBool(value);
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") return new Date(value);
  return null;
}

function parseBool(value) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "sim" || normalized === "1";
}

function normalizeDeviceType(value) {
  if (!value) return "Unknown";
  const normalized = String(value).toLowerCase();
  if (normalized.includes("mobile")) return "Mobile";
  if (normalized.includes("tablet") || normalized.includes("ipad")) return "Tablet";
  if (normalized.includes("desktop")) return "Desktop";
  return "Unknown";
}

function extractPath(url) {
  if (!url) return "";
  try {
    return new URL(url).pathname || "";
  } catch {
    return "";
  }
}

function dedupeRows(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!row.ts) return;
    const key = `${row.siteKey}|${row.ts.toISOString()}|${row.sessionId || ""}|${row.path || row.url || ""}`;
    if (!map.has(key)) map.set(key, row);
  });
  return Array.from(map.values());
}

function indexData() {
  state.bySite = CONFIG.sites.reduce((acc, site) => {
    acc[site.key] = [];
    return acc;
  }, {});

  state.data.forEach((row) => {
    if (state.bySite[row.siteKey]) state.bySite[row.siteKey].push(row);
  });
}

function renderOverview() {
  const cards = document.getElementById("overview-cards");
  cards.innerHTML = "";

  const totalVisits = state.data.length;
  const uniqueSessions = new Set(state.data.map((row) => row.sessionId).filter(Boolean)).size;
  const lastBySite = Object.keys(state.bySite).map((key) => {
    const rows = state.bySite[key];
    const last = rows.length ? rows[rows.length - 1].ts : null;
    return { key, last };
  });

  cards.appendChild(makeCard("Total de acessos", formatNumber(totalVisits)));
  cards.appendChild(makeCard("Sessoes unicas", formatNumber(uniqueSessions)));

  lastBySite.forEach((entry) => {
    const site = CONFIG.sites.find((item) => item.key === entry.key);
    cards.appendChild(makeCard(`Ultimo acesso - ${site.name}`, entry.last ? formatDateTime(entry.last) : "--"));
  });

  renderOverviewChart();
  renderTopPeriods();
}

function renderSite(siteKey) {
  const site = CONFIG.sites.find((item) => item.key === siteKey);
  if (!site) return;

  document.getElementById("site-name").textContent = site.name;
  document.getElementById("site-desc").textContent = `Serie temporal e distribuicoes para ${site.name}.`;

  const rows = state.bySite[siteKey] || [];
  const filtered = applyFilters(rows, state.filters);

  renderSiteKpis(rows, filtered);
  renderSiteChart(siteKey, filtered);
  renderDistributions(rows);
  renderLatest(rows);
}

function renderOverviewChart() {
  const filtered = applyFilters(state.data, state.filters);
  const { labels, series, totals } = buildSeries(filtered, state.filters.granularity, true);

  const datasets = CONFIG.sites.map((site, index) => {
    return {
      label: site.name,
      data: series[site.key] || labels.map(() => 0),
      borderColor: pickColor(index),
      backgroundColor: pickColor(index),
      tension: 0.2,
      pointRadius: 2,
    };
  });

  datasets.push({
    label: "Total",
    data: totals,
    borderColor: "#ffffff",
    backgroundColor: "#ffffff",
    borderDash: [6, 6],
    tension: 0.2,
    pointRadius: 0,
  });

  renderLineChart("overview-chart", labels, datasets, "Visitas");
}

function renderSiteChart(siteKey, records) {
  const { labels, series } = buildSeries(records, state.filters.granularity, false);
  const site = CONFIG.sites.find((item) => item.key === siteKey);

  const datasets = [
    {
      label: site.name,
      data: series[siteKey] || labels.map(() => 0),
      borderColor: pickColor(0),
      backgroundColor: pickColor(0),
      tension: 0.2,
      pointRadius: 2,
    },
  ];

  renderLineChart("site-chart", labels, datasets, "Visitas");
}

function renderDistributions(records) {
  const tzCounts = aggregateCounts(records, (row) => row.timezone || "Unknown");
  const refCounts = aggregateCounts(records, (row) => normalizeReferrer(row.referrer));
  const osCounts = aggregateCounts(records, (row) => row.os || "Unknown");

  renderBarChart("tz-chart", tzCounts, "Timezone");
  renderBarChart("ref-chart", refCounts, "Referrer");
  renderBarChart("os-chart", osCounts, "OS");
}

function renderLatest(records) {
  const table = document.querySelector("#latest-table tbody");
  table.innerHTML = "";

  const sorted = [...records].sort((a, b) => b.ts - a.ts).slice(0, CONFIG.maxLatest);
  sorted.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(row.ts)}</td>
      <td>${row.path || row.url || "--"}</td>
      <td>${normalizeReferrer(row.referrer)}</td>
      <td>${row.timezone || "--"}</td>
      <td>${[row.os, row.deviceType].filter(Boolean).join(" / ") || "--"}</td>
    `;
    table.appendChild(tr);
  });
}

function renderSiteKpis(allRows, filteredRows) {
  const target = document.getElementById("site-kpis");
  target.innerHTML = "";

  const total = allRows.length;
  const uniqueSessions = new Set(allRows.map((row) => row.sessionId).filter(Boolean)).size;
  const singleVisitSessions = countSingleVisitSessions(allRows);
  const returningRate = computeReturningRate(allRows);

  target.appendChild(makeCard("Total de acessos", formatNumber(total)));
  target.appendChild(makeCard("Sessoes unicas", formatNumber(uniqueSessions)));
  target.appendChild(makeCard("Acessos sem repeticao", formatNumber(singleVisitSessions)));
  target.appendChild(makeCard("Returning rate", returningRate));
  target.appendChild(makeCard("Acessos no periodo", formatNumber(filteredRows.length)));
}

function renderTopPeriods() {
  const table = document.querySelector("#top-periods tbody");
  table.innerHTML = "";

  const { labels, totals } = buildSeries(applyFilters(state.data, state.filters), state.filters.granularity, true);
  const pairs = labels.map((label, index) => ({ label, total: totals[index] }));
  pairs.sort((a, b) => b.total - a.total);

  pairs.slice(0, 10).forEach((entry) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${entry.label}</td><td>${formatNumber(entry.total)}</td>`;
    table.appendChild(tr);
  });
}

function buildSeries(records, granularity, includeTotals) {
  const bucketMap = new Map();
  const series = {};

  records.forEach((row) => {
    const bucket = bucketKey(row.ts, granularity);
    if (!bucketMap.has(bucket.key)) bucketMap.set(bucket.key, bucket);

    if (!series[row.siteKey]) series[row.siteKey] = new Map();
    const siteMap = series[row.siteKey];
    siteMap.set(bucket.key, (siteMap.get(bucket.key) || 0) + 1);
  });

  const buckets = Array.from(bucketMap.values()).sort((a, b) => a.sort - b.sort);
  const labels = buckets.map((item) => item.label);

  const totals = labels.map(() => 0);
  const output = {};

  Object.keys(series).forEach((siteKey) => {
    const values = buckets.map((bucket, index) => {
      const count = series[siteKey].get(bucket.key) || 0;
      if (includeTotals) totals[index] += count;
      return count;
    });
    output[siteKey] = values;
  });

  return { labels, series: output, totals };
}

function bucketKey(date, granularity) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());

  if (granularity === "hour") {
    return { key: `${year}-${month}-${day}-${hour}`, label: `${year}-${month}-${day} ${hour}:00`, sort: new Date(year, date.getMonth(), date.getDate(), date.getHours()).getTime() };
  }
  if (granularity === "month") {
    return { key: `${year}-${month}`, label: `${year}-${month}`, sort: new Date(year, date.getMonth(), 1).getTime() };
  }
  if (granularity === "year") {
    return { key: `${year}`, label: `${year}`, sort: new Date(year, 0, 1).getTime() };
  }
  return { key: `${year}-${month}-${day}`, label: `${year}-${month}-${day}`, sort: new Date(year, date.getMonth(), date.getDate()).getTime() };
}

function applyFilters(records, filters) {
  const { start, end } = resolvePeriod(filters);
  if (!start && !end) return records;
  return records.filter((row) => {
    if (start && row.ts < start) return false;
    if (end && row.ts > end) return false;
    return true;
  });
}

function resolvePeriod(filters) {
  const now = new Date();
  if (filters.period === "7d") return { start: new Date(now.getTime() - 7 * 86400000), end: now };
  if (filters.period === "30d") return { start: new Date(now.getTime() - 30 * 86400000), end: now };
  if (filters.period === "90d") return { start: new Date(now.getTime() - 90 * 86400000), end: now };
  if (filters.period === "custom") {
    const start = filters.customStart ? new Date(`${filters.customStart}T00:00:00`) : null;
    const end = filters.customEnd ? new Date(`${filters.customEnd}T23:59:59`) : null;
    return { start, end };
  }
  return { start: null, end: null };
}

function aggregateCounts(records, accessor) {
  const map = new Map();
  records.forEach((row) => {
    const key = accessor(row) || "Unknown";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function normalizeReferrer(value) {
  if (!value || value === "direct" || value === "Direct") return "Direct";
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function renderLineChart(canvasId, labels, datasets, yLabel) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }

  state.charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { color: getComputedStyle(document.body).color } },
      },
      scales: {
        x: { ticks: { color: getComputedStyle(document.body).color } },
        y: { ticks: { color: getComputedStyle(document.body).color }, title: { display: true, text: yLabel, color: getComputedStyle(document.body).color } },
      },
    },
  });
}

function renderBarChart(canvasId, entries, label) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }

  const labels = entries.map((entry) => entry[0]);
  const values = entries.map((entry) => entry[1]);

  const barTopLabels = {
    id: "barTopLabels",
    afterDatasetsDraw(chart) {
      if (chart.config.type !== "bar") return;
      const { ctx: chartCtx } = chart;
      const dataset = chart.data.datasets[0];
      const meta = chart.getDatasetMeta(0);
      if (!dataset || !meta?.data?.length) return;

      chartCtx.save();
      chartCtx.font = "600 12px 'Space Grotesk', sans-serif";
      chartCtx.fillStyle = getComputedStyle(document.body).color;
      chartCtx.textAlign = "center";
      chartCtx.textBaseline = "bottom";

      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined) return;
        const { x, y } = element.tooltipPosition();
        chartCtx.fillText(formatNumber(value), x, y - 4);
      });
      chartCtx.restore();
    },
  };

  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: "rgba(255, 122, 24, 0.6)",
          borderColor: "rgba(255, 122, 24, 0.8)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { ticks: { color: getComputedStyle(document.body).color } },
        y: { ticks: { color: getComputedStyle(document.body).color } },
      },
    },
    plugins: [barTopLabels],
  });
}

function makeCard(title, value) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>${title}</h3><div class="value">${value}</div>`;
  return card;
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(value || 0);
}

function formatDateTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function pickColor(index) {
  const palette = ["#ff7a18", "#2dd4bf", "#facc15", "#fb7185"];
  return palette[index % palette.length];
}

function getMaxTimestamp(records) {
  if (!records.length) return null;
  return records[records.length - 1].ts;
}

function countSingleVisitSessions(records) {
  const counts = new Map();
  records.forEach((row) => {
    if (!row.sessionId) return;
    counts.set(row.sessionId, (counts.get(row.sessionId) || 0) + 1);
  });
  return Array.from(counts.values()).filter((count) => count === 1).length;
}

function computeReturningRate(records) {
  const values = records.filter((row) => row.returning !== undefined);
  if (!values.length) return "N/A";
  const returning = values.filter((row) => row.returning).length;
  const rate = (returning / values.length) * 100;
  return `${rate.toFixed(1)}%`;
}

function updateStatus() {
  document.getElementById("updated-at").textContent = state.lastFetched ? formatDateTime(state.lastFetched) : "--";
  const statusText = document.getElementById("status-text");
  const hasError = Object.values(state.status).includes("error");
  statusText.textContent = hasError ? "erro" : "ok";
  statusText.className = hasError ? "status-error" : "status-ok";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 4000);
}

function saveCache() {
  const payload = {
    fetchedAt: state.lastFetched?.toISOString(),
    data: state.data.map((row) => ({ ...row, ts: row.ts.toISOString() })),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const fetchedAt = parsed.fetchedAt ? new Date(parsed.fetchedAt) : null;
    const ageMinutes = fetchedAt ? (Date.now() - fetchedAt.getTime()) / 60000 : Infinity;
    if (ageMinutes > CONFIG.cacheMinutes) return null;
    const data = parsed.data.map((row) => ({ ...row, ts: new Date(row.ts) }));
    return { data, fetchedAt };
  } catch {
    return null;
  }
}
