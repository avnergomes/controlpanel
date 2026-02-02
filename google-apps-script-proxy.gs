/**
 * Control Panel Proxy — Agregador server-side para planilhas de tracking.
 *
 * PASSO A PASSO:
 * 1. Crie um novo projeto no Google Apps Script (script.google.com)
 * 2. Cole TODO este codigo
 * 3. Gere um token aleatorio e substitua AUTH_TOKEN abaixo
 * 4. Preencha os sheetId de cada site (copie do config.js antigo)
 * 5. Implante como Web App:
 *    - Executar como: Eu
 *    - Acesso: Qualquer pessoa
 * 6. Copie a URL gerada
 * 7. Atualize proxyUrl e proxyToken no controlpanel/config.js
 * 8. Restrinja cada Google Sheet para "Apenas voce" (nao precisa mais ser publico)
 */

// ── Configuracao (server-side, nunca exposta ao cliente) ──────

const AUTH_TOKEN = 'SEU_TOKEN_ALEATORIO_AQUI';

const SITES = [
  {
    key: 'datageoparana',
    name: 'Datageo Parana',
    sheetId: '1UIhobwGjfmAoPY6COppYsp_sNcfCSjANH6RiPZcJTMY',
    gids: [1349286283],
    kind: 'precos',
  },
  {
    key: 'portfolio',
    name: 'Portfolio',
    sheetId: '17wXvFfRcrl6bbzFMwX7TF7o99t7XBa3khQBC1Hroq5M',
    gids: [1617126613],
    kind: 'portfolio',
  },
  {
    key: 'vbp-parana',
    name: 'VBP Parana',
    sheetId: '1SwbupTGRM0DXleSSg1lO_HllDZbTF6x39ryPJRh5UX4',
    gids: [13565778, 1184050764],
    kind: 'vbp',
  },
  {
    key: 'precos-florestais',
    name: 'Precos Florestais',
    sheetId: '1Pz57YYeQxhSgHc10kzSM71akB2VzlhzK_pXxwVnvcGA',
    gids: [997539922],
    kind: 'precos',
  },
  {
    key: 'precos-terras',
    name: 'Precos de Terras',
    sheetId: '1yejFvAzuRfWQkdP78I-1yWGJ7aygnTEzPpvI4kw20UQ',
    gids: [1804289745],
    kind: 'precos',
  },
  {
    key: 'precos-diarios',
    name: 'Precos Diarios',
    sheetId: '1bwiH0HTIngFw2ZfAXLQI-YlpajJvVTuFsfugHLYOUhE',
    gids: [1237498394],
    kind: 'precos',
  },
];

const CACHE_SECONDS = 180;

// ── Endpoint ──────────────────────────────────────────────────

function doGet(e) {
  var token = (e && e.parameter && e.parameter.token) || '';

  if (token !== AUTH_TOKEN) {
    return jsonResponse_({ error: 'unauthorized' });
  }

  var siteFilter = (e && e.parameter && e.parameter.site) || null;

  // Verificar cache
  var cache = CacheService.getScriptCache();
  var cacheKey = 'proxy_' + (siteFilter || 'all');
  var cached = cache.get(cacheKey);

  if (cached) {
    return jsonResponse_(JSON.parse(cached));
  }

  // Buscar dados frescos
  var sitesToFetch = siteFilter
    ? SITES.filter(function (s) { return s.key === siteFilter; })
    : SITES;

  var result = {
    fetchedAt: new Date().toISOString(),
    sites: {},
  };

  for (var i = 0; i < sitesToFetch.length; i++) {
    var site = sitesToFetch[i];
    try {
      var rows = readSiteRows_(site);
      result.sites[site.key] = {
        name: site.name,
        kind: site.kind,
        rows: rows,
        status: 'ok',
      };
    } catch (err) {
      result.sites[site.key] = {
        name: site.name,
        kind: site.kind,
        rows: [],
        status: 'error',
        error: err.message,
      };
    }
  }

  // Cachear se couber (limite 100KB por chave)
  try {
    var json = JSON.stringify(result);
    if (json.length < 100000) {
      cache.put(cacheKey, json, CACHE_SECONDS);
    }
  } catch (e) {
    // silencioso
  }

  return jsonResponse_(result);
}

// ── Leitura de planilha ───────────────────────────────────────

function readSiteRows_(site) {
  var allRows = [];
  var ss = SpreadsheetApp.openById(site.sheetId);

  for (var g = 0; g < site.gids.length; g++) {
    var sheet = getSheetByGid_(ss, site.gids[g]);
    if (!sheet) continue;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) continue;

    var headers = data[0].map(function (h) {
      return String(h).trim();
    });

    for (var r = 1; r < data.length; r++) {
      var row = {};
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        var val = data[r][c];
        if (val instanceof Date) {
          val = val.toISOString();
        }
        row[headers[c]] = val;
      }
      allRows.push(row);
    }
  }

  return allRows;
}

// ── Encontrar aba por GID ─────────────────────────────────────

function getSheetByGid_(spreadsheet, gid) {
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) {
      return sheets[i];
    }
  }
  return null;
}

// ── Helper de resposta JSON ───────────────────────────────────

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
