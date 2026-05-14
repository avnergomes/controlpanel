"""Inject i18n attributes + script tags into the datageoparana landing index.html.

Idempotent. Replaces literal Portuguese phrases with the same text plus
`data-i18n="..."` markers so the i18n.js runtime swaps the text on language
change. Also injects:
  - <link rel="stylesheet" href=".i18n/i18n-switcher.css">
  - <script src=".i18n/i18n-dict.js"> + <script src=".i18n/i18n.js">
  - <div data-i18n-switcher class="lang-switcher"></div> mount in the meta-strip
"""
from __future__ import annotations
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
LANDING = HERE.parent / "index.html"

SENTINEL = "<!-- ATLAS-I18N-V1 -->"

HEAD_INJECT = """
    <!-- ATLAS-I18N-V1 -->
    <link rel="stylesheet" href=".i18n/i18n-switcher.css" />
    <script defer src=".i18n/i18n-dict.js"></script>
    <script defer src=".i18n/i18n.js"></script>
"""

# Replacement table: (literal_text, i18n_key).
# Only replaces the FIRST occurrence to avoid touching JSON-LD or repeated text.
REPLACEMENTS = [
    # skip link
    ('>Pular para o conteúdo<', ' data-i18n="nav.skipToContent">Pular para o conteúdo<'),
    # meta-strip
    ('Atlas Datageo · Ed. 2026', '<span data-i18n="masthead.kicker">Atlas Datageo · Ed. 2026</span>'),
    # eyebrow / wordmark
    ('>Datageo · Paraná · Brasil<', ' data-i18n="nav.brand">Datageo · Paraná · Brasil<'),
    # section I running-head
    ('>Placas 01–10<', ' data-i18n="section.platesTitle">Placas 01–10<'),
    # section I title
    ('As dez <b>placas.</b>', '<span data-i18n="section.platesTitle">As dez placas.</span>'),
    # section I deck
    ('Cada placa é um painel interativo independente: tabelas, mapas, gráficos, recortes municipais e exportação. Listadas em ordem de leitura recomendada, do mercado para o tecido social.',
     '<span data-i18n="section.platesDeck">Cada placa é um painel interativo independente: tabelas, mapas, gráficos, recortes municipais e exportação. Listadas em ordem de leitura recomendada, do mercado para o tecido social.</span>'),
    # CTA
    ('>Abrir o índice<', ' data-i18n="masthead.cta">Abrir o índice<'),
    # Plate titles
    ('>VBP Paraná, valor bruto da produção agropecuária.<',
     ' data-i18n="plates.vbp.title">VBP Paraná, valor bruto da produção agropecuária.<'),
    ('Valor Bruto da Produção Agropecuária de 2012 a 2024, com 399 municípios e mais de 200 produtos em 25 cadeias produtivas.',
     '<span data-i18n="plates.vbp.desc">Valor Bruto da Produção Agropecuária de 2012 a 2024, com 399 municípios e mais de 200 produtos em 25 cadeias produtivas.</span>'),
    ('>Preços diários, cotações desde 2003.<',
     ' data-i18n="plates.diarios.title">Preços diários, cotações desde 2003.<'),
    ('Cotações diárias com mais de 100 produtos em 23 regionais. Atualização automática e modelos de previsão de preços.',
     '<span data-i18n="plates.diarios.desc">Cotações diárias com mais de 100 produtos em 23 regionais. Atualização automática e modelos de previsão de preços.</span>'),
    ('>Preços florestais, série desde 1997.<',
     ' data-i18n="plates.florestais.title">Preços florestais, série desde 1997.<'),
    ('Série histórica com mudas, toras, lenha e cavacos em 22 regiões. Inclui previsões com machine learning.',
     '<span data-i18n="plates.florestais.desc">Série histórica com mudas, toras, lenha e cavacos em 22 regiões. Inclui previsões com machine learning.</span>'),
    ('>Preços de terras, série desde 1998.<',
     ' data-i18n="plates.terras.title">Preços de terras, série desde 1998.<'),
    ('Preços de terras agrícolas por classe de solo e regional, com mapa interativo e busca de referências cadastrais.',
     '<span data-i18n="plates.terras.desc">Preços de terras agrícolas por classe de solo e regional, com mapa interativo e busca de referências cadastrais.</span>'),
    ('>ComexStat Paraná, comércio exterior agrícola.<',
     ' data-i18n="plates.comex.title">ComexStat Paraná, comércio exterior agrícola.<'),
    ('Exportações e importações agrícolas desde 2020, com fluxo município-país, balança comercial e 20 cadeias produtivas.',
     '<span data-i18n="plates.comex.desc">Exportações e importações agrícolas desde 2020, com fluxo município-país, balança comercial e 20 cadeias produtivas.</span>'),
    ('>Emprego agro Paraná, vínculos formais desde 2002.<',
     ' data-i18n="plates.emprego.title">Emprego agro Paraná, vínculos formais desde 2002.<'),
    ('Empregos formais no agronegócio paranaense, com vínculos por cadeia produtiva, município, gênero, idade e escolaridade.',
     '<span data-i18n="plates.emprego.desc">Empregos formais no agronegócio paranaense, com vínculos por cadeia produtiva, município, gênero, idade e escolaridade.</span>'),
    ('>Censo Paraná, evolução demográfica municipal.<',
     ' data-i18n="plates.censo.title">Censo Paraná, evolução demográfica municipal.<'),
    ('Evolução demográfica dos 399 municípios paranaenses de 1991 a 2022. Êxodo rural, urbanização e ranking de crescimento e evasão.',
     '<span data-i18n="plates.censo.desc">Evolução demográfica dos 399 municípios paranaenses de 1991 a 2022. Êxodo rural, urbanização e ranking de crescimento e evasão.</span>'),
    ('>Crédito rural, financiamentos BCB / SICOR desde 2013.<',
     ' data-i18n="plates.credito.title">Crédito rural, financiamentos BCB / SICOR desde 2013.<'),
    ('Financiamentos agropecuários com R$ 444 bi em 2,7 milhões de contratos. PRONAF, PRONAMP e demais programas por município e produto.',
     '<span data-i18n="plates.credito.desc">Financiamentos agropecuários com R$ 444 bi em 2,7 milhões de contratos. PRONAF, PRONAMP e demais programas por município e produto.</span>'),
    ('>Saúde Paraná, indicadores DATASUS.<',
     ' data-i18n="plates.saude.title">Saúde Paraná, indicadores DATASUS.<'),
    ('Mortalidade, internações SUS, vacinação, infraestrutura e financiamento por município e região de saúde. Dados de 2010 a 2024.',
     '<span data-i18n="plates.saude.desc">Mortalidade, internações SUS, vacinação, infraestrutura e financiamento por município e região de saúde. Dados de 2010 a 2024.</span>'),
    ('>Segurança Paraná, indicadores SESP-PR.<',
     ' data-i18n="plates.seguranca.title">Segurança Paraná, indicadores SESP-PR.<'),
    ('Ocorrências criminais, violência letal, crimes patrimoniais e taxas por 100 mil habitantes nos 399 municípios paranaenses.',
     '<span data-i18n="plates.seguranca.desc">Ocorrências criminais, violência letal, crimes patrimoniais e taxas por 100 mil habitantes nos 399 municípios paranaenses.</span>'),
]

