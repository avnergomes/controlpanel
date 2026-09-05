/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OBSERVATORY PROXY v3 · Google Apps Script (tracking + auth + data proxy)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Backward compatible with the v2 client and the v2 tracking snippet. New in v3:
 *   - Secrets live in Script Properties (PASSWORD_HASH, GITHUB_TOKEN optional),
 *     so this file can be versioned without leaking credentials.
 *   - Chunked CacheService storage: the full payload is cached even when it is
 *     larger than the 100 KB per-key limit (v2 effectively never cached).
 *   - Columnar format ({headers, values}) when the client sends format:"columnar"
 *     (≈45% smaller than row objects).
 *   - Delta fetch: `since` (ISO timestamp) returns only newer rows + delta:true.
 *   - GitHub relay (action:"github") with optional token, cached 10 min.
 *   - D3D Inovação added to SITES. Legacy query-string token removed.
 *
 * INSTALL
 *   1. Apps Script editor → paste this file over the old code.
 *   2. Project Settings → Script Properties:
 *        PASSWORD_HASH  = <sha256 hex of the admin password> (copy from the old file)
 *        GITHUB_TOKEN   = <optional fine-grained PAT, read-only public repos>
 *   3. Deploy → Manage deployments → Edit → New version → Deploy
 *      (keep the same deployment so the URL does not change).
 *   4. Run setupAllSheets() once if a new site was added.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

var VERSION = '3.0';
var SESSION_DURATION_SECONDS = 3600;   // 1 h
var RATE_LIMIT_PER_MINUTE = 60;        // tracking hits per origin per minute
var DATA_CACHE_SECONDS = 180;          // proxy payload cache
var GITHUB_CACHE_SECONDS = 600;        // GitHub relay cache
var CHUNK_SIZE = 90000;                // CacheService max is 100 KB per key

