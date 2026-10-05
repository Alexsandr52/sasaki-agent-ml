// Т-Банк: внутренний API карьерного сайта (найден через перехват в браузере).
// POST getVacancies; pagination — объект по источникам ("it", "job", ...),
// фильтр профессии — ключ вида tcareer_<category>_profession.
import { sourceFetch as fetch } from "../lib/source-fetch.mjs";
import { withSourceMeta } from "../lib/source-meta.mjs";
const API = "https://www.tbank.ru/pfpjobs/papi/getVacancies";
const PAGE = 50;
const MAX_PAGES = 6;
const WORK_MODES = new Set(["Удаленный", "Офис", "Гибрид"]);
// Грейды приходят тегами ("Middle", "Senior", ...) — заголовки их не содержат;
// прокидываем в item.level, чтобы фильтр мог матчить ключевые слова по грейду.
const GRADE_TAGS = new Set(["junior", "middle", "senior", "lead", "head"]);

export async function fetchTbank(cfg) {
  const category = cfg.tbank?.category || "it";
  const professions = cfg.tbank?.professions || [];
  if (!professions.length) return withSourceMeta([], { status: "not_configured", reason: "Укажите tbank.professions после проверки справочника профессий." });
  const out = [];
  let capped = false;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1",
        "Referer": "https://www.tbank.ru/career/",
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        pagination: { [category]: { offset } },
        limit: PAGE,
        filters: { category, [`tcareer_${category}_profession`]: professions },
      }),
    });
    if (!res.ok) throw new Error(`Т-Банк HTTP ${res.status}`);
    const json = await res.json();
    if (json.resultCode !== "OK") throw new Error(`Т-Банк: ${json.errorMessage || json.resultCode}`);
    if (!Array.isArray(json.payload?.vacancies)) {
      throw new Error("Т-Банк: изменилась схема API (ожидались vacancies[])");
    }
    for (const v of json.payload?.vacancies || []) {
      const modes = (v.tags || []).filter((t) => WORK_MODES.has(t)).join("/");
      const grades = (v.tags || []).filter((t) => GRADE_TAGS.has(t.toLowerCase()));
      out.push({
        source: "tbank",
        id: v.urlSlug || v.seoSlug,
        title: v.title,
        company: "Т-Банк",
        // роут вакансии требует город в пути (см. sitemap); вакансии доступны
        // под любым городом, cities в API пустые — берём Москву как контекст
        url: `https://www.tbank.ru/career/${category}/vacancy/moskva/${v.seoSlug}/${v.urlSlug}/`,
        salary: v.salary || "",
        location: [v.subtitle, modes.toLowerCase(), grades.join("/").toLowerCase()]
          .filter(Boolean).join(" · "),
        level: grades.join("/"),
        description: v.description || v.fullDescription || v.descriptionText || "",
        requirements: v.requirements || v.requirementsText || "",
        tasks: v.tasks || v.responsibilities || "",
        experienceText: v.experience || v.experienceText || "",
        availability: v.isActive === true ? "active" : v.isActive === false ? "inactive" : "unknown",
        canonicalUrl: `https://www.tbank.ru/career/${category}/vacancy/moskva/${v.seoSlug}/${v.urlSlug}/`,
        published: "",
      });
    }
    const next = json.payload?.nextPagination?.[category];
    if (!next || next.isFinished || !json.payload?.vacancies?.length) break;
    if (page === MAX_PAGES - 1) { capped = true; break; }
    offset = next.offset;
    await new Promise((r) => setTimeout(r, 300));
  }
  return withSourceMeta(out, {
    status: capped || !out.length ? "partial" : "bounded",
    reason: capped
      ? `достигнут предел ${MAX_PAGES} страниц Т-Банка`
      : !out.length
        ? `API ответил успешно, но не вернул вакансий для category=${category} и настроенных профессий; фильтр и фактическая пустая выдача не подтверждены`
        : "выдача ограничена настроенными профессиями",
    category, professions, maxPages: MAX_PAGES, capped, resultCount: out.length,
  });
}

export default { name: "tbank", fetch: fetchTbank };
