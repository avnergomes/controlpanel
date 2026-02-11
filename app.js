// ═══════════════════════════════════════════════════════════════════════════
// CONTROL PANEL - Traffic Dashboard v2.0
// Refactored with improved code quality, new visualizations, and better UX
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  data: [],
  bySite: {},
  lastFetched: null,
  status: {},
  charts: {},
  pollInterval: null,
  filters: {
    granularity: "day",
    period: "all",
    customStart: "",
    customEnd: "",
  },
  isLoading: false,
  timezoneGeoJSON: null,
  countriesGeoJSON: null,
};

const CACHE_KEY = "controlpanel-cache-v6";
const AUTH_SESSION_KEY = "controlpanel-session-token";
const GEOJSON_CACHE_KEY = "controlpanel-geojson-v2"; // Bumped version to force refresh
const GEOJSON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION (Server-side validation)
// ═══════════════════════════════════════════════════════════════════════════

function getSessionToken() {
  return sessionStorage.getItem(AUTH_SESSION_KEY);
}

function isAuthenticated() {
  return !!getSessionToken();
}

function clearSession() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

async function handleLogin(event) {
  event.preventDefault();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  const submitBtn = event.target.querySelector('button[type="submit"]');

  // Disable button during request
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando...";

  try {
    // Validate password on server (POST é mais seguro que GET com senha em URL)
    const response = await fetch(CONFIG.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "login", password: password })
    });
    const result = await response.json();

    if (result.success && result.token) {
      sessionStorage.setItem(AUTH_SESSION_KEY, result.token);
      document.getElementById("login-overlay").classList.add("hidden");
      initApp();
    } else {
      errorEl.hidden = false;
      document.getElementById("login-password").value = "";
      document.getElementById("login-password").focus();
    }
  } catch (err) {
    errorEl.textContent = "Erro de conexão";
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION & LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

async function initApp() {
  document.body.classList.add("loaded");
  bindNavigation();
  bindControls();
  requestNotificationPermission();
  document.getElementById("refresh-btn").addEventListener("click", () => refreshData(true));

  // Load GeoJSON first (from cache if available, very fast)
  await loadTimezoneGeoJSON();

  // Then load data cache and render
  const cached = loadCache();
  if (cached) {
    state.data = cached.data;
    state.lastFetched = cached.fetchedAt;
    indexData();
    renderCurrentView();
    updateStatus();
  }

  // Fetch fresh data (won't show loading if we have cache)
  refreshData(false);

  // Poll for updates less frequently if we have data
  const pollInterval = cached ? CONFIG.pollMs : 30000; // 30s for first load
  state.pollInterval = setInterval(() => refreshData(false), pollInterval);
}

async function loadTimezoneGeoJSON() {
  // Validate GeoJSON has required structure
  const isValidGeoJSON = (data) => {
    return data &&
           typeof data === 'object' &&
           Array.isArray(data.features) &&
           data.features.length > 0;
  };

  // Try to load from localStorage cache first
  try {
    const cached = localStorage.getItem(GEOJSON_CACHE_KEY);
    if (cached) {
      const { timezones, countries, timestamp } = JSON.parse(cached);
      const age = Date.now() - timestamp;
      if (age < GEOJSON_CACHE_TTL && isValidGeoJSON(timezones) && isValidGeoJSON(countries)) {
        state.timezoneGeoJSON = timezones;
        state.countriesGeoJSON = countries;
        return; // Use cached data
      }
    }
  } catch (e) {
    // Cache read failed, clear corrupted cache
    try { localStorage.removeItem(GEOJSON_CACHE_KEY); } catch (_) {}
  }

  // Fetch from network
  try {
    const [tzResponse, countriesResponse] = await Promise.all([
      fetch("assets/timezones.geojson"),
      fetch("assets/countries.geojson")
    ]);

    if (tzResponse.ok) {
      const tzData = await tzResponse.json();
      if (isValidGeoJSON(tzData)) {
        state.timezoneGeoJSON = tzData;
      }
    }
    if (countriesResponse.ok) {
      const countriesData = await countriesResponse.json();
      if (isValidGeoJSON(countriesData)) {
        state.countriesGeoJSON = countriesData;
      }
    }

    // Cache only if both are valid
    if (isValidGeoJSON(state.timezoneGeoJSON) && isValidGeoJSON(state.countriesGeoJSON)) {
      try {
        localStorage.setItem(GEOJSON_CACHE_KEY, JSON.stringify({
          timezones: state.timezoneGeoJSON,
          countries: state.countriesGeoJSON,
          timestamp: Date.now()
        }));
      } catch (e) {
        // Storage full or unavailable, ignore
      }
    }
  } catch (error) {
    console.warn("Failed to load GeoJSON files:", error);
  }
}

function cleanup() {
  if (state.pollInterval) {
    clearInterval(state.pollInterval);
    state.pollInterval = null;
  }
  destroyAllCharts();
}

function destroyAllCharts() {
  Object.keys(state.charts).forEach((key) => {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  });
  state.charts = {};
}

function destroyChart(canvasId) {
  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
    delete state.charts[canvasId];
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("login-form").addEventListener("submit", handleLogin);

  if (isAuthenticated()) {
    document.getElementById("login-overlay").classList.add("hidden");
    initApp();
  }
});