var SITES = [
  { key: 'datageoparana',        urlKey: 'datageoparana.github.io',              name: 'Datageo Parana',       sheetId: '1UIhobwGjfmAoPY6COppYsp_sNcfCSjANH6RiPZcJTMY', gids: [701835007],           trackingSheet: 'Tracking LGPD', kind: 'precos' },
  { key: 'portfolio',            urlKey: 'avnergomes.github.io/portfolio',       name: 'Portfolio',            sheetId: '17wXvFfRcrl6bbzFMwX7TF7o99t7XBa3khQBC1Hroq5M', gids: [1617126613],          trackingSheet: 'Tracking LGPD', kind: 'portfolio' },
  { key: 'vbp-parana',           urlKey: 'avnergomes.github.io/vbp-parana',      name: 'VBP Parana',           sheetId: '1SwbupTGRM0DXleSSg1lO_HllDZbTF6x39ryPJRh5UX4', gids: [13565778, 1184050764], trackingSheet: 'Tracking LGPD', kind: 'vbp' },
  { key: 'precos-florestais',    urlKey: 'avnergomes.github.io/precos-florestais', name: 'Precos Florestais',  sheetId: '1Pz57YYeQxhSgHc10kzSM71akB2VzlhzK_pXxwVnvcGA', gids: [997539922],           trackingSheet: 'Tracking LGPD', kind: 'precos' },
  { key: 'precos-terras',        urlKey: 'avnergomes.github.io/precos-de-terras', name: 'Precos de Terras',    sheetId: '1yejFvAzuRfWQkdP78I-1yWGJ7aygnTEzPpvI4kw20UQ', gids: [1804289745],          trackingSheet: 'Tracking LGPD', kind: 'precos' },
  { key: 'precos-diarios',       urlKey: 'avnergomes.github.io/precos-diarios',  name: 'Precos Diarios',       sheetId: '1bwiH0HTIngFw2ZfAXLQI-YlpajJvVTuFsfugHLYOUhE', gids: [1237498394],          trackingSheet: 'Tracking LGPD', kind: 'precos' },
  { key: 'comexstat-parana',     urlKey: 'avnergomes.github.io/comexstat-parana', name: 'ComexStat Parana',    sheetId: '1b2fAHbUvM1waszTOsR81KqVYuZhhnGUTpfXusHLC8L8', gids: [0],                   trackingSheet: 'Tracking LGPD', kind: 'comex' },
  { key: 'emprego-agro-parana',  urlKey: 'avnergomes.github.io/emprego-agro-parana', name: 'Emprego Agro Parana', sheetId: '1_l73NZ9S3s1m3uhs94gWqrgpbVgdYE-C3SjVFYz4rdo', gids: [0],               trackingSheet: 'Tracking LGPD', kind: 'emprego' },
  { key: 'censo-parana',         urlKey: 'datageoparana.github.io/censo-parana', name: 'Censo Parana',         sheetId: '1vsO-5-FJbEY1OgyiCS-a5z4lW9YLkKR1HZlrATYR648', gids: [0],                   trackingSheet: 'Tracking LGPD', kind: 'censo' },
  { key: 'credito-rural-parana', urlKey: 'avnergomes.github.io/credito-rural-parana', name: 'Credito Rural Parana', sheetId: '1_feiILubJUEi8F1_uhbgLTzTcGn33UjcWaMB0byOsF8', gids: [597680191],    trackingSheet: 'Tracking LGPD', kind: 'credito' },
  { key: 'saude-parana',         urlKey: 'avnergomes.github.io/saude-parana',    name: 'Saude Parana',         sheetId: '1LgoCt8vXI4m-wCcK4v3MikEiCa9WYKIOKBR-DotuBjs', gids: [1319041410],          trackingSheet: 'Tracking LGPD', kind: 'saude' },
  { key: 'seguranca-parana',     urlKey: 'avnergomes.github.io/seguranca-parana', name: 'Seguranca Parana',    sheetId: '1TWq7msys6BeQOf2eK_F6sg5_2lzXSqtxFtutR_W-1Ms', gids: [39482094],            trackingSheet: 'Tracking LGPD', kind: 'seguranca' },
  { key: 'cwbtopo',              urlKey: 'cwbtopo.github.io',                    name: 'CWB Topografia',       sheetId: '1Owf1vtDOOYnTa8tIAwbJze6gucviOmqWp5NBRftg1g8', gids: [0],                   trackingSheet: 'Tracking LGPD', kind: 'cwbtopo' },
  { key: 'c2-parana',            urlKey: 'avnergomes.github.io/c2-parana',       name: 'C2 Parana',            sheetId: '1ggmbcGUTv5gw3i2VCDckEF-Yv2qtWSg8oZk66HA-FZ0', gids: [0],                   trackingSheet: 'Tracking LGPD', kind: 'c2parana' },
  { key: 'dayane-psicologia',    urlKey: 'dayanebuenogomes.github.io',           name: 'Dayane Psicologia',    sheetId: '1fWQcaXf8ttidVwMWcFPIBYFVJd5553o0OjrZw4MQ2WA', gids: [0],                   trackingSheet: 'Tracking LGPD', kind: 'psicologia' },
  // TODO(avner): create the spreadsheet for D3D and paste its id here, then run setupAllSheets().
  { key: 'd3d',                  urlKey: 'd3dinovacao.github.io',                name: 'D3D Inovacao',         sheetId: '',                                             gids: [],                    trackingSheet: 'Tracking LGPD', kind: 'd3d' },
];

