// Single registry of monitored sites. Everything else (navigation, colors, GitHub
// cross-reference, schemas) derives from this list. Order = display order inside groups.
//
// color: Okabe-Ito based, colorblind-safe, used only where sites are compared.
// kind:  which FIELD_SCHEMAS entry normalizes this site's spreadsheet rows.
// repo:  owner/name on GitHub (for the Repositórios view cross-reference).

export const GROUPS = Object.freeze([
  { key: "datageo", label: "Datageo Paraná" },
  { key: "pessoal", label: "Pessoal" },
  { key: "clientes", label: "Clientes" },
]);

export const SITES = Object.freeze([
  { key: "datageoparana", name: "Datageo Paraná", short: "Datageo", code: "01", kind: "datageo", color: "#00f5d4", url: "https://datageoparana.github.io/", repo: "datageoparana/datageoparana.github.io", group: "datageo" },
  { key: "vbp-parana", name: "VBP Paraná", short: "VBP", code: "03", kind: "vbp", color: "#0072B2", url: "https://avnergomes.github.io/vbp-parana/", repo: "avnergomes/vbp-parana", group: "datageo" },
  { key: "precos-florestais", name: "Preços Florestais", short: "Florestais", code: "04", kind: "precos", color: "#009E73", url: "https://avnergomes.github.io/precos-florestais/", repo: "avnergomes/precos-florestais", group: "datageo" },
  { key: "precos-terras", name: "Preços de Terras", short: "Terras", code: "05", kind: "precos", color: "#CC79A7", url: "https://avnergomes.github.io/precos-de-terras/", repo: "avnergomes/precos-de-terras", group: "datageo" },
  { key: "precos-diarios", name: "Preços Diários", short: "Diários", code: "06", kind: "precos", color: "#D55E00", url: "https://avnergomes.github.io/precos-diarios/", repo: "avnergomes/precos-diarios", group: "datageo" },
  { key: "comexstat-parana", name: "ComexStat Paraná", short: "ComexStat", code: "07", kind: "comex", color: "#56B4E9", url: "https://avnergomes.github.io/comexstat-parana/", repo: "avnergomes/comexstat-parana", group: "datageo" },
  { key: "emprego-agro-parana", name: "Emprego Agro Paraná", short: "Emprego", code: "08", kind: "emprego", color: "#ff3864", url: "https://avnergomes.github.io/emprego-agro-parana/", repo: "avnergomes/emprego-agro-parana", group: "datageo" },
  { key: "censo-parana", name: "Censo Paraná", short: "Censo", code: "09", kind: "lgpd", color: "#E69F00", url: "https://datageoparana.github.io/censo-parana/", repo: "avnergomes/censo-parana", group: "datageo" },
  { key: "credito-rural-parana", name: "Crédito Rural Paraná", short: "Crédito", code: "10", kind: "lgpd", color: "#3a86ff", url: "https://avnergomes.github.io/credito-rural-parana/", repo: "avnergomes/credito-rural-parana", group: "datageo" },
  { key: "saude-parana", name: "Saúde Paraná", short: "Saúde", code: "11", kind: "lgpd", color: "#f0e442", url: "https://avnergomes.github.io/saude-parana/", repo: "avnergomes/saude-parana", group: "datageo" },
  { key: "seguranca-parana", name: "Segurança Paraná", short: "Segurança", code: "12", kind: "lgpd", color: "#8b93a8", url: "https://avnergomes.github.io/seguranca-parana/", repo: "avnergomes/seguranca-parana", group: "datageo" },
  { key: "c2-parana", name: "C2 Paraná", short: "C2", code: "13", kind: "lgpd", color: "#ff8500", url: "https://avnergomes.github.io/c2-parana/", repo: "avnergomes/c2-parana", group: "datageo" },
  { key: "portfolio", name: "Portfólio", short: "Portfólio", code: "02", kind: "portfolio", color: "#ffb800", url: "https://avnergomes.github.io/portfolio/", repo: "avnergomes/portfolio", group: "pessoal" },
  { key: "cwbtopo", name: "CWB Topografia", short: "CWBTopo", code: "14", kind: "lgpd", color: "#b6a682", url: "https://cwbtopo.github.io/", repo: "cwbtopo/cwbtopo.github.io", group: "clientes" },
  { key: "dayane-psicologia", name: "Dayane Psicologia", short: "Dayane", code: "15", kind: "lgpd", color: "#84a98c", url: "https://dayanebuenogomes.github.io/", repo: "dayanebuenogomes/dayanebuenogomes.github.io", group: "clientes" },
  { key: "d3d", name: "D3D Inovação", short: "D3D", code: "16", kind: "lgpd", color: "#fb7185", url: "https://d3dinovacao.github.io/", repo: "d3dinovacao/d3dinovacao.github.io", group: "clientes" },
]);

// GitHub accounts scanned by the Repositórios view (public API, no token needed).
export const GITHUB_ACCOUNTS = Object.freeze([
  "avnergomes",
  "datageoparana",
  "cwbtopo",
  "dayanebuenogomes",
  "d3dinovacao",
]);

const BY_KEY = new Map(SITES.map((site) => [site.key, site]));
const BY_REPO = new Map(SITES.map((site) => [site.repo.toLowerCase(), site]));

export function siteOf(key) {
  return BY_KEY.get(key) || null;
}

export function siteByRepo(fullName) {
  return BY_REPO.get(String(fullName || "").toLowerCase()) || null;
}

export function sitesInGroup(groupKey) {
  return SITES.filter((site) => site.group === groupKey);
}

// Hostnames owned by the ecosystem: referrers from these count as "internal" traffic.
export const OWN_HOSTS = Object.freeze(
  Array.from(new Set(SITES.map((site) => new URL(site.url).hostname))),
);
