# Plano de refatoração do Observatory (Control Panel) · set/2026

Objetivo: melhorar UX/UI, velocidade de carregamento e relevância dos indicadores, sem
quebrar o contrato com o backend atual (Google Apps Script v2) e com testes automatizados
antes de cada deploy.

## Diagnóstico (estado anterior)

| Área | Problema verificado | Efeito |
|------|---------------------|--------|
| Carregamento | `initApp` aguardava 355 KB de GeoJSON antes de renderizar qualquer coisa | primeira pintura atrasada mesmo com cache |
| Carregamento | Chart.js via CDN externo + 15 pesos de 3 famílias Google Fonts | conexões extras e fontes não usadas |
| Carregamento | Mapa SVG (centenas de paths) reconstruído e reprojetado a cada render | jank ao trocar de aba e a cada poll |
| Carregamento | Poll de 60 s trazendo o histórico completo de 16 planilhas; cache do servidor só < 100 KB (nunca) | cada poll = 16 leituras de Sheets no servidor |
| Carregamento | Deploy publicava 12 MB de shapefiles não usados | artefato inchado |
| Bugs | `onclick` inline e `<script>` inline bloqueados pela CSP | botão EXFIL e relógio UTC não funcionavam em produção |
| Bugs | Loading usa `body.is-loading`, CSS só conhece `.loading-overlay.show` | spinner nunca aparecia |
| Bugs | Botão de login sobrescrito com texto (perde SVG e i18n) | UI quebra após o primeiro login |
| Bugs | i18n em PT executa `querySelectorAll('*')` a cada mutação do DOM | custo constante de CPU |
| Bugs | Site D3D existe no cliente mas não no `SITES` do proxy | aba sempre vazia |
| Indicadores | Cards mostravam total histórico; sem hoje/7d/30d comparados, sem p95, sem saúde do tracking | pouco acionável |
| Dataviz | Doughnuts, cores fixas laranja, 8 gráficos pequenos por site | viola as regras do projeto (sem pizza, uma cor de destaque) |
| Navegação | 17 abas horizontais com scroll | difícil achar um site e ver o estado geral |
| Código | ~40% de funções mortas (page list, insights, sidebar stats, skeletons) | manutenção difícil |

## Arquitetura nova

```
index.html            shell (header + sidebar + 3 views) · CSP sem inline
styles.css            mesma identidade Observatory, menos custo (sem backdrop-filter em camadas fixas)
src/
  main.js             boot, sessão, polling consciente de visibilidade
  config.js           CONFIG (proxy, intervalos, fuso de referência)
  sites.js            registro único de sites (chave, nome, cor, url, repo, grupo)
  schemas.js          FIELD_SCHEMAS deduplicados por tipo de planilha
  normalize.js        linhas brutas → registros (puro, testado)
  analytics.js        janelas, variações, percentis, séries, heatmap, saúde (puro, testado)
  api.js              login, getData (v2 objetos / v3 colunar+delta), GitHub API
  cache.js            localStorage (dados, geo, GitHub)
  router.js           #/overview · #/github · #/<site>
  ui/                 dom, cards, barlist, charts (Chart.js self-hosted), heatmap, worldmap, nav, toast
  views/              overview · site · github
vendor/chart.umd.min.js
assets/world-paths.json   mapa pré-projetado e simplificado (68 KB, antes 355 KB)
server/proxy.gs       Apps Script v3 (compatível com v2; cache em blocos, formato colunar, since, relay GitHub)
scripts/              build.mjs (dist/ enxuto), serve.mjs, build_world_paths.py, make-fixture.mjs
tests/unit            vitest sobre os módulos puros
tests/e2e             Playwright com proxy e GitHub API mockados
```

## Indicadores (o que cada view responde)

- **Visão geral** · "O ecossistema está saudável e para onde vai a atenção?"
  hoje vs ontem, 7 d vs 7 d anteriores, 30 d, sites ativos em 24 h, alertas de tracking;
  série 30 d empilhada por site; ranking 7 d com tendência e último acesso;
  top páginas, origens (busca / social / direto / interno), Brasil × exterior;
  heatmap hora × dia (fuso America/Sao_Paulo); tempo de carga p50/p95 por site.
- **Site** · KPIs hoje/7d/30d/total/p95, série com granularidade e período, top páginas,
  origens e campanhas UTM, dispositivo/idioma/conexão/tema como barras, heatmap, mapa de fusos,
  últimos acessos.
- **Repositórios** · repos das contas (avnergomes, datageoparana, cwbtopo, dayanebuenogomes,
  d3dinovacao): último push, issues/PRs abertos, Pages ativo, se está monitorado no painel;
  lista de sites publicados sem tracking (sugestões) com o snippet pronto para copiar.

## Compatibilidade

- Backend v2 continua funcionando (formato antigo). O cliente detecta `format: "columnar"`,
  `delta: true` e o relay GitHub quando o v3 estiver publicado.
- Rotas `#/<site>` mantidas. Cache local com chave nova (`v7`).

## Verificação

1. `npm test` (vitest): normalização, analytics, roteador, saúde.
2. `npm run test:e2e` (Playwright, CSP ativa): login, overview, navegação, site, GitHub, export.
3. CI: job de testes antes do deploy; artefato = `dist/` (sem shapefiles, node_modules, testes).
4. Checagem manual no navegador com `?mock=1` em localhost.
