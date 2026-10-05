// VK (team.vk.company): Next.js, вакансии вшиты в SSR-HTML как __NEXT_DATA__.
// Фильтр — query-параметр specialty; поддерживаем только явно заданные
// специализации, чтобы не тянуть старую дизайн-категорию.
const BASE = "https://team.vk.company/vacancy/";
const PAGE_SIZE = 25;
const MAX_PAGES = 5;
import { withSourceMeta } from "../lib/source-meta.mjs";

export async function fetchVk(cfg) {
  const specialties = cfg.vk?.specialties || [];
  const seen = new Set();
  const out = [];
  const cappedSpecialties = [];
  const detailFailures = [];
  for (const sp of specialties) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE}?specialty=${sp}${page > 1 ? `&page=${page}` : ""}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`VK HTTP ${res.status}`);
      const html = await res.text();
      const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!m) throw new Error("VK: __NEXT_DATA__ не найден (изменилась вёрстка?)");
      const pp = JSON.parse(m[1])?.props?.pageProps || {};
      const items = pp.initialVacancies || [];
      if (!Array.isArray(items) || !Number.isFinite(Number(pp.initialTotalCount))) {
        throw new Error("VK: изменилась схема каталога (ожидались initialVacancies[] и initialTotalCount)");
      }
      for (const v of items) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        const id = String(v.id);
        const url = `https://team.vk.company/vacancy/${id}/`;
        let detail = { description: "", requirements: "", level: "", location: "" };
        try {
          detail = await fetchVacancyDetails(url, id);
        } catch (error) {
          detailFailures.push({ id, reason: error.message });
        }
        await new Promise((r) => setTimeout(r, 300));
        out.push({
          source: "vk",
          id,
          title: v.title,
          company: v.group?.name ? `VK · ${v.group.name}` : "VK",
          targetEmployer: "ВК",
          url,
          salary: "",
          location: fmtLocation(v) || detail.location,
          description: [v.description || v.description_text || "", detail.description].filter(Boolean).join("\n"),
          requirements: [v.requirements || "", detail.requirements].filter(Boolean).join("\n"),
          level: v.level || v.grade || detail.level || "",
          employmentType: v.employment_type || v.employment || "",
          availability: v.is_opened === true ? "active" : v.is_opened === false ? "closed" : "unknown",
          companyId: v.group?.id ? String(v.group.id) : "",
          canonicalUrl: url,
          published: "",
        });
      }
      const total = pp.initialTotalCount || 0;
      if (page === MAX_PAGES && page * PAGE_SIZE < total) cappedSpecialties.push(String(sp));
      if (items.length === 0 || page * PAGE_SIZE >= total) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return withSourceMeta(out, {
    status: cappedSpecialties.length || detailFailures.length ? "partial" : "bounded",
    reason: [
      cappedSpecialties.length ? `достигнут предел ${MAX_PAGES} страниц для specialty ${cappedSpecialties.join(", ")}` : null,
      detailFailures.length ? `не удалось загрузить детали ${detailFailures.length} вакансий` : null,
      "покрыты только настроенные specialty",
    ].filter(Boolean).join("; "),
    maxPagesPerSpecialty: MAX_PAGES,
    cappedSpecialties,
    detailsHydrated: out.length - detailFailures.length,
    detailsFailed: detailFailures.length,
    detailFailureSample: detailFailures.slice(0, 10),
  });
}

// Каталог SSR не содержит требований или уровня. Карточка вакансии отдаёт
// статичный HTML с секцией «Требования» и метаданными уровня.
async function fetchVacancyDetails(url, id) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`VK vacancy ${id} HTTP ${res.status}`);
  const html = await res.text();
  const article = html.match(/<div[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>\s*<div class="page-control"/i)?.[1] || "";
  const sections = [...article.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3\b|$)/gi)];
  const section = (name) => sections.find((m) => stripHtml(m[1]).toLowerCase() === name)?.[2] || "";
  const description = stripHtml(article.split(/<h3\b/i)[0]);
  const requirements = stripHtml(section("требования"));
  const meta = html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || "";
  const level = meta.match(/уровня\s+([\p{L}-]+)/iu)?.[1] || "";
  const location = html.match(/<meta itemprop="addressLocality" content="([^"]+)"/i)?.[1] || "";
  return { description, requirements, level: normalizeLevel(level), location: decodeEntities(location) };
}

function normalizeLevel(level) {
  return ({ junior: "junior", middle: "middle", senior: "senior", стажер: "intern", стажёр: "intern" })[level.toLowerCase()] || level;
}

function stripHtml(value) {
  return decodeEntities(value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ").trim());
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

// Форматы VK («Офисный», «Дистанционный», «Комбинированный», «гибкий») →
// слова, которые понимает фильтр «Формат».
const FORMAT = {
  офисный: "офис",
  дистанционный: "удалённо",
  комбинированный: "гибрид",
  гибкий: "гибрид",
};

function fmtLocation(v) {
  const raw = (v.work_format || "").toLowerCase();
  const fmt = v.remote ? "удалённо" : FORMAT[raw] || v.work_format || "";
  return [v.town?.name, fmt].filter(Boolean).join(" · ");
}

export default { name: "vk", fetch: fetchVk };
