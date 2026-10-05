// Яндекс Работа: открытый JSON API каталога вакансий, пагинация курсором.
// Даты публикации в списке нет — она лежит в детальной карточке
// /api/publications/<id> (published_at); добываем её только для новых id
// через кэш data/pub-dates.json (см. lib/pubdates.mjs).
import { withPubDates } from "../lib/pubdates.mjs";

const API = "https://yandex.ru/jobs/api/publications";
const MAX_PAGES = 20;
const PAGE_SIZE = 20;
const MAX_DETAIL_ITEMS = 100;
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" };
import { withSourceMeta } from "../lib/source-meta.mjs";

export async function fetchYandex(cfg, { dryRun = false } = {}) {
  const professions = cfg.yandex?.professions || [];
  if (!professions.length) return [];
  const base = [
    `page_size=${PAGE_SIZE}`,
    ...professions.map((p) => `professions=${encodeURIComponent(p)}`),
  ].join("&");
  const out = [];
  const seen = new Set();
  const detailFailures = [];
  let capped = false;
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${API}?${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Яндекс HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.results)) throw new Error("Яндекс: изменилась схема каталога (ожидалось results[])");
    for (const r of json.results) {
      if (r.id == null || seen.has(String(r.id))) continue;
      seen.add(String(r.id));
      out.push({
        source: "yandex",
        id: String(r.id),
        title: r.title,
        company: ["Яндекс", r.public_service?.name].filter(Boolean).join(" · "),
        targetEmployer: "Яндекс",
        url: `https://yandex.ru/jobs/vacancies/${r.publication_slug_url}`,
        salary: "",
        location: [
          (r.vacancy?.cities || []).map((c) => c.name).join(", "),
          (r.vacancy?.work_modes || []).map((m) => m.name.toLowerCase()).join("/"),
        ].filter(Boolean).join(" · "),
        description: r.short_summary || "",
        requirements: "",
        level: normalizeLevel(r.vacancy?.pro_level_min_display),
        levelMax: normalizeLevel(r.vacancy?.pro_level_max_display),
        availability: r.status === "published" ? "active" : r.status === "closed" ? "closed" : "unknown",
        published: "",
      });
    }
    // next приходит с внутренним хостом — берём из него только cursor
    if (!json.next) break;
    if (page === MAX_PAGES - 1) capped = true;
    cursor = new URL(json.next).searchParams.get("cursor");
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const detailsById = new Map();
  const detailItems = [...out].sort((a, b) => detailPriority(a) - detailPriority(b)).slice(0, MAX_DETAIL_ITEMS);
  const hydrated = [];
  for (const item of detailItems) {
    try {
      const res = await fetch(`${API}/${item.id}`, { headers: UA, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const detail = await res.json();
      detailsById.set(item.id, detail);
      item.description = joinText(detail.description, item.description);
      item.requirements = joinText(detail.key_qualifications, detail.additional_requirements);
      item.level = normalizeLevel(detail.vacancy?.pro_level_min_display) || item.level;
      item.levelMax = normalizeLevel(detail.vacancy?.pro_level_max_display) || item.levelMax;
      item.availability = detail.status === "published" ? "active" : detail.status === "closed" ? "closed" : item.availability;
      hydrated.push(item);
    } catch (error) {
      detailFailures.push({ id: item.id, reason: error.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  // Reuse the same bounded detail requests for publication dates. Records whose
  // detail request failed or fell beyond the cap remain in the listing with an
  // empty date; never make extra requests just to fill the date cache.
  const datedDetails = await withPubDates("yandex", hydrated, async (item) => {
    const cachedDetail = detailsById.get(item.id);
    if (cachedDetail) return cachedDetail.published_at || "";
  }, { persist: !dryRun });
  const datesById = new Map(datedDetails.map((item) => [item.id, item.published]));
  for (const item of out) item.published = datesById.get(item.id) || "";
  const detailsCapped = out.length > MAX_DETAIL_ITEMS;
  return withSourceMeta(out, {
    status: capped || detailsCapped || detailFailures.length ? "partial" : "bounded",
    reason: [
      capped ? `достигнут предел ${MAX_PAGES} страниц; cursor продолжал выдачу` : null,
      detailsCapped ? `детали запрашивались максимум для ${MAX_DETAIL_ITEMS} из ${out.length} вакансий; приоритет ML/DS, затем стажёр/junior и свежие карточки` : null,
      detailFailures.length ? `не удалось загрузить детали ${detailFailures.length} вакансий` : null,
      !capped ? "API листается курсором до отсутствия следующей страницы; профессии ограничены конфигурацией" : null,
    ].filter(Boolean).join("; "),
    maxPages: MAX_PAGES,
    pageSize: PAGE_SIZE,
    detailsHydrated: hydrated.length,
    detailsFailed: detailFailures.length,
    detailFailureSample: detailFailures.slice(0, 10),
    detailsSkipped: Math.max(0, out.length - detailItems.length),
    maxDetailItems: MAX_DETAIL_ITEMS,
    detailPriority: "ML/DS, then intern/junior, then other configured professions; API order breaks ties",
    configuredProfessions: professions,
  });
}

function detailPriority(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (/\bml\b|machine learning|машинн\w+ обучен|data scientist|data science|\bnlp\b|\bllm\b|нейросет|искусственн\w+ интеллект/.test(text)) return 0;
  if (/intern|стаж[её]р|junior|младш|начальн/.test(text)) return 1;
  return 2;
}

function normalizeLevel(value) {
  const level = String(value || "").split(".").at(-1).toLowerCase();
  return ["intern", "junior", "middle", "senior", "expert"].includes(level) ? level : "";
}

function joinText(...values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => typeof value === "string" ? value : value?.text || value?.name || "")
    .filter(Boolean).join("\n");
}

export default { name: "yandex", fetch: fetchYandex };
