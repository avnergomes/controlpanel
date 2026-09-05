# Notas de migração

## v3 (2026-09-05): cliente refatorado + backend `server/proxy.gs` publicado via clasp

Publicado em 2026-09-05 na implantação oficial (`AKfycbwdSLK3…`, versão 44; versão 45 adiciona
Serra do Mar WebGIS e Água Segura, com planilhas criadas automaticamente no primeiro acesso). O código anterior
em produção era a versão 42 ("rate limit + sanitize numerico"); o v3 incorpora tudo o que ela
tinha (D3D com planilha própria, origem d3dinovacao, rate limit por origem e minuto, sanitize
numérico e o **auth gate de cadastro do datageoparana.github.io**, mantido literalmente).

Como o backend é versionado e publicado agora:

```bash
npm run gas:push      # clasp push -f (server/proxy.gs + server/secrets.gs + appsscript.json)
npm run gas:deploy    # nova versão na implantação oficial (URL não muda)
npm run gas:health    # {"status":"ok","version":"3.0",...}
```

- `.clasp.json` aponta para o projeto "Proxy sheets" (scriptId `11FXVnYGUe…`), `rootDir: server`.
- `server/secrets.gs` (ignorado pelo git) contém `SECRETS.PASSWORD_HASH`; *Script Properties*
  (`PASSWORD_HASH`, `PASSWORD_SALT`) têm precedência quando definidas.
- Rollback: `clasp deploy -i AKfycbwdSLK3K9_D39sc0UfzYZIM1QEMLxMUudSneAELoqcJjM5ExTSq7ZmMilNzYDx5QK5iMA -V 42`.
- Backup do código v42 puxado antes da troca: pasta `gas-backup` do scratchpad da sessão
  (e o arquivo local antigo `google-apps-script-proxy.gs`, ignorado pelo git).
- Escopos OAuth inalterados (Planilhas, Mail); nenhum novo consentimento foi necessário.

## Histórico

- 2026-03-01: token de sessão migrado do query string para o corpo do POST (cliente).
- 2026-09-05: caminho legado por query string e `LEGACY_TOKEN` removidos no v3; login por GET removido;
  sessão deslizante (renova a cada requisição, máximo 12 h); cache em blocos; formato colunar; `since`.