window.addEventListener("beforeunload", cleanup);

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION & CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

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
    const isActive = link.dataset.route === route || (isOverview && link.dataset.route === "overview");
    link.classList.toggle("active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });

  window.scrollTo({ top: 0, behavior: "smooth" });

  if (isOverview) {
    renderOverview();
  } else {
    renderSite(route);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA FETCHING & NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

async function refreshData(force) {
  if (state.isLoading) return;

  const previousMax = getMaxTimestamp(state.data);
  const previousCount = state.data.length;
  const hasCache = previousCount > 0;

  state.isLoading = true;

  // Only show loading overlay on initial load or forced refresh without cache
  if (force || !hasCache) {
    showLoading(true);
  }

  const { data, status } = await fetchAllSites();
  const nextMax = getMaxTimestamp(data);

  state.status = status;
  state.lastFetched = new Date();
  state.isLoading = false;

  showLoading(false);
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
    const sessionToken = getSessionToken();
    if (!sessionToken) {
      throw new Error("unauthorized");
    }

    const url = `${CONFIG.proxyUrl}?action=getData&token=${encodeURIComponent(sessionToken)}`;
    const response = await fetch(url, { redirect: "follow" });

    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseErr) {
      throw new Error("Resposta invalida do proxy");
    }

    // Handle session expiry
    if (payload.error === "unauthorized") {
      clearSession();
      document.getElementById("login-overlay").classList.remove("hidden");
      document.getElementById("login-error").textContent = "Sessão expirada";
      document.getElementById("login-error").hidden = false;
      throw new Error("unauthorized");
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
  if (!Array.isArray(rows)) return [];

  const schema = FIELD_SCHEMAS[site.kind];
  if (!schema) {
    console.warn(`[ControlPanel] Schema nao encontrado para: ${site.kind}`);
    return [];
  }

  return rows
    .map((row) => normalizeRow(row, site.key, site.kind, schema))
    .filter(Boolean);
}

function normalizeRow(row, siteKey, kind, schema) {
  if (!row || typeof row !== "object") return null;

  // Try schema timestamp fields first, then fallback to pattern matching
  const timestampPattern = /^(timestamp|time|date|data|hora|created|criado)/i;
  let ts = parseDate(getValue(row, schema.timestamp, timestampPattern));

  // If still no timestamp, try to find any ISO date string in the row
  if (!ts || isNaN(ts.getTime())) {
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}T/)) {
        ts = parseDate(value);
        if (ts && !isNaN(ts.getTime())) break;
      }
    }
  }

  if (!ts || isNaN(ts.getTime())) return null;

  const url = getValue(row, schema.url) || "";
  const userAgent = getValue(row, schema.userAgent) || "";
  const derived = userAgent ? parseUserAgent(userAgent) : {};

  // Common fields extraction
  const result = {
    siteKey,
    ts,
    url,
    path: getValue(row, schema.path) || extractPath(url),
    referrer: getValue(row, schema.referrer) || "",
    timezone: schema.timezonePattern
      ? getValue(row, schema.timezone) || getValueByKeyMatch(row, schema.timezonePattern) || ""
      : getValue(row, schema.timezone) || "",
    sessionId: getValue(row, schema.sessionId) || "",
    userAgent: userAgent || undefined,
    language: getValue(row, schema.language) || "",
    connectionType: getValue(row, schema.connectionType) || "",
    utmSource: getValue(row, schema.utmSource) || "",
    utmMedium: getValue(row, schema.utmMedium) || "",
    utmCampaign: getValue(row, schema.utmCampaign) || "",
  };

  // OS, Browser, Device - use explicit fields or derive from UA
  if (schema.os && schema.os.length > 0) {
    result.os = getValue(row, schema.os) || derived.os || "";
  } else {
    result.os = derived.os || "";
  }

  if (schema.browser && schema.browser.length > 0) {
    result.browser = getValue(row, schema.browser) || derived.browser || "";
  } else {
    result.browser = derived.browser || "";
  }

  if (schema.deviceType && schema.deviceType.length > 0) {
    result.deviceType = normalizeDeviceType(getValue(row, schema.deviceType) || derived.deviceType);
  } else {
    result.deviceType = normalizeDeviceType(derived.deviceType);
  }

  // Screen dimensions
  if (schema.screenWidth && schema.screenWidth.length > 0) {
    result.screenWidth = toNumber(getValue(row, schema.screenWidth));
    result.screenHeight = toNumber(getValue(row, schema.screenHeight));
  } else {
    result.screenWidth = null;
    result.screenHeight = null;
  }

  // Performance metrics
  result.loadTime = toNumber(getValue(row, schema.loadTime));

  if (schema.firstContentfulPaint && schema.firstContentfulPaint.length > 0) {
    result.firstContentfulPaint = toNumber(getValue(row, schema.firstContentfulPaint));
    result.domInteractiveTime = toNumber(getValue(row, schema.domInteractiveTime));
  } else {
    result.firstContentfulPaint = null;
    result.domInteractiveTime = null;
  }

  // Mobile flag
  if (schema.isMobile && schema.isMobile.length > 0) {
    result.isMobile = parseBool(getValue(row, schema.isMobile));
  } else {
    result.isMobile = result.deviceType === "Mobile";
  }

  // Returning visitor (use global RETURNING_FIELDS)
  if (kind !== "emprego") {
    const returningValue = getValue(row, RETURNING_FIELDS) || getValueByKeyMatch(row, RETURNING_PATTERN);
    result.returning = parseBool(returningValue);
  } else {
    result.returning = undefined;
  }

  // Additional LGPD fields (available for all sites)
  result.pageTitle = getValue(row, schema.pageTitle) || "";
  result.screenOrientation = getValue(row, schema.screenOrientation) || "";
  result.prefersColorScheme = getValue(row, schema.prefersColorScheme) || "";
  result.utmTerm = getValue(row, schema.utmTerm) || "";
  result.utmContent = getValue(row, schema.utmContent) || "";

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIELD EXTRACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getValue(row, names, fallbackPattern = null) {
  if (!names || !Array.isArray(names) || names.length === 0) {
    // If no names provided but fallbackPattern exists, try pattern matching
    if (fallbackPattern) {
      return getValueByKeyMatch(row, fallbackPattern);
    }
    return null;
  }

  const lookup = Object.keys(row).reduce((acc, key) => {
    acc[key.toLowerCase()] = row[key];
    return acc;
  }, {});

  for (const name of names) {
    const value = lookup[name.toLowerCase()];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  // Fallback: try pattern matching if provided
  if (fallbackPattern) {
    return getValueByKeyMatch(row, fallbackPattern);
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

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
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
  return isNaN(num) || num < 0 ? null : num;
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
    if (!row || !row.ts) return;
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

// ═══════════════════════════════════════════════════════════════════════════
// LOADING & EMPTY STATES
// ═══════════════════════════════════════════════════════════════════════════

let loadingTimeout = null;

function showLoading(isLoading) {
  if (isLoading) {
    // Delay showing loading to prevent flicker for fast operations
    if (!loadingTimeout) {
      loadingTimeout = setTimeout(() => {
        if (state.isLoading) {
          document.body.classList.add("is-loading");
        }
      }, 300); // 300ms delay
    }
  } else {
    // Hide immediately
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = null;
    }
    document.body.classList.remove("is-loading");
  }
}

function renderEmptyState(container, message = "Nenhum dado disponivel para o periodo selecionado.") {
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  const icon = document.createElement("div");
  icon.className = "empty-icon";
  icon.textContent = "📊";
  const p = document.createElement("p");
  p.textContent = message;
  wrapper.appendChild(icon);
  wrapper.appendChild(p);
  container.appendChild(wrapper);
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW RENDERING
// ═══════════════════════════════════════════════════════════════════════════

function renderOverview() {
  const cards = document.getElementById("overview-cards");
  cards.innerHTML = "";

  if (state.data.length === 0 && !state.isLoading) {
    renderEmptyState(cards, "Carregando dados...");
    return;
  }

  const totalVisits = state.data.length;
  const uniqueSessions = new Set(state.data.map((row) => row.sessionId).filter(Boolean)).size;
  const lastBySite = CONFIG.sites.map((site) => {
    const rows = state.bySite[site.key] || [];
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    return {
      key: site.key,
      last: lastRow ? lastRow.ts : null,
      timezone: lastRow ? lastRow.timezone : null,
      count: rows.length,
    };
  });

  // Mobile %
  const mobileCount = state.data.filter((r) => r.isMobile === true || r.deviceType === "Mobile").length;
  const mobilePct = totalVisits > 0 ? ((mobileCount / totalVisits) * 100).toFixed(1) + "%" : "N/D";

  // Avg load time
  const loadTimes = state.data.map((r) => r.loadTime).filter((v) => v && v > 0);
  const avgLoad = loadTimes.length ? (loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length / 1000).toFixed(2) + "s" : "sem dados";

  // Top browser
  const browserCounts = aggregateCounts(state.data, (r) => r.browser || "Unknown");
  const topBrowser = browserCounts.length ? browserCounts[0][0] : "N/D";

  // Returning rate
  const returningRate = computeReturningRate(state.data);

  cards.appendChild(makeCard("Total de acessos", formatNumber(totalVisits), "total"));
  cards.appendChild(makeCard("Sessoes unicas", formatNumber(uniqueSessions), "sessions"));
  cards.appendChild(makeCard("Mobile %", mobilePct, "mobile"));
  cards.appendChild(makeCard("Tempo medio de carga", avgLoad, "load"));
  cards.appendChild(makeCard("Top Browser", topBrowser, "browser"));
  cards.appendChild(makeCard("Returning rate", returningRate, "returning"));

  lastBySite.forEach((entry, index) => {
    const site = CONFIG.sites.find((item) => item.key === entry.key);
    const value = entry.last
      ? `${formatDateTime(entry.last)}${entry.timezone ? ` (${entry.timezone})` : ""}`
      : "--";
    const card = makeCard(`${site.name}`, value, "site");
    card.style.borderLeftColor = CHART_COLORS.sites[index];
    card.dataset.count = entry.count;
    cards.appendChild(card);
  });

  renderOverviewChart();
  renderOverviewTimezoneMap(state.data);
  renderOverviewDevices();
  renderOverviewBrowsers();
  renderOverviewReturning();
  renderUTMCharts();
  renderConnectionChart();
  renderThemeChart();
  renderOrientationChart();
  renderTopPages();
  renderHeatmap();
  renderComparison();
  renderTopPeriods();
}

function renderSite(siteKey) {
  const site = CONFIG.sites.find((item) => item.key === siteKey);
  if (!site) return;

  document.getElementById("site-name").textContent = site.name;
  document.getElementById("site-desc").textContent = `Serie temporal e distribuicoes para ${site.name}.`;

  const rows = state.bySite[siteKey] || [];
  const filtered = applyFilters(rows, state.filters);

  if (rows.length === 0) {
    renderEmptyState(document.getElementById("site-kpis"), "Nenhum dado disponivel para este site.");
    return;
  }

  renderSiteKpis(rows, filtered);
  renderSiteChart(siteKey, filtered);
  renderDistributions(rows);
  renderTimezoneMap(rows);
  renderPerformanceKpis(rows);
  renderLatest(rows);
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART RENDERING
// ═══════════════════════════════════════════════════════════════════════════

function renderOverviewChart() {
  const filtered = applyFilters(state.data, state.filters);

  if (filtered.length === 0) {
    const ctx = document.getElementById("overview-chart");
    if (ctx) ctx.parentElement.innerHTML = '<div class="empty-state"><p>Nenhum dado no periodo</p></div>';
    return;
  }

  const { labels, series, totals } = buildSeries(filtered, state.filters.granularity, true);

  const datasets = CONFIG.sites.map((site, index) => ({
    label: site.name,
    data: series[site.key] || labels.map(() => 0),
    borderColor: CHART_COLORS.sites[index],
    backgroundColor: CHART_COLORS.sites[index],
    tension: 0.2,
    pointRadius: 2,
  }));

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

  if (known.length === 0) {
    const ctx = document.getElementById("overview-returning-chart");
    if (ctx) ctx.parentElement.innerHTML = '<div class="empty-state small"><p>Sem dados</p></div>';
    return;
  }

  renderDoughnutChart("overview-returning-chart", [["Novos", newVisitors], ["Retornantes", returning]], "Visitantes");
}

function renderUTMCharts() {
  // UTM Source
  const sourceCounts = aggregateCounts(state.data, (r) => r.utmSource || "Direct");
  renderBarChart("utm-source-chart", sourceCounts, "UTM Source");

  // UTM Medium
  const mediumCounts = aggregateCounts(state.data, (r) => r.utmMedium || "None");
  renderBarChart("utm-medium-chart", mediumCounts, "UTM Medium");

  // UTM Campaign
  const campaignCounts = aggregateCounts(state.data, (r) => r.utmCampaign || "None");
  renderBarChart("utm-campaign-chart", campaignCounts, "UTM Campaign");
}

function renderConnectionChart() {
  const counts = aggregateCounts(state.data, (r) => r.connectionType || "Unknown");
  const ctx = document.getElementById("overview-connection-chart");
  if (!ctx) return;

  if (counts.length === 0 || (counts.length === 1 && counts[0][0] === "Unknown")) {
    ctx.parentElement.innerHTML = '<div class="empty-state small"><p>Sem dados</p></div>';
    return;
  }

  renderDoughnutChart("overview-connection-chart", counts, "Conexao");
}

function renderThemeChart() {
  const counts = aggregateCounts(state.data, (r) => {
    const theme = String(r.prefersColorScheme || "");
    if (theme.toLowerCase() === "dark") return "Dark";
    if (theme.toLowerCase() === "light") return "Light";
    return "Unknown";
  });

  const ctx = document.getElementById("overview-theme-chart");
  if (!ctx) return;

  const filtered = counts.filter(([k]) => k !== "Unknown");
  if (filtered.length === 0) {
    ctx.parentElement.innerHTML = '<div class="empty-state small"><p>Sem dados</p></div>';
    return;
  }

  renderDoughnutChart("overview-theme-chart", filtered, "Tema");
}

function renderOrientationChart() {
  const counts = aggregateCounts(state.data, (r) => {
    const orientation = String(r.screenOrientation || "");
    if (orientation.toLowerCase().includes("portrait")) return "Portrait";
    if (orientation.toLowerCase().includes("landscape")) return "Landscape";
    return "Unknown";
  });

  const ctx = document.getElementById("overview-orientation-chart");
  if (!ctx) return;

  const filtered = counts.filter(([k]) => k !== "Unknown");
  if (filtered.length === 0) {
    ctx.parentElement.innerHTML = '<div class="empty-state small"><p>Sem dados</p></div>';
    return;
  }

  renderDoughnutChart("overview-orientation-chart", filtered, "Orientacao");
}

function renderTopPages() {
  const table = document.querySelector("#top-pages tbody");
  if (!table) return;
  table.innerHTML = "";

  const pageCounts = new Map();
  state.data.forEach((row) => {
    const title = row.pageTitle || row.path || row.url || "Unknown";
    if (title && title !== "Unknown") {
      pageCounts.set(title, (pageCounts.get(title) || 0) + 1);
    }
  });

  if (pageCounts.size === 0) {
    table.innerHTML = '<tr><td colspan="3" class="empty-cell">Nenhum dado</td></tr>';
    return;
  }

  const sorted = Array.from(pageCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const total = state.data.length;

  sorted.forEach(([title, count]) => {
    const tr = document.createElement("tr");
    const pct = ((count / total) * 100).toFixed(1);
    const td1 = document.createElement("td");
    td1.textContent = truncate(title, 60);
    td1.setAttribute("title", title);
    const td2 = document.createElement("td");
    td2.textContent = formatNumber(count);
    const td3 = document.createElement("td");
    td3.textContent = pct + "%";
    tr.append(td1, td2, td3);
    table.appendChild(tr);
  });
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

function renderSiteChart(siteKey, records) {
  if (records.length === 0) {
    const ctx = document.getElementById("site-chart");
    if (ctx) ctx.parentElement.innerHTML = '<div class="empty-state"><p>Nenhum dado no periodo</p></div>';
    return;
  }

  const { labels, series } = buildSeries(records, state.filters.granularity, false);
  const site = CONFIG.sites.find((item) => item.key === siteKey);

  const datasets = [
    {
      label: site.name,
      data: series[siteKey] || labels.map(() => 0),
      borderColor: CHART_COLORS.sites[0],
      backgroundColor: CHART_COLORS.sites[0],
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

// ═══════════════════════════════════════════════════════════════════════════
// HEATMAP - Hour x Day of Week
// ═══════════════════════════════════════════════════════════════════════════

function renderHeatmap() {
  const container = document.getElementById("heatmap-container");
  if (!container) return;

  const filtered = applyFilters(state.data, state.filters);
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state small"><p>Sem dados</p></div>';
    return;
  }

  // Build 7x24 matrix (days x hours)
  const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
  let maxCount = 0;

  filtered.forEach((row) => {
    const day = row.ts.getDay();
    const hour = row.ts.getHours();
    matrix[day][hour]++;
    if (matrix[day][hour] > maxCount) maxCount = matrix[day][hour];
  });

  // Generate grid using DOM API
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "heatmap-grid";

  const corner = document.createElement("div");
  corner.className = "heatmap-corner";
  grid.appendChild(corner);

  // Hour headers
  for (let h = 0; h < 24; h++) {
    const header = document.createElement("div");
    header.className = "heatmap-header";
    header.textContent = String(h).padStart(2, "0");
    grid.appendChild(header);
  }

  // Rows
  for (let d = 0; d < 7; d++) {
    const dayLabel = document.createElement("div");
    dayLabel.className = "heatmap-day";
    dayLabel.textContent = DAYS_PT[d];
    grid.appendChild(dayLabel);

    for (let h = 0; h < 24; h++) {
      const count = matrix[d][h];
      const intensity = maxCount > 0 ? count / maxCount : 0;
      const bg = getHeatmapColor(intensity);
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      cell.style.background = bg;
      cell.setAttribute("title", `${DAYS_PT[d]} ${h}h: ${count} visitas`);
      grid.appendChild(cell);
    }
  }

  container.appendChild(grid);
}

function getHeatmapColor(intensity) {
  if (intensity === 0) return "rgba(255, 255, 255, 0.05)";
  const r = Math.round(45 + (255 - 45) * intensity);
  const g = Math.round(212 + (122 - 212) * intensity);
  const b = Math.round(191 + (24 - 191) * intensity);
  const a = 0.2 + 0.7 * intensity;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMEZONE MAP
// ═══════════════════════════════════════════════════════════════════════════

function getRecencyClass(lastAccess) {
  if (!lastAccess) return "tz-old";
  const now = new Date();
  const diffMs = now - lastAccess;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours < 1) return "tz-recent";
  if (diffDays < 1) return "tz-today";
  if (diffDays < 7) return "tz-week";
  return "tz-old";
}

function formatRelativeTime(date) {
  if (!date) return "Nunca";
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Agora";
  if (diffMins < 60) return `${diffMins}min atras`;
  if (diffHours < 24) return `${diffHours}h atras`;
  if (diffDays < 7) return `${diffDays}d atras`;
  return date.toLocaleDateString("pt-BR");
}

// Get UTC offset from IANA timezone
function getUtcOffset(timezone) {
  if (!timezone) return null;
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    return (tzDate - utcDate) / (1000 * 60 * 60);
  } catch {
    return null;
  }
}

// Simple map projection (Equirectangular)
function projectCoords(lon, lat, width, height) {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return [x, y];
}

// Convert GeoJSON coordinates to SVG path
function coordsToPath(coords, width, height) {
  if (!coords || coords.length === 0) return "";

  const processRing = (ring) => {
    return ring.map((point, i) => {
      const [x, y] = projectCoords(point[0], point[1], width, height);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ') + ' Z';
  };

  // Handle different geometry types
  if (typeof coords[0][0] === 'number') {
    // Simple polygon ring
    return processRing(coords);
  } else if (typeof coords[0][0][0] === 'number') {
    // Polygon with holes
    return coords.map(ring => processRing(ring)).join(' ');
  } else {
    // MultiPolygon
    return coords.map(polygon =>
      polygon.map(ring => processRing(ring)).join(' ')
    ).join(' ');
  }
}

// Render timezone map using GeoJSON
function renderTimezoneMap(records, containerId = "timezone-map", listContainerId = "timezone-list") {
  const mapContainer = document.getElementById(containerId);
  const listContainer = listContainerId ? document.getElementById(listContainerId) : null;

  if (!mapContainer) return;

  if (records.length === 0) {
    mapContainer.innerHTML = '<div class="empty-state small"><p>Sem dados de timezone</p></div>';
    if (listContainer) listContainer.innerHTML = '';
    return;
  }

  // Group by UTC offset zone and find most recent access
  const zoneData = new Map();
  records.forEach((row) => {
    const tz = row.timezone || "";
    const offset = getUtcOffset(tz);
    const zone = offset !== null ? Math.round(offset) : null;
    const ts = row.ts ? new Date(row.ts) : null;

    if (zone !== null) {
      const current = zoneData.get(zone) || {
        count: 0,
        lastAccess: null,
        timezones: new Set()
      };
      current.count++;
      current.timezones.add(tz);
      if (ts && (!current.lastAccess || ts > current.lastAccess)) {
        current.lastAccess = ts;
      }
      zoneData.set(zone, current);
    }
  });

  // Also group by region for the list
  const regionData = new Map();
  records.forEach((row) => {
    const tz = row.timezone || "";
    const regionInfo = TIMEZONE_REGIONS[tz] || { region: "Outros", flag: "🌍" };
    const key = regionInfo.region;
    const ts = row.ts ? new Date(row.ts) : null;

    const current = regionData.get(key) || {
      count: 0,
      flag: regionInfo.flag,
      lastAccess: null,
      subregions: new Set()
    };
    current.count++;
    if (regionInfo.subregion) current.subregions.add(regionInfo.subregion);
    if (ts && (!current.lastAccess || ts > current.lastAccess)) {
      current.lastAccess = ts;
    }
    regionData.set(key, current);
  });

  const total = records.length;

  // Render SVG world map
  const svgNS = "http://www.w3.org/2000/svg";
  const width = 900;
  const height = 400;
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "world-map-svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Background
  const bg = document.createElementNS(svgNS, "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", height);
  bg.setAttribute("fill", "rgba(255,255,255,0.02)");
  bg.setAttribute("rx", "12");
  svg.appendChild(bg);

  // Draw country outlines (background layer)
  if (state.countriesGeoJSON && state.countriesGeoJSON.features) {
    const countriesGroup = document.createElementNS(svgNS, "g");
    countriesGroup.setAttribute("class", "countries-layer");

    state.countriesGeoJSON.features.forEach((feature) => {
      const geom = feature.geometry;
      if (!geom) return;

      let pathD = "";
      if (geom.type === "Polygon") {
        pathD = coordsToPath(geom.coordinates, width, height);
      } else if (geom.type === "MultiPolygon") {
        pathD = geom.coordinates.map(poly =>
          coordsToPath(poly, width, height)
        ).join(' ');
      }

      if (pathD) {
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", pathD);
        path.setAttribute("class", "country-path");
        countriesGroup.appendChild(path);
      }
    });

    svg.appendChild(countriesGroup);
  }

  // Draw timezone regions from GeoJSON
  if (state.timezoneGeoJSON && state.timezoneGeoJSON.features) {
    state.timezoneGeoJSON.features.forEach((feature) => {
      const props = feature.properties;
      const zone = props.zone;
      const geom = feature.geometry;

      if (!geom) return;

      const data = zoneData.get(Math.round(zone));
      const recencyClass = data ? getRecencyClass(data.lastAccess) : "tz-inactive";

      const group = document.createElementNS(svgNS, "g");
      group.setAttribute("class", `map-region ${recencyClass}`);
      group.setAttribute("data-zone", zone);

      // Convert geometry to path
      let pathD = "";
      if (geom.type === "Polygon") {
        pathD = coordsToPath(geom.coordinates, width, height);
      } else if (geom.type === "MultiPolygon") {
        pathD = geom.coordinates.map(poly =>
          coordsToPath(poly, width, height)
        ).join(' ');
      }

      if (pathD) {
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", pathD);
        path.setAttribute("class", "region-path");

        // Tooltip
        const utcLabel = props.utc_format || `UTC${zone >= 0 ? '+' : ''}${zone}`;
        if (data) {
          const tzList = Array.from(data.timezones).slice(0, 3).join(", ");
          const tzMore = data.timezones.size > 3 ? ` +${data.timezones.size - 3}` : "";
          path.setAttribute("data-tooltip", `${utcLabel}\n${tzList}${tzMore}\n${data.count} visitas, ${formatRelativeTime(data.lastAccess)}`);
        } else {
          path.setAttribute("data-tooltip", utcLabel);
        }

        group.appendChild(path);
      }

      svg.appendChild(group);
    });
  } else {
    // Fallback: draw simple vertical timezone bands
    for (let z = -12; z <= 12; z++) {
      const data = zoneData.get(z);
      const recencyClass = data ? getRecencyClass(data.lastAccess) : "tz-inactive";

      const x = ((z + 12) / 24) * width;
      const bandWidth = width / 24;

      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", 0);
      rect.setAttribute("width", bandWidth);
      rect.setAttribute("height", height);
      rect.setAttribute("class", `region-path ${recencyClass}`);

      if (data) {
        const tzList = Array.from(data.timezones).slice(0, 3).join(", ");
        const tzMore = data.timezones.size > 3 ? ` +${data.timezones.size - 3}` : "";
        rect.setAttribute("data-tooltip", `UTC${z >= 0 ? '+' : ''}${z}\n${tzList}${tzMore}\n${data.count} visitas, ${formatRelativeTime(data.lastAccess)}`);
      }

      svg.appendChild(rect);

      // Zone label
      if (z % 3 === 0) {
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", x + bandWidth / 2);
        text.setAttribute("y", height - 10);
        text.setAttribute("class", "zone-label");
        text.textContent = `${z >= 0 ? '+' : ''}${z}`;
        svg.appendChild(text);
      }
    }
  }

  mapContainer.innerHTML = "";
  mapContainer.appendChild(svg);

  // Add tooltip handler
  svg.addEventListener("mousemove", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target) {
      showMapTooltip(e, target.getAttribute("data-tooltip"));
    } else {
      hideMapTooltip();
    }
  });
  svg.addEventListener("mouseleave", hideMapTooltip);

  // Render list below the map
  if (listContainer) {
    const sorted = Array.from(regionData.entries()).sort((a, b) => {
      if (!a[1].lastAccess && !b[1].lastAccess) return b[1].count - a[1].count;
      if (!a[1].lastAccess) return 1;
      if (!b[1].lastAccess) return -1;
      return b[1].lastAccess - a[1].lastAccess;
    });

    listContainer.innerHTML = "";
    const list = document.createElement("div");
    list.className = "timezone-list";

    sorted.forEach(([region, data]) => {
      const pct = ((data.count / total) * 100).toFixed(1);
      const recencyClass = getRecencyClass(data.lastAccess);

      const item = document.createElement("div");
      item.className = `timezone-item ${recencyClass}`;

      const flag = document.createElement("span");
      flag.className = "tz-flag";
      flag.textContent = data.flag;

      const regionEl = document.createElement("span");
      regionEl.className = "tz-region";
      regionEl.textContent = region;

      const subregionsEl = document.createElement("span");
      subregionsEl.className = "tz-subregions";
      if (data.subregions.size > 0) {
        subregionsEl.textContent = Array.from(data.subregions).slice(0, 3).join(", ");
      }

      const timeEl = document.createElement("span");
      timeEl.className = "tz-time";
      timeEl.textContent = formatRelativeTime(data.lastAccess);

      const countEl = document.createElement("span");
      countEl.className = "tz-count";
      countEl.textContent = formatNumber(data.count);

      const pctEl = document.createElement("span");
      pctEl.className = "tz-pct";
      pctEl.textContent = pct + "%";

      item.append(flag, regionEl, subregionsEl, timeEl, countEl, pctEl);
      list.appendChild(item);
    });

    listContainer.appendChild(list);
  }
}

// Map tooltip helpers
let mapTooltipEl = null;

function showMapTooltip(event, text) {
  if (!mapTooltipEl) {
    mapTooltipEl = document.createElement("div");
    mapTooltipEl.className = "map-tooltip";
    document.body.appendChild(mapTooltipEl);
  }
  mapTooltipEl.textContent = text;
  mapTooltipEl.style.display = "block";
  mapTooltipEl.style.left = (event.pageX + 10) + "px";
  mapTooltipEl.style.top = (event.pageY + 10) + "px";
}

function hideMapTooltip() {
  if (mapTooltipEl) {
    mapTooltipEl.style.display = "none";
  }
}

// Render overview timezone map (all sites combined)
function renderOverviewTimezoneMap(records) {
  renderTimezoneMap(records, "overview-timezone-map", null);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DATA
// ═══════════════════════════════════════════════════════════════════════════

function exportData(format = "csv") {
  const route = (location.hash || "#/overview").replace("#/", "");
  const isOverview = route === "overview" || route === "";

  let records = isOverview ? state.data : (state.bySite[route] || []);
  records = applyFilters(records, state.filters);

  if (records.length === 0) {
    showToast("Nenhum dado para exportar");
    return;
  }

  if (format === "csv") {
    exportCSV(records, route);
  } else if (format === "json") {
    exportJSON(records, route);
  }
}

function exportCSV(records, filename) {
  const headers = ["Data", "Site", "URL", "Path", "Referrer", "Timezone", "OS", "Browser", "Dispositivo", "Idioma", "LoadTime(ms)"];
  const rows = records.map((r) => [
    r.ts ? r.ts.toISOString() : "",
    r.siteKey || "",
    r.url || "",
    r.path || "",
    r.referrer || "",
    r.timezone || "",
    r.os || "",
    r.browser || "",
    r.deviceType || "",
    r.language || "",
    r.loadTime || "",
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  downloadFile(csvContent, `controlpanel-${filename}-${formatDateForFilename(new Date())}.csv`, "text/csv");
}

function exportJSON(records, filename) {
  const jsonContent = JSON.stringify(records, null, 2);
  downloadFile(jsonContent, `controlpanel-${filename}-${formatDateForFilename(new Date())}.json`, "application/json");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Exportado: ${filename}`);
}

function formatDateForFilename(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SITE COMPARISON TABLE
// ═══════════════════════════════════════════════════════════════════════════

function renderComparison() {
  const container = document.getElementById("comparison-table");
  if (!container) return;

  const tbody = container.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  CONFIG.sites.forEach((site, index) => {
    const rows = state.bySite[site.key] || [];
    const filtered = applyFilters(rows, state.filters);

    const total = rows.length;
    const periodCount = filtered.length;
    const uniqueSessions = new Set(rows.map((r) => r.sessionId).filter(Boolean)).size;
    const mobileCount = rows.filter((r) => r.deviceType === "Mobile").length;
    const mobilePct = total > 0 ? ((mobileCount / total) * 100).toFixed(1) : "0";
    const loadTimes = rows.map((r) => r.loadTime).filter((v) => v && v > 0);
    const avgLoad = loadTimes.length ? (loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length / 1000).toFixed(2) : "--";
    const lastAccess = rows.length ? formatDateTime(rows[rows.length - 1].ts) : "--";

    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = site.name;
    tdName.style.borderLeft = `3px solid ${CHART_COLORS.sites[index]}`;
    const tdTotal = document.createElement("td");
    tdTotal.textContent = formatNumber(total);
    const tdPeriod = document.createElement("td");
    tdPeriod.textContent = formatNumber(periodCount);
    const tdSessions = document.createElement("td");
    tdSessions.textContent = formatNumber(uniqueSessions);
    const tdMobile = document.createElement("td");
    tdMobile.textContent = mobilePct + "%";
    const tdLoad = document.createElement("td");
    tdLoad.textContent = avgLoad + "s";
    const tdLast = document.createElement("td");
    tdLast.textContent = lastAccess;
    tr.append(tdName, tdTotal, tdPeriod, tdSessions, tdMobile, tdLoad, tdLast);
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE & LATEST
// ═══════════════════════════════════════════════════════════════════════════

function renderPerformanceKpis(records) {
  const target = document.getElementById("site-performance");
  if (!target) return;
  target.innerHTML = "";

  // Apenas loadTime é coletado pelo tracking LGPD
  const loadTimes = records.map((r) => r.loadTime).filter((v) => v && v > 0);

  if (loadTimes.length === 0) {
    target.parentElement.style.display = "none";
    return;
  }

  target.parentElement.style.display = "";
  const avg = (loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length / 1000).toFixed(2);
  const min = (Math.min(...loadTimes) / 1000).toFixed(2);
  const max = (Math.max(...loadTimes) / 1000).toFixed(2);

  target.appendChild(makeCard("Tempo medio", avg + "s", "perf"));
  target.appendChild(makeCard("Mais rapido", min + "s", "perf"));
  target.appendChild(makeCard("Mais lento", max + "s", "perf"));
}

function renderLatest(records) {
  const table = document.querySelector("#latest-table tbody");
  if (!table) return;
  table.innerHTML = "";

  if (records.length === 0) {
    table.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhum registro</td></tr>';
    return;
  }

  const sorted = [...records].sort((a, b) => b.ts - a.ts).slice(0, CONFIG.maxLatest);
  sorted.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = [
      formatDateTime(row.ts),
      row.path || row.url || "--",
      normalizeReferrer(row.referrer),
      row.timezone || "--",
      row.os || "--",
      row.browser || "--",
      row.deviceType || "--",
    ];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
}

function renderSiteKpis(allRows, filteredRows) {
  const target = document.getElementById("site-kpis");
  if (!target) return;
  target.innerHTML = "";

  const total = allRows.length;
  const uniqueSessions = new Set(allRows.map((row) => row.sessionId).filter(Boolean)).size;
  const singleVisitSessions = countSingleVisitSessions(allRows);
  const returningRate = computeReturningRate(allRows);

  target.appendChild(makeCard("Total de acessos", formatNumber(total), "total"));
  target.appendChild(makeCard("Sessoes unicas", formatNumber(uniqueSessions), "sessions"));
  target.appendChild(makeCard("Acessos sem repeticao", formatNumber(singleVisitSessions), "single"));
  target.appendChild(makeCard("Returning rate", returningRate, "returning"));
  target.appendChild(makeCard("Acessos no periodo", formatNumber(filteredRows.length), "period"));
}

function renderTopPeriods() {
  const table = document.querySelector("#top-periods tbody");
  if (!table) return;
  table.innerHTML = "";

  const filtered = applyFilters(state.data, state.filters);
  if (filtered.length === 0) {
    table.innerHTML = '<tr><td colspan="2" class="empty-cell">Nenhum dado</td></tr>';
    return;
  }

  const { labels, totals } = buildSeries(filtered, state.filters.granularity, true);
  const pairs = labels.map((label, index) => ({ label, total: totals[index] }));
  pairs.sort((a, b) => b.total - a.total);

  pairs.slice(0, 10).forEach((entry) => {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = entry.label;
    const tdTotal = document.createElement("td");
    tdTotal.textContent = formatNumber(entry.total);
    tr.appendChild(tdLabel);
    tr.appendChild(tdTotal);
    table.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function renderLineChart(canvasId, labels, datasets, yLabel) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  destroyChart(canvasId);

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

  destroyChart(canvasId);

  if (entries.length === 0) {
    ctx.parentElement.innerHTML = '<div class="empty-state small"><p>Sem dados</p></div>';
    return;
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

  destroyChart(canvasId);

  const labels = entries.map((e) => e[0]);
  const values = entries.map((e) => e[1]);

  state.charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: CHART_COLORS.doughnut.slice(0, labels.length),
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

// ═══════════════════════════════════════════════════════════════════════════
// SERIES & AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function makeCard(title, value, type = "") {
  const card = document.createElement("div");
  card.className = "card";
  if (type) card.dataset.cardType = type;
  const h3 = document.createElement("h3");
  h3.textContent = title;
  const div = document.createElement("div");
  div.className = "value";
  div.textContent = value;
  card.appendChild(h3);
  card.appendChild(div);
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
  return CHART_COLORS.sites[index % CHART_COLORS.sites.length];
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

// ═══════════════════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════════════════

function saveCache() {
  try {
    const payload = {
      fetchedAt: state.lastFetched?.toISOString(),
      data: state.data.map((row) => ({ ...row, ts: row.ts.toISOString() })),
    };
    const json = JSON.stringify(payload);
    if (json.length < 5000000) { // 5MB limit
      localStorage.setItem(CACHE_KEY, json);
    }
  } catch (e) {
    console.warn("[ControlPanel] Cache save failed:", e);
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

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

// Expose export function globally
window.exportData = exportData;
