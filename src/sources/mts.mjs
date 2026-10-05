import { sourceFetch as fetch } from "../lib/source-fetch.mjs";
// МТС (job.mts.ru): Strapi-бэкенд, открытый JSON API без ключей.
// Категорийные фильтры API игнорирует, зато работает фильтр по названию:
// filters[title][$containsi]. Запросы — в config.json → mts.queries.
const API = "https://job.mts.ru/api/v2/vacancies";
const PAGE = 100;
const MAX_PAGES = 3;
import { withSourceMeta } from "../lib/source-meta.mjs";

export async function fetchMts(cfg) {
  const queries = cfg.mts?.queries || ["machine learning", "AI engineer", "computer vision", "NLP"];
  const seen = new Set();
  const out = [];
  const cappedQueries = [];
  for (const q of queries) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        "filters[title][$containsi]": q,
        "pagination[pageSize]": String(PAGE),
        "pagination[page]": String(page),
        sort: "publishedAt:desc",
      });
      const res = await fetch(`${API}?${params}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" },
      });
      if (!res.ok) throw new Error(`МТС HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.data) || !json.meta?.pagination || typeof json.meta.pagination.total !== "number") {
        throw new Error("МТС: изменилась схема API (ожидались data[] и meta.pagination.total)");
      }
      for (const v of json.data || []) {
        if (seen.has(v.slug)) continue;
        seen.add(v.slug);
        out.push({
          source: "mts",
          id: String(v.slug),
          title: v.title,
          company: "МТС",
          url: `https://job.mts.ru/vacancy/${v.slug}`,
          salary: fmtSalary(v),
          location: fmtLocation(v),
          description: v.description || "",
          requirements: v.requirements || "",
          tasks: v.tasks || "",
          experience: v.experience?.title || v.experience_type_title || "",
          level: v.level || "",
          experienceMin: v.experience?.min != null && Number.isFinite(Number(v.experience.min)) ? Number(v.experience.min) : null,
          experienceMax: v.experience?.max != null && Number.isFinite(Number(v.experience.max)) ? Number(v.experience.max) : null,
          employmentType: (v.workSchedules || []).map((x) => x?.title).filter(Boolean).join(" / "),
          availability: v.isActive === false ? "closed" : "active",
          companyId: v.organization?.id ? String(v.organization.id) : "",
          evidence: { experienceTitle: v.experience?.title || v.experience_type_title || "" },
          published: v.publishedAt || "",
        });
      }
      const total = json.meta?.pagination?.total || 0;
      if (page === MAX_PAGES && page * PAGE < total) cappedQueries.push(q);
      if (page * PAGE >= total) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return withSourceMeta(out, {
    status: cappedQueries.length ? "partial" : "bounded",
    reason: cappedQueries.length ? `достигнут предел ${MAX_PAGES} страниц для запросов: ${cappedQueries.join(", ")}` : "выдача ограничена настроенными title-запросами",
    maxPagesPerQuery: MAX_PAGES,
    cappedQueries,
  });
}

function fmtSalary(v) {
  const cur = (typeof v.currency === "object" ? v.currency?.title || v.currency?.code : v.currency) || "₽";
  const n = (x) => Number(x).toLocaleString("ru-RU");
  if (v.salaryFrom && v.salaryTo) return `${n(v.salaryFrom)}–${n(v.salaryTo)} ${cur}`;
  if (v.salaryFrom) return `от ${n(v.salaryFrom)} ${cur}`;
  if (v.salaryTo) return `до ${n(v.salaryTo)} ${cur}`;
  return "";
}

function fmtLocation(v) {
  const region = typeof v.region === "object" ? v.region?.title : v.region;
  // названия форматов у МТС («В офисе», «Гибрид», «Удаленная работа»)
  // содержат слова, которые понимает фильтр «Формат» — отдаём как есть
  const formats = (v.workFormats || []).map((w) => w?.title).filter(Boolean);
  return [region, formats.join("/")].filter(Boolean).join(" · ");
}

export default { name: "mts", fetch: fetchMts };
