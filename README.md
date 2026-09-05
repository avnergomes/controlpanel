# Observatory · Control Panel

Painel estático (GitHub Pages) que monitora os pageviews anônimos dos sites do ecossistema
Datageo Paraná, do portfólio e de sites de clientes. Sem cookies, sem IP, sem identificação
de visitante: só os 18 campos do snippet LGPD (`tracking-snippet-lgpd.html`).

**Produção:** https://avnergomes.github.io/controlpanel/

## Como funciona

```
sites (snippet LGPD) ──POST──▶ Google Apps Script (server/proxy.gs) ──▶ Google Sheets (uma por site)
painel (este repo)   ──POST──▶ mesmo Apps Script: login → token de sessão → getData
painel               ──GET───▶ api.github.com (público, cache local 30 min) para a view Repositórios
```

- `index.html` + `styles.css`: shell com sidebar (Visão geral, Repositórios, sites por grupo).
- `src/`: módulos ES sem bundler. `analytics.js` e `normalize.js` são puros e cobertos por testes.
- `vendor/chart.umd.min.js`: Chart.js self-hosted (só séries temporais; distribuições são barras HTML).
- `assets/world-paths.json`: mapa-múndi pré-projetado (gerado por `scripts/build_world_paths.py`).
- `server/proxy.gs`: backend v3 (compatível com o cliente; ver "Backend").
- `docs/PLANO-REFATORACAO.md`: diagnóstico e decisões da versão 3.

## Rodar localmente

```bash
npm install
node scripts/make-fixture.mjs      # gera tests/fixtures (dados sintéticos)
npm run dev                        # http://127.0.0.1:4173/
```

- `http://127.0.0.1:4173/?mock=1` abre o painel com as fixtures, sem login (só em localhost).
- Sem `?mock=1`, o painel usa a URL do Apps Script em `config.local.js` e pede a senha.

## Testes

```bash
npm test          # vitest: normalização, analytics, roteador, cache, export, GitHub
npm run test:e2e  # Playwright: login, overview, site, repositórios, export, mock (proxy e GitHub mockados, CSP ativa)
npm run check     # os dois
```

O workflow `.github/workflows/deploy.yml` roda os testes antes de publicar e sobe apenas `dist/`
(montado por `scripts/build.mjs`, com versionamento dos assets).

## Adicionar um site ao monitoramento

1. Cole o snippet de `tracking-snippet-lgpd.html` antes de `</body>` no site (a view
   Repositórios lista os sites publicados com GitHub Pages que ainda não têm tracking).
2. Crie uma planilha Google e copie o id.
3. Em `server/proxy.gs`, adicione a entrada em `SITES` (key, urlKey, name, sheetId, kind) e a
   origem em `ALLOWED_ORIGINS`; publique nova versão da implantação e rode `setupAllSheets()`.
4. Em `src/sites.js`, adicione o site (key, name, short, code, kind, color, url, repo, group).
5. `npm run check` e push.

## Backend (Google Apps Script)

O arquivo versionado é `server/proxy.gs` (v3, em produção desde 2026-09-05). Ele mantém o
contrato do v2, então o cliente funciona com qualquer um dos dois. Ganhos do v3: cache em blocos
(o v2 nunca cacheava), formato colunar, busca incremental (`since`), sessão deslizante, criação
automática de planilha para sites novos e o auth gate de cadastro do datageoparana.github.io.
Segredos ficam fora do git: `server/secrets.gs` (ignorado) ou *Script Properties*
(`PASSWORD_HASH`, `PASSWORD_SALT` opcional).

Publicação com clasp (`npm run gas:push` e `npm run gas:deploy`): ver `MIGRATION_NOTES.md`.

## Segurança e LGPD

- CSP estrita (sem scripts inline), token de sessão só no corpo do POST e em `sessionStorage`.
- Dados anônimos; colunas potencialmente identificadoras de planilhas antigas (user agent,
  session id, resolução) são descartadas no servidor (v3) e nunca vão para o cache local.
- Exportação CSV neutraliza fórmulas e usa `;` + BOM (Excel pt-BR).
- `config.local.js` guarda apenas a URL pública do Apps Script (a mesma que está em todos os
  snippets); em produção ela é regenerada a partir do secret `TRACKING_URL`.
