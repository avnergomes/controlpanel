// Repositórios: every repo of the configured GitHub accounts, cross-referenced with the
// monitored sites, plus suggestions of published Pages sites that have no tracking yet.
import { byId, h, replace, emptyState } from "../ui/dom.js";
import { kpiCard, barList } from "../ui/cards.js";
import { fetchGithubRepos } from "../api.js";
import { setGithub } from "../store.js";
import { SITES, siteByRepo, GITHUB_ACCOUNTS } from "../sites.js";
import { formatNumber, formatRelative, formatDateTime, truncate } from "../format.js";
import { showToast } from "../ui/feedback.js";
import { DAY } from "../analytics.js";

const STALE_DAYS = 90;
let filterText = "";
let loading = false;

export function bindGithub(onChange) {
  const refresh = byId("gh-refresh");
  const filter = byId("gh-filter");
  if (refresh) refresh.addEventListener("click", () => loadGithub({ force: true }).then(onChange));
  if (filter) filter.addEventListener("input", () => { filterText = filter.value.trim().toLowerCase(); onChange(); });
  const copy = byId("gh-copy-snippet");
  if (copy) copy.addEventListener("click", copySnippet);
}

export async function loadGithub({ force = false } = {}) {
  if (loading) return;
  loading = true;
  const btn = byId("gh-refresh");
  if (btn) btn.disabled = true;
  try {
    const payload = await fetchGithubRepos({ force });
    setGithub(payload);
    if (payload.stale && payload.error) showToast(`GitHub: usando cache (${payload.error})`, { tone: "warn" });
  } catch (err) {
    setGithub({ error: err.message, repos: [], accounts: [] });
    showToast(`GitHub: ${err.message}`, { tone: "error" });
  } finally {
    loading = false;
    if (btn) btn.disabled = false;
  }
}

// Repositories that publish a GitHub Pages site but are not monitored by the panel.
export function untrackedPages(repos) {
  return repos
    .filter((repo) => repo.hasPages && !repo.archived && !repo.fork && !siteByRepo(repo.fullName))
    .map((repo) => ({ ...repo, pagesUrl: pagesUrl(repo) }))
    .sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt));
}

export function pagesUrl(repo) {
  if (repo.homepage) return repo.homepage;
  const owner = repo.owner.toLowerCase();
  if (repo.name.toLowerCase() === `${owner}.github.io`) return `https://${owner}.github.io/`;
  return `https://${owner}.github.io/${repo.name}/`;
}

export function summarize(repos, now = new Date()) {
  const staleCutoff = now.getTime() - STALE_DAYS * DAY;
  const monitored = repos.filter((repo) => siteByRepo(repo.fullName));
  return {
    total: repos.length,
    withPages: repos.filter((r) => r.hasPages && !r.archived).length,
    monitored: monitored.length,
    untracked: untrackedPages(repos).length,
    stale: repos.filter((r) => !r.archived && r.pushedAt && new Date(r.pushedAt).getTime() < staleCutoff).length,
    openIssues: repos.reduce((sum, r) => sum + (r.openIssues || 0), 0),
    stars: repos.reduce((sum, r) => sum + (r.stars || 0), 0),
    pushedLast7d: repos.filter((r) => r.pushedAt && now.getTime() - new Date(r.pushedAt).getTime() < 7 * DAY).length,
  };
}

export function renderGithub({ store, now }) {
  const github = store.github;
  const notice = byId("gh-notice");
  if (!github) {
    replace(byId("gh-kpis"), emptyState("Consultando a API pública do GitHub…"));
    if (!loading) loadGithub().then(() => renderGithub({ store, now }));
    return;
  }
  const repos = github.repos || [];
  if (notice) {
    const parts = [];
    if (github.error && !repos.length) parts.push(github.error);
    else {
      parts.push(github.fromCache ? `cache local de ${formatDateTime(github.fetchedAt)}` : `consultado em ${formatDateTime(github.fetchedAt)}`);
      if (github.remaining !== null && github.remaining !== undefined) parts.push(`${github.remaining} chamadas restantes na hora`);
      parts.push(`contas: ${GITHUB_ACCOUNTS.join(", ")}`);
    }
    notice.textContent = parts.join(" · ");
  }
  if (!repos.length) {
    replace(byId("gh-kpis"), emptyState(github.error || "Nenhum repositório encontrado."));
    replace(byId("gh-suggestions"));
    replace(byId("gh-repos"));
    return;
  }
  const summary = summarize(repos, now);
  replace(byId("gh-kpis"),
    kpiCard({ label: "Repositórios", value: formatNumber(summary.total), sub: `${GITHUB_ACCOUNTS.length} contas` }),
    kpiCard({ label: "Com GitHub Pages", value: formatNumber(summary.withPages), sub: `${summary.monitored} monitorados no painel` }),
    kpiCard({ label: "Pages sem tracking", value: formatNumber(summary.untracked), sub: "candidatos abaixo", tone: summary.untracked ? "warn" : "ok" }),
    kpiCard({ label: "Push nos últimos 7 d", value: formatNumber(summary.pushedLast7d), sub: `${summary.stale} sem push há +${STALE_DAYS} d` }),
    kpiCard({ label: "Issues + PRs abertos", value: formatNumber(summary.openIssues), sub: "inclui PRs do Dependabot" }),
    kpiCard({ label: "Estrelas", value: formatNumber(summary.stars) }),
  );

  renderSuggestions(repos, now);
  renderLanguages(repos);
  renderTable(repos, now);
}

