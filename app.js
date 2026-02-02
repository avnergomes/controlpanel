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
  requestNotificationPermission();
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
  const previousCount = state.data.length;
  const { data, status } = await fetchAllSites();
  const nextMax = getMaxTimestamp(data);

  state.status = status;
  state.lastFetched = new Date();
  updateStatus();

  if (force || !previousMax || (nextMax && nextMax > previousMax)) {
    if (previousCount > 0 && data.length > previousCount) {
      const newRows = data.slice(previousCount);
      newRows.forEach((row) => notifyNewVisit(row));
    }
    state.data = data;
    indexData();
    saveCache();
    renderCurrentView();
  }
}

async function fetchAllSites() {
  const results = [];
  const status = {};

  try {
    const url = `${CONFIG.proxyUrl}?token=${encodeURIComponent(CONFIG.proxyToken)}`;
    const response = await fetch(url, { redirect: "follow" });

    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseErr) {
      console.error("[ControlPanel] Resposta nao-JSON do proxy:", text.substring(0, 500));
      throw new Error("Resposta invalida do proxy");
    }

    if (payload.error) {
      throw new Error(payload.error);
    }

    for (const site of CONFIG.sites) {
      const siteData = payload.sites[site.key];

      if (!siteData || siteData.status === "error") {
        status[site.key] = "error";
        if (siteData) showToast(`Erro ao carregar ${site.name}: ${siteData.error || "unknown"}`);
        continue;
      }

      status[site.key] = "ok";
      const rows = siteData.rows || [];
      const normalized = normalizeSiteRows(site, rows);
      results.push(...dedupeRows(normalized));
    }
  } catch (error) {
    for (const site of CONFIG.sites) {
      status[site.key] = "error";
    }
    console.error("[ControlPanel] Erro no fetch:", error);
    showToast("Erro ao conectar ao proxy");
  }

  results.sort((a, b) => a.ts - b.ts);
  return { data: results, status };
}

function normalizeSiteRows(site, rows) {
  switch (site.kind) {
    case "portfolio":
      return rows.map((row) => normalizePortfolio(row)).filter(Boolean);
    case "vbp":
      return rows.map((row) => normalizeVbp(row)).filter(Boolean);
    case "precos":
      return rows.map((row) => normalizePrecos(row, site.key)).filter(Boolean);
    default:
      return [];
  }
}

function normalizePortfolio(row) {
  const ts = parseDate(getValue(row, ["Client Timestamp", "Timestamp", "client timestamp"]));
  if (!ts) return null;
  const url = getValue(row, ["Page URL", "URL", "page url"]);
  const returning = getReturningValue(row);
  const userAgent = getValue(row, ["User Agent", "user agent"]) || "";
  const derived = userAgent ? parseUserAgent(userAgent) : {};
  return {
    siteKey: "portfolio",
    ts,
    url: url || "",
    path: extractPath(url),
    referrer: getValue(row, ["Referrer", "referrer"]) || "",
    timezone: getValue(row, ["Timezone", "timezone"]) || "",
    sessionId: getValue(row, ["Session ID", "session id"]) || "",
    os: getValue(row, ["OS", "os"]) || derived.os || "",
    browser: getValue(row, ["Browser", "browser"]) || derived.browser || "",
    deviceType: normalizeDeviceType(getValue(row, ["Device", "device", "deviceType"]) || derived.deviceType),
    returning,
    userAgent: userAgent || undefined,
    language: getValue(row, ["Language", "language"]) || "",
    screenWidth: toNumber(getValue(row, ["Screen Width", "screenWidth", "screenResolution"])),
    screenHeight: toNumber(getValue(row, ["Screen Height", "screenHeight"])),
    connectionType: getValue(row, ["Connection Type", "connectionType"]) || "",
    loadTime: toNumber(getValue(row, ["Page Load Time", "pageLoadTime", "loadTime"])),
    firstContentfulPaint: toNumber(getValue(row, ["First Contentful Paint", "firstContentfulPaint"])),
    domInteractiveTime: toNumber(getValue(row, ["DOM Interactive Time", "domInteractiveTime"])),
    isMobile: parseBool(getValue(row, ["isMobile", "Is Mobile"])),
    utmSource: getValue(row, ["UTM Source", "utmSource"]) || "",
    utmMedium: getValue(row, ["UTM Medium", "utmMedium"]) || "",
    utmCampaign: getValue(row, ["UTM Campaign", "utmCampaign"]) || "",
  };
}

