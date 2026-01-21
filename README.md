# Control Panel

Dashboard estatico para monitorar trafego/visitas a paginas a partir de Google Sheets publicos. O projeto usa apenas HTML/CSS/JS e funciona em GitHub Pages.

## Rodar localmente

Use um servidor simples para evitar bloqueios do navegador:

```bash
python -m http.server
```

Depois abra `http://localhost:8000`.

## Publicar no GitHub Pages

1. Faça push do repositorio.
2. Em GitHub, abra **Settings** -> **Pages**.
3. Em **Branch**, selecione `main` e `/root`.
4. Salve e aguarde o link do Pages.

## Configurar o gid antigo do VBP

O VBP possui duas abas de visitas (antiga e recente). Para fazer merge e deduplicacao:

1. Abra a aba antiga no Google Sheets.
2. Copie o parametro `gid=XXXX` da URL.
3. Edite `config.js` e preencha `VBP_OLD_GID` com o valor.

## Permissoes

Os Sheets precisam estar como **anyone with link** para o endpoint GViz funcionar sem backend.

## Notas

- Atualizacao automatica a cada 60s.
- Cache local por 10 minutos (ajuste em `config.js`).