# Replace every "Abrir placa" occurrence (10 plates) with i18n span.
RX_OPEN_PLATE = re.compile(r'>(Abrir placa) <svg')

# Section II running-head + title + colophon paragraphs.
SECTION_II_REPLACEMENTS = [
    ('>Sobre o projeto<', ' data-i18n="colofao.title">Sobre o projeto<'),
    ('Um atlas público, <b>independente.</b>',
     '<span data-i18n="colofao.title">Um atlas público, independente.</span>'),
]


def patch() -> str:
    src = LANDING.read_text(encoding="utf-8")
    if SENTINEL in src:
        return "landing: already patched"
    orig = src
    notes = []

    # Inject head <link> + <script> right before </head>.
    if "</head>" in src:
        src = src.replace("</head>", HEAD_INJECT + "  </head>", 1)
        notes.append("head-injected")

    # Inject switcher mount in the meta-strip.
    meta_anchor = '<span>X | 10 placas, 8 fontes oficiais</span>'
    if meta_anchor in src:
        src = src.replace(
            meta_anchor,
            meta_anchor + '\n        <span class="meta-strip-switcher" data-i18n-switcher></span>',
            1,
        )
        notes.append("switcher-mounted")

    # Apply literal replacements.
    swapped = 0
    for old, new in REPLACEMENTS + SECTION_II_REPLACEMENTS:
        if old in src:
            src = src.replace(old, new, 1)
            swapped += 1
    notes.append(f"replacements={swapped}")

    # "Abrir placa" — wrap each occurrence with i18n span.
    n_open = 0
    def open_repl(m: re.Match) -> str:
        nonlocal n_open
        n_open += 1
        return '><span data-i18n="plates.open">Abrir placa</span> <svg'
    src = RX_OPEN_PLATE.sub(open_repl, src)
    notes.append(f"open-plate={n_open}")

    if src != orig:
        LANDING.write_text(src, encoding="utf-8")
        return "landing: " + " | ".join(notes)
    return "landing: no-changes"


if __name__ == "__main__":
    print(patch())