function normalizePrecos(row, siteKey) {
  const ts = parseDate(getValue(row, ["Timestamp", "timestamp"]));
  if (!ts) return null;
  const url = getValue(row, ["URL", "url"]) || "";
  const returning = getReturningValue(row);
  const userAgent = getValue(row, ["User Agent", "user agent"]) || "";
  const derived = userAgent ? parseUserAgent(userAgent) : {};
  return {
    siteKey,
    ts,
    url,
    path: getValue(row, ["Caminho", "caminho"]) || extractPath(url),
    referrer: getValue(row, ["Referrer", "referrer"]) || "",
    timezone: getValue(row, ["Timezone", "timezone"]) || "",
    sessionId: getValue(row, ["Session ID", "session id"]) || "",
    os: getValue(row, ["Sistema Operacional", "sistema operacional"]) || derived.os || "",
    browser: getValue(row, ["Navegador", "navegador"]) || derived.browser || "",
    deviceType: normalizeDeviceType(getValue(row, ["Dispositivo", "dispositivo"]) || derived.deviceType),
    returning,
    userAgent: userAgent || undefined,
    language: getValue(row, ["language", "Language", "Idioma"]) || "",
    screenWidth: toNumber(getValue(row, ["screenWidth", "Screen Width"])),
    screenHeight: toNumber(getValue(row, ["screenHeight", "Screen Height"])),
    connectionType: getValue(row, ["connectionType", "Connection Type"]) || "",
    loadTime: toNumber(getValue(row, ["loadTime", "Load Time"])),
    firstContentfulPaint: toNumber(getValue(row, ["firstContentfulPaint", "First Contentful Paint"])),
    domInteractiveTime: toNumber(getValue(row, ["domInteractiveTime", "DOM Interactive Time"])),
    isMobile: parseBool(getValue(row, ["isMobile", "Is Mobile"])),
    utmSource: getValue(row, ["utmSource", "UTM Source"]) || "",
    utmMedium: getValue(row, ["utmMedium", "UTM Medium"]) || "",
    utmCampaign: getValue(row, ["utmCampaign", "UTM Campaign"]) || "",
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
    language: getValue(row, ["language", "Language"]) || "",
    screenWidth: toNumber(getValue(row, ["screenWidth", "Screen Width"])),
    screenHeight: toNumber(getValue(row, ["screenHeight", "Screen Height"])),
    connectionType: getValue(row, ["connectionType", "Connection Type"]) || "",
    loadTime: toNumber(getValue(row, ["loadTime", "Load Time"])),
    firstContentfulPaint: toNumber(getValue(row, ["firstContentfulPaint", "First Contentful Paint"])),
    domInteractiveTime: toNumber(getValue(row, ["domInteractiveTime", "DOM Interactive Time"])),
    isMobile: parseBool(getValue(row, ["isMobile", "Is Mobile"])),
    utmSource: getValue(row, ["utmSource", "UTM Source"]) || "",
    utmMedium: getValue(row, ["utmMedium", "UTM Medium"]) || "",
    utmCampaign: getValue(row, ["utmCampaign", "UTM Campaign"]) || "",
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
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
  const lastBySite = CONFIG.sites.map((site) => {
    const rows = state.bySite[site.key] || [];
    const last = rows.length ? rows[rows.length - 1].ts : null;
    return { key: site.key, last };
  });

  // Mobile %
  const mobileCount = state.data.filter((r) => r.isMobile === true || r.deviceType === "Mobile").length;
  const mobilePct = totalVisits > 0 ? ((mobileCount / totalVisits) * 100).toFixed(1) + "%" : "N/D";

  // Avg load time
  const loadTimes = state.data.map((r) => r.loadTime).filter((v) => v && v > 0);
  const avgLoad = loadTimes.length ? (loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length / 1000).toFixed(2) + "s" : "N/D";

  // Top browser
  const browserCounts = aggregateCounts(state.data, (r) => r.browser || "Unknown");
  const topBrowser = browserCounts.length ? browserCounts[0][0] : "N/D";

  // Returning rate
  const returningRate = computeReturningRate(state.data);

  cards.appendChild(makeCard("Total de acessos", formatNumber(totalVisits)));
  cards.appendChild(makeCard("Sessoes unicas", formatNumber(uniqueSessions)));
  cards.appendChild(makeCard("Mobile %", mobilePct));
  cards.appendChild(makeCard("Tempo medio de carga", avgLoad));
  cards.appendChild(makeCard("Top Browser", topBrowser));
  cards.appendChild(makeCard("Returning rate", returningRate));

  lastBySite.forEach((entry) => {
    const site = CONFIG.sites.find((item) => item.key === entry.key);
    cards.appendChild(makeCard(`Ultimo acesso - ${site.name}`, entry.last ? formatDateTime(entry.last) : "--"));
  });

  renderOverviewChart();
  renderOverviewDevices();
  renderOverviewBrowsers();
  renderOverviewReturning();
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
  renderPerformanceKpis(rows);
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

function renderOverviewDevices() {
  const counts = { Mobile: 0, Desktop: 0, Tablet: 0 };
  state.data.forEach((r) => {
    const type = r.deviceType || "Unknown";
    if (type === "Mobile") counts.Mobile++;
    else if (type === "Tablet") counts.Tablet++;
    else if (type === "Desktop") counts.Desktop++;
  });
  renderDoughnutChart("overview-devices-chart", Object.entries(counts), "Dispositivos");
}

function renderOverviewBrowsers() {
  const counts = aggregateCounts(state.data, (r) => r.browser || "Unknown");
  renderBarChart("overview-browsers-chart", counts, "Browser");
}

function renderOverviewReturning() {
  const known = state.data.filter((r) => r.returning !== undefined);
  const returning = known.filter((r) => r.returning).length;
  const newVisitors = known.length - returning;
  renderDoughnutChart("overview-returning-chart", [["Novos", newVisitors], ["Retornantes", returning]], "Visitantes");
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
  const browserCounts = aggregateCounts(records, (row) => row.browser || "Unknown");
  const deviceCounts = aggregateCounts(records, (row) => row.deviceType || "Unknown");
  const langCounts = aggregateCounts(records, (row) => row.language || "Unknown");

  renderBarChart("tz-chart", tzCounts, "Timezone");
  renderBarChart("ref-chart", refCounts, "Referrer");
  renderBarChart("os-chart", osCounts, "OS");
  renderBarChart("browser-chart", browserCounts, "Browser");
  renderDoughnutChart("device-chart", deviceCounts, "Dispositivo");
  renderBarChart("lang-chart", langCounts, "Idioma");
}

function renderPerformanceKpis(records) {
  const target = document.getElementById("site-performance");
  if (!target) return;
  target.innerHTML = "";

  const metrics = [
    { label: "Tempo medio de carga", key: "loadTime", divisor: 1000, unit: "s" },
    { label: "FCP medio", key: "firstContentfulPaint", divisor: 1000, unit: "s" },
    { label: "DOM Interactive", key: "domInteractiveTime", divisor: 1000, unit: "s" },
  ];

  metrics.forEach((m) => {
    const values = records.map((r) => r[m.key]).filter((v) => v && v > 0);
    const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length / m.divisor).toFixed(2) + m.unit : "N/D";
    target.appendChild(makeCard(m.label, avg));
  });
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
      <td>${row.os || "--"}</td>
      <td>${row.browser || "--"}</td>
      <td>${row.deviceType || "--"}</td>
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

function renderDoughnutChart(canvasId, entries, label) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }

  const labels = entries.map((e) => e[0]);
  const values = entries.map((e) => e[1]);
  const doughnutColors = ["#38bdf8", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6", "#ec4899", "#6366f1"];

  state.charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: doughnutColors.slice(0, labels.length),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: getComputedStyle(document.body).color, padding: 12 } },
      },
    },
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
  const palette = [
    "#38bdf8", // Datageo Parana
    "#22c55e", // Portfolio
    "#a855f7", // VBP Parana
    "#f59e0b", // Precos Florestais
    "#ef4444", // Precos de Terras
    "#14b8a6", // Precos Diarios
  ];
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

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function notifyNewVisit(row) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const site = CONFIG.sites.find((s) => s.key === row.siteKey);
  const siteName = site ? site.name : row.siteKey;
  const localTime = row.ts ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(row.ts) : "--";
  const tz = row.timezone || "N/A";

  new Notification("Novo acesso", {
    body: `${siteName} — ${localTime} — ${tz}`,
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f766e'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-weight='700' font-size='16' fill='white'%3ECP%3C/text%3E%3C/svg%3E",
    tag: `visit-${row.siteKey}-${row.ts?.getTime() || Date.now()}`,
  });
}