var ALLOWED_ORIGINS = [
  'https://avnergomes.github.io',
  'https://datageoparana.github.io',
  'https://cwbtopo.github.io',
  'https://dayanebuenogomes.github.io',
  'https://d3dinovacao.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

var GITHUB_ACCOUNTS = ['avnergomes', 'datageoparana', 'cwbtopo', 'dayanebuenogomes', 'd3dinovacao'];

// LGPD-compliant anonymous columns (19).
var TRACKING_COLUMNS = [
  'site', 'timestamp', 'timezone', 'timezoneOffset',
  'page', 'pathname', 'referrer', 'pageTitle',
  'language', 'deviceType', 'screenOrientation',
  'connectionType', 'loadTime',
  'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent',
  'prefersColorScheme',
];

var TRACKING_SHEET_NAMES = ['Tracking LGPD', 'Tracking Data', 'Visits', 'Analytics', 'tracking', 'visits'];

// ═══════════════════════════════════════════════════════════════════════════
// SECRETS + AUTH
// ═══════════════════════════════════════════════════════════════════════════

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function hashPassword_(password) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// Optional PASSWORD_SALT property: hash = sha256(salt + password). Without it the
// hash is sha256(password), compatible with the v2 constant.
function checkPassword_(password) {
  var expected = prop_('PASSWORD_HASH');
  if (!expected || !password) return false;
  var salt = prop_('PASSWORD_SALT');
  return hashPassword_(salt + password) === expected.toLowerCase();
}

// Sessions slide: every validated request renews the TTL, up to an absolute cap.
var SESSION_ABSOLUTE_MAX_MS = 12 * 3600 * 1000;

function generateSessionToken_() {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('session_' + token, String(Date.now()), SESSION_DURATION_SECONDS);
  return token;
}

function validateSession_(token) {
  if (!token || String(token).length > 64) return false;
  var cache = CacheService.getScriptCache();
  var created = cache.get('session_' + token);
  if (!created) return false;
  var createdMs = created === 'valid' ? Date.now() : parseInt(created, 10);
  if (isNaN(createdMs) || Date.now() - createdMs > SESSION_ABSOLUTE_MAX_MS) {
    cache.remove('session_' + token);
    return false;
  }
  cache.put('session_' + token, String(createdMs), SESSION_DURATION_SECONDS);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHUNKED CACHE (CacheService caps values at 100 KB)
// ═══════════════════════════════════════════════════════════════════════════

function cachePutLarge_(key, text, seconds) {
  var cache = CacheService.getScriptCache();
  var chunks = {};
  var count = Math.ceil(text.length / CHUNK_SIZE);
  if (count > 50) return false; // ~4.5 MB hard stop; payload too big to cache
  for (var i = 0; i < count; i++) chunks[key + '_' + i] = text.substr(i * CHUNK_SIZE, CHUNK_SIZE);
  chunks[key + '_n'] = String(count);
  cache.putAll(chunks, seconds);
  return true;
}

function cacheGetLarge_(key) {
  var cache = CacheService.getScriptCache();
  var n = cache.get(key + '_n');
  if (!n) return null;
  var count = parseInt(n, 10);
  var keys = [];
  for (var i = 0; i < count; i++) keys.push(key + '_' + i);
  var parts = cache.getAll(keys);
  var out = '';
  for (var j = 0; j < count; j++) {
    var part = parts[key + '_' + j];
    if (part === undefined || part === null) return null; // partial eviction
    out += part;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// doGet — public status only (login/getData moved to POST bodies)
// ═══════════════════════════════════════════════════════════════════════════

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'health') {
    return jsonResponse_({ status: 'ok', version: VERSION, sites: SITES.length, cached: !!CacheService.getScriptCache().get('proxy_all_n') });
  }
  return jsonResponse_({
    status: 'ok',
    message: 'Observatory proxy + tracking LGPD',
    version: VERSION,
    sites: SITES.length,
    trackingFields: TRACKING_COLUMNS.length,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// doPost — tracking hits (sites) and panel actions (login / getData / github)
// ═══════════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonResponse_({ status: 'error', message: 'no data received' });
    var data = validatePayload_(e.postData.contents);
    if (!data) return jsonResponse_({ status: 'error', message: 'invalid payload' });

    if (data.action === 'login') {
      if (checkPassword_(data.password)) return jsonResponse_({ success: true, token: generateSessionToken_(), version: VERSION });
      Utilities.sleep(400); // slow down brute force
      return jsonResponse_({ success: false, error: 'invalid_password' });
    }

    if (data.action === 'getData') {
      if (!validateSession_(data.token)) return jsonResponse_({ error: 'unauthorized', message: 'Sessao invalida ou expirada' });
      return jsonResponse_(buildDataResponse_(data));
    }

    if (data.action === 'github') {
      if (!validateSession_(data.token)) return jsonResponse_({ error: 'unauthorized' });
      return jsonResponse_(fetchGithub_());
    }

    return handleTracking_(data);
  } catch (error) {
    return jsonResponse_({ status: 'error', message: String(error) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA PROXY
// ═══════════════════════════════════════════════════════════════════════════

function buildDataResponse_(request) {
  var columnar = request.format === 'columnar';
  var since = request.since ? new Date(request.since) : null;
  if (since && isNaN(since.getTime())) since = null;

  var full = readAllSitesCached_();
  var result = { fetchedAt: full.fetchedAt, version: VERSION, format: columnar ? 'columnar' : 'legacy', delta: !!since, sites: {} };

  for (var key in full.sites) {
    var site = full.sites[key];
    var rows = site.rows;
    if (since) rows = rows.filter(function (row) { return rowTimestamp_(row) > since; });
    var entry = { name: site.name, kind: site.kind, status: site.status };
    if (site.error) entry.error = site.error;
    if (columnar) {
      var col = toColumnar_(rows);
      entry.headers = col.headers;
      entry.values = col.values;
    } else {
      entry.rows = rows;
    }
    result.sites[key] = entry;
  }
  return result;
}

function rowTimestamp_(row) {
  var value = row.timestamp || row.Timestamp || row['Client Timestamp'] || row.Date || row.date || '';
  var d = new Date(value);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function toColumnar_(rows) {
  var headers = [];
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    for (var k in rows[i]) if (!seen[k]) { seen[k] = true; headers.push(k); }
  }
  var values = rows.map(function (row) { return headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }); });
  return { headers: headers, values: values };
}

function readAllSitesCached_() {
  var cached = cacheGetLarge_('proxy_all');
  if (cached) {
    try { return JSON.parse(cached); } catch (err) { /* fall through */ }
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    cached = cacheGetLarge_('proxy_all');
    if (cached) return JSON.parse(cached);
    var result = { fetchedAt: new Date().toISOString(), sites: {} };
    for (var i = 0; i < SITES.length; i++) {
      var site = SITES[i];
      if (!site.sheetId) {
        result.sites[site.key] = { name: site.name, kind: site.kind, rows: [], status: 'error', error: 'sheetId not configured' };
        continue;
      }
      try {
        result.sites[site.key] = { name: site.name, kind: site.kind, rows: readSiteRows_(site), status: 'ok' };
      } catch (err) {
        result.sites[site.key] = { name: site.name, kind: site.kind, rows: [], status: 'error', error: String(err && err.message || err) };
      }
    }
    try { cachePutLarge_('proxy_all', JSON.stringify(result), DATA_CACHE_SECONDS); } catch (err) { /* ignore */ }
    return result;
  } finally {
    lock.releaseLock();
  }
}

function readSiteRows_(site) {
  var allRows = [];
  var ss = SpreadsheetApp.openById(site.sheetId);
  var readSheetNames = {};
  for (var g = 0; g < site.gids.length; g++) {
    var sheet = getSheetByGid_(ss, site.gids[g]);
    if (!sheet) continue;
    readSheetNames[sheet.getName()] = true;
    allRows = allRows.concat(readSheetData_(sheet));
  }
  for (var t = 0; t < TRACKING_SHEET_NAMES.length; t++) {
    var name = TRACKING_SHEET_NAMES[t];
    if (readSheetNames[name]) continue;
    var trackingSheet = ss.getSheetByName(name);
    if (trackingSheet) {
      readSheetNames[name] = true;
      allRows = allRows.concat(readSheetData_(trackingSheet));
    }
  }
  return allRows;
}

// LGPD minimization: legacy tabs carry columns the panel never uses and that could
// help fingerprint a visitor. They are dropped before leaving the server.
var DROP_COLUMN_PATTERN = /(user\s*agent|session\s*id|^ip$|ip\s*address|e-?mail|screen\s*(width|height|resolution)|fingerprint|cookie)/i;

function readSheetData_(sheet) {
  var rows = [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return rows;
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function (h) {
    var name = String(h).trim();
    return DROP_COLUMN_PATTERN.test(name) ? '' : name;
  });
  for (var r = 1; r < data.length; r++) {
    var row = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var val = data[r][c];
      if (val instanceof Date) val = val.toISOString();
      if (val !== '' && val !== null && val !== undefined) empty = false;
      row[headers[c]] = val;
    }
    if (!empty) rows.push(row);
  }
  return rows;
}

function getSheetByGid_(spreadsheet, gid) {
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getSheetId() === gid) return sheets[i];
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GITHUB RELAY (optional token keeps the panel off the 60/h anonymous limit)
// ═══════════════════════════════════════════════════════════════════════════

function fetchGithub_() {
  var cached = cacheGetLarge_('github_all');
  if (cached) {
    try { return JSON.parse(cached); } catch (err) { /* refetch */ }
  }
  var token = prop_('GITHUB_TOKEN');
  var headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'observatory-proxy' };
  if (token) headers.Authorization = 'Bearer ' + token;
  var repos = [];
  var accounts = [];
  var remaining = null;
  for (var i = 0; i < GITHUB_ACCOUNTS.length; i++) {
    var account = GITHUB_ACCOUNTS[i];
    var response = UrlFetchApp.fetch('https://api.github.com/users/' + account + '/repos?per_page=100&sort=pushed', { headers: headers, muteHttpExceptions: true });
    var rem = response.getHeaders()['x-ratelimit-remaining'];
    if (rem !== undefined) remaining = remaining === null ? Number(rem) : Math.min(remaining, Number(rem));
    if (response.getResponseCode() !== 200) { accounts.push({ account: account, count: 0, error: response.getResponseCode() }); continue; }
    var list = JSON.parse(response.getContentText());
    accounts.push({ account: account, count: list.length });
    for (var j = 0; j < list.length; j++) repos.push(compactRepo_(list[j]));
  }
  var result = { fetchedAt: new Date().toISOString(), authenticated: !!token, accounts: accounts, repos: repos, remaining: remaining };
  try { cachePutLarge_('github_all', JSON.stringify(result), GITHUB_CACHE_SECONDS); } catch (err) { /* ignore */ }
  return result;
}

function compactRepo_(repo) {
  return {
    fullName: repo.full_name, name: repo.name, owner: repo.owner && repo.owner.login, description: repo.description || '',
    language: repo.language || '', stars: repo.stargazers_count || 0, forks: repo.forks_count || 0, openIssues: repo.open_issues_count || 0,
    hasPages: !!repo.has_pages, archived: !!repo.archived, fork: !!repo.fork, pushedAt: repo.pushed_at, updatedAt: repo.updated_at,
    createdAt: repo.created_at, htmlUrl: repo.html_url, homepage: repo.homepage || '', size: repo.size || 0, defaultBranch: repo.default_branch || 'main',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACKING (sites POST anonymous pageviews)
// ═══════════════════════════════════════════════════════════════════════════

function handleTracking_(data) {
  var origin = data.origin || '';
  if (!isAllowedOrigin_(origin)) return jsonResponse_({ status: 'error', message: 'forbidden origin' });
  if (!checkRateLimit_(origin)) return jsonResponse_({ status: 'error', message: 'rate limited' });
  var site = identifySite_(data);
  if (!site) return jsonResponse_({ status: 'error', message: 'unknown site' });
  if (!site.sheetId) return jsonResponse_({ status: 'error', message: 'site without spreadsheet' });
  data.site = site.name;
  saveTracking_(site, data);
  return jsonResponse_({ status: 'success', site: site.name, campos: TRACKING_COLUMNS.length });
}

function identifySite_(data) {
  var page = String(data.page || data.pathname || '');
  var origin = String(data.origin || '');
  // Longest urlKey first so "avnergomes.github.io/portfolio" wins over a bare host.
  var sites = SITES.slice().sort(function (a, b) { return b.urlKey.length - a.urlKey.length; });
  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var parts = site.urlKey.split('/');
    var host = parts[0];
    var path = parts.length > 1 ? '/' + parts.slice(1).join('/') : '';
    var hostMatch = page.indexOf(host) !== -1 || origin.indexOf(host) !== -1;
    if (!hostMatch) continue;
    if (!path || page.indexOf(path) !== -1) return site;
  }
  return null;
}

function saveTracking_(site, data) {
  var ss = SpreadsheetApp.openById(site.sheetId);
  var sheet = ss.getSheetByName(site.trackingSheet);
  if (!sheet) {
    sheet = ss.insertSheet(site.trackingSheet);
    setupTrackingHeaders_(sheet);
  }
  sheet.appendRow(TRACKING_COLUMNS.map(function (col) { return sanitize_(data[col]); }));
}

function setupTrackingHeaders_(sheet) {
  sheet.getRange(1, 1, 1, TRACKING_COLUMNS.length).setValues([TRACKING_COLUMNS]);
  var header = sheet.getRange(1, 1, 1, TRACKING_COLUMNS.length);
  header.setFontWeight('bold');
  header.setBackground('#1a56db');
  header.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function isAllowedOrigin_(origin) {
  if (!origin) return false;
  var normalized = String(origin).replace(/\/$/, '');
  for (var i = 0; i < ALLOWED_ORIGINS.length; i++) {
    var allowed = ALLOWED_ORIGINS[i];
    // Exact host match, or localhost with a port.
    if (normalized === allowed) return true;
    if ((allowed === 'http://localhost' || allowed === 'http://127.0.0.1') && normalized.indexOf(allowed + ':') === 0) return true;
  }
  return false;
}

// Rate limit keyed by origin only (client-supplied timestamps are not trusted).
function checkRateLimit_(origin) {
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + origin.replace(/[^a-z0-9.]/gi, '').substring(0, 40);
  var count = parseInt(cache.get(key) || '0', 10);
  if (count >= RATE_LIMIT_PER_MINUTE) return false;
  cache.put(key, String(count + 1), 60);
  return true;
}

function validatePayload_(raw) {
  if (!raw || raw.length > 5000) return null;
  try {
    var data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : null;
  } catch (err) {
    return null;
  }
}

function sanitize_(value) {
  if (value === null || value === undefined) return '';
  var str = String(value).substring(0, 500).replace(/[<>"'\\]/g, '');
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str; // formula injection
  return str;
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════════════════════════

function setupAllSheets() {
  var results = [];
  for (var i = 0; i < SITES.length; i++) {
    var site = SITES[i];
    if (!site.sheetId) { results.push({ site: site.name, status: 'skipped (no sheetId)' }); continue; }
    try {
      var ss = SpreadsheetApp.openById(site.sheetId);
      var existing = ss.getSheetByName(site.trackingSheet);
      if (existing) {
        results.push({ site: site.name, status: 'ok', rows: existing.getLastRow() - 1 });
      } else {
        setupTrackingHeaders_(ss.insertSheet(site.trackingSheet));
        results.push({ site: site.name, status: 'created' });
      }
    } catch (error) {
      results.push({ site: site.name, status: 'error', message: String(error) });
    }
  }
  results.forEach(function (r) { Logger.log(r.site + ': ' + r.status + (r.rows !== undefined ? ' (' + r.rows + ' rows)' : '') + (r.message ? ' - ' + r.message : '')); });
  return results;
}

function clearProxyCache() {
  var cache = CacheService.getScriptCache();
  var keys = ['proxy_all_n', 'github_all_n'];
  for (var i = 0; i < 50; i++) { keys.push('proxy_all_' + i); keys.push('github_all_' + i); }
  cache.removeAll(keys);
}

// One-off helper: run with the admin password to obtain the hash for Script Properties.
function printPasswordHash() {
  var password = prop_('PASSWORD_PLAIN_TMP');
  if (!password) { Logger.log('Set PASSWORD_PLAIN_TMP temporarily in Script Properties, run again, then delete it.'); return; }
  Logger.log(hashPassword_(password));
}
