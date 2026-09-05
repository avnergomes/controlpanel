# Notas de migração

## v3 (set/2026): cliente refatorado + backend `server/proxy.gs`

O cliente v3 já está em produção e fala com o backend v2 atual. Para ativar os ganhos do
servidor (cache real, delta, formato colunar, sessão deslizante, D3D, relay GitHub):

1. Abra o projeto no Apps Script e substitua o código por `server/proxy.gs`.
2. *Project Settings → Script Properties*:
   - `PASSWORD_HASH`: o mesmo hash SHA-256 que estava na constante do arquivo antigo.
   - `PASSWORD_SALT` (opcional): se definir, recompute o hash como sha256(salt + senha).
   - `GITHUB_TOKEN` (opcional): PAT somente leitura para o relay `action: "github"`.
3. Crie a planilha do D3D e preencha `sheetId` na entrada `d3d` de `SITES`.
4. *Deploy → Manage deployments → Edit → New version → Deploy* (mantém a URL).
5. Execute `setupAllSheets()` uma vez.
6. Verifique `GET <url>?action=health` → `{"status":"ok","version":"3.0",...}`.

O cliente detecta a versão pela resposta (`version`, `format`, `delta`); nada precisa mudar
no repositório.

## Histórico

- 2026-03-01: token de sessão migrado do query string para o corpo do POST (cliente).
- 2026-09-05: caminho legado por query string e `LEGACY_TOKEN` removidos no v3; login por GET removido.