function renderSuggestions(repos, now) {
  const target = byId("gh-suggestions");
  if (!target) return;
  const candidates = untrackedPages(repos);
  if (!candidates.length) {
    replace(target, h("p", { class: "ok-line", text: "Todos os sites publicados com GitHub Pages já estão monitorados." }));
    return;
  }
  const list = h("ul", { class: "suggestion-list", attrs: { role: "list" } });
  for (const repo of candidates) {
    list.appendChild(h("li", { class: "suggestion" },
      h("div", { class: "suggestion-head" },
        h("a", { class: "suggestion-name mono", text: repo.fullName, attrs: { href: repo.htmlUrl, target: "_blank", rel: "noopener" } }),
        h("a", { class: "suggestion-url", text: repo.pagesUrl.replace(/^https?:\/\//, ""), attrs: { href: repo.pagesUrl, target: "_blank", rel: "noopener" } }),
      ),
      h("div", { class: "suggestion-meta mono" },
        h("span", { text: repo.language || "—" }),
        h("span", { text: `push ${formatRelative(repo.pushedAt, now)} atrás` }),
        h("span", { text: `${repo.openIssues} issues/PRs` }),
        repo.description ? h("span", { class: "suggestion-desc", text: truncate(repo.description, 90), attrs: { title: repo.description } }) : null,
      ),
    ));
  }
  replace(target, list);
}

function renderLanguages(repos) {
  const target = byId("gh-languages");
  if (!target) return;
  const counts = new Map();
  for (const repo of repos) counts.set(repo.language || "—", (counts.get(repo.language || "—") || 0) + 1);
  const items = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ key: label, label, value }));
  replace(target, barList(items, { total: repos.length, ariaLabel: "Linguagens principais" }));
}

function renderTable(repos, now) {
  const target = byId("gh-repos");
  if (!target) return;
  const filtered = repos
    .filter((repo) => !filterText || repo.fullName.toLowerCase().includes(filterText) || (repo.description || "").toLowerCase().includes(filterText) || (repo.language || "").toLowerCase().includes(filterText))
    .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0));
  const count = byId("gh-count");
  if (count) count.textContent = `${filtered.length} de ${repos.length}`;
  if (!filtered.length) {
    replace(target, emptyState("Nenhum repositório corresponde ao filtro.", { small: true }));
    return;
  }
  const rows = filtered.map((repo) => {
    const site = siteByRepo(repo.fullName);
    const staleDays = repo.pushedAt ? (now.getTime() - new Date(repo.pushedAt).getTime()) / DAY : Infinity;
    return h("tr", { class: repo.archived ? "is-archived" : "" },
      h("td", {},
        h("a", { class: "mono", text: repo.fullName, attrs: { href: repo.htmlUrl, target: "_blank", rel: "noopener", title: repo.description || "" } }),
        repo.archived ? h("span", { class: "tag", text: "arquivado" }) : null,
        repo.fork ? h("span", { class: "tag", text: "fork" }) : null,
      ),
      h("td", {}, repo.hasPages ? h("a", { text: "Pages", attrs: { href: pagesUrl(repo), target: "_blank", rel: "noopener" } }) : "—"),
      h("td", {}, site ? h("a", { class: "tag tag--ok", text: site.short, attrs: { href: `#/${site.key}` } }) : (repo.hasPages && !repo.archived ? h("span", { class: "tag tag--warn", text: "sem tracking" }) : "—")),
      h("td", { class: "mono", text: repo.pushedAt ? formatRelative(repo.pushedAt, now) : "—", attrs: { title: repo.pushedAt ? formatDateTime(repo.pushedAt) : "" }, style: staleDays > STALE_DAYS ? { color: "var(--text-dim)" } : undefined }),
      h("td", { class: "mono num", text: formatNumber(repo.openIssues) }),
      h("td", { class: "mono num", text: formatNumber(repo.stars) }),
      h("td", { text: repo.language || "—" }),
    );
  });
  const table = h("table", { class: "data-table" },
    h("thead", {}, h("tr", {},
      h("th", { text: "Repositório", attrs: { scope: "col" } }),
      h("th", { text: "Site", attrs: { scope: "col" } }),
      h("th", { text: "No painel", attrs: { scope: "col" } }),
      h("th", { text: "Último push", attrs: { scope: "col" } }),
      h("th", { text: "Issues/PRs", attrs: { scope: "col" } }),
      h("th", { text: "Estrelas", attrs: { scope: "col" } }),
      h("th", { text: "Linguagem", attrs: { scope: "col" } }),
    )),
    h("tbody", {}, rows),
  );
  replace(target, table);
}

async function copySnippet() {
  const el = byId("gh-snippet");
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
    showToast("Snippet copiado. Cole antes de </body> e adicione o site em src/sites.js e no SITES do Apps Script.", { tone: "ok" });
  } catch {
    showToast("Não foi possível copiar automaticamente; selecione o texto manualmente.", { tone: "warn" });
  }
}

export const _internal = { SITES };
