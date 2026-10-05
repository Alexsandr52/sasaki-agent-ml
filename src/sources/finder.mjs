import { sourceFetch as fetch } from "../lib/source-fetch.mjs";
// Finder (finder.work, бывш. finder.vc): агрегатор, открытый JSON API.
// Параметра категории у API нет — используем полнотекстовый search
// (запросы — в config.json → finder.queries); выдача по релевантности,
// свежие титульные совпадения наверху. Центральный фильтр дорежет по title.
//
const API = "https://api.finder.work/api/v1/vacancies/";
const PAGE = 100;
const MAX_PAGES = 2;
import { withSourceMeta } from "../lib/source-meta.mjs";

export async function fetchFinder(cfg) {
  const queries = cfg.finder?.queries || ["machine learning engineer", "computer vision engineer", "NLP engineer"];
  const seen = new Set();
  const out = [];
  const cappedQueries = [];
  for (const q of queries) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        search: q,
        limit: String(PAGE),
        offset: String(page * PAGE),
      });
      const res = await fetch(`${API}?${params}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" },
      });
      if (!res.ok) throw new Error(`Finder HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.items)) throw new Error("Finder: изменилась схема API (ожидалось items[])");
      const items = json.items;
      for (const v of items) {
        if (seen.has(v.id) || v.archived_at) continue;
        seen.add(v.id);
        out.push({
          source: "finder",
          id: String(v.id),
          title: v.title,
          company: v.company?.title || "",
          url: `https://finder.work/vacancies/${v.id}`,
          applyUrl: v.external_url?.value || "",   // оригинал (часто hh) — для межисточникового дедупа
          salary: fmtSalary(v),
          location: fmtLocation(v),
          // API reports no_experience / year_minimum / three_years_more / etc.
          experience: v.experience || "",
          published: v.publication_at || "",
        });
      }
      if (items.length < PAGE) break;
      if (page === MAX_PAGES - 1) cappedQueries.push(q);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return withSourceMeta(out, {
    status: cappedQueries.length ? "partial" : "bounded",
    reason: cappedQueries.length
      ? `достигнут предел ${MAX_PAGES} страниц по запросам: ${cappedQueries.join(", ")}`
      : `выдача проверена максимум на ${MAX_PAGES} страниц по каждому запросу`,
    maxPagesPerQuery: MAX_PAGES,
    cappedQueries,
  });
}

function fmtSalary(v) {
  const cur = v.currency_symbol === "RUR" ? "₽" : v.currency_symbol || "₽";
  const n = (x) => Number(x).toLocaleString("ru-RU");
  if (v.salary_from && v.salary_to) return `${n(v.salary_from)}–${n(v.salary_to)} ${cur}`;
  if (v.salary_from) return `от ${n(v.salary_from)} ${cur}`;
  if (v.salary_to) return `до ${n(v.salary_to)} ${cur}`;
  return "";
}

function fmtLocation(v) {
  const cities = (v.locations || []).map((l) => l?.name).filter(Boolean).slice(0, 2);
  if (v.distant_work) cities.push("удалённо");
  return cities.join(" · ");
}

export default { name: "finder", fetch: fetchFinder };
