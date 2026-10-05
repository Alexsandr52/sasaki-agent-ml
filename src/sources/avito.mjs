import { withSourceMeta } from "../lib/source-meta.mjs";

const API = "https://career.avito.com/vacancies/?q=&action=filter";
const UA = "Mozilla/5.0 (Macintosh) sasaki-agent/0.1";
const TIMEOUT_MS = 12_000;
const DETAIL_CONCURRENCY = 4;

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function textFromHtml(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseJobPosting(html) {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, raw] of scripts) {
    try {
      const value = JSON.parse(raw);
      const entries = Array.isArray(value) ? value : [value];
      const posting = entries.find((entry) => entry?.["@type"] === "JobPosting");
      if (posting) return posting;
    } catch {
      // Other JSON-LD blocks on the page are not necessarily valid JSON.
    }
  }
  return null;
}

function parseVacancies(html) {
  if (!html.includes("js-vacancies-sections")) {
    throw new Error("Авито: изменилась схема ответа AJAX (нет списка вакансий)");
  }

  const byId = new Map();
  const sections = html.split(/<div\s+class="vacancies-section__item"/).slice(1);
  for (const tail of sections) {
    const block = tail.split(/<div\s+class="vacancies-section__item"/)[0];
    const link = block.match(/<a\s+href="(\/vacancies\/[^"?#]+\/\d+\/)"[^>]*class="vacancies-section__item-name"[^>]*>([\s\S]*?)<\/a>/i);
    const id = (block.match(/data-vacancy-id="(\d+)"/) || [])[1];
    if (!link || !id) continue;

    const canonicalId = link[1].match(/\/(\d+)\/$/)?.[1] || id;
    const geo = (block.match(/data-vacancy-geo="([^"]*)"/) || [])[1] || "";
    const remote = (block.match(/data-vacancy-remote="([^"]*)"/) || [])[1] === "Да";
    const intern = (block.match(/data-vacancy-intern="([^"]*)"/) || [])[1] === "Да";
    const section = (block.match(/data-vacancy-section="([^"]*)"/) || [])[1] || "";
    const format = (block.match(/class="vacancies-section__item-format"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "";
    const title = textFromHtml(link[2]);
    if (!title) continue;

    byId.set(canonicalId, {
      source: "avito",
      id: canonicalId,
      title,
      company: "Авито",
      url: `https://career.avito.com${link[1]}`,
      salary: "",
      location: [geo, remote ? "удалённо" : "", textFromHtml(format)].filter(Boolean).join(" · "),
      published: "",
      availability: "active",
      direction: decodeHtml(section),
      ...(intern ? { level: "intern", employmentType: "стажировка" } : {}),
    });
  }
  if (!sections.length && !/нет вакансий|ничего не найдено/i.test(html)) {
    throw new Error("Авито: изменилась схема ответа AJAX (не найдены карточки вакансий)");
  }
  return [...byId.values()];
}

async function enrichDetails(items) {
  const candidates = items.filter((item) => item.direction === "Data Science"
    || /\b(?:ML|AI|Data Scientist|Data Science|MLOps|NLP|LLM|CV)\b|машинн\w+ обуч|компьютерн\w+ зрени/i.test(item.title));
  const problems = [];
  let next = 0;

  async function worker() {
    while (next < candidates.length) {
      const item = candidates[next++];
      try {
        const res = await fetch(item.url, {
          headers: { "User-Agent": UA, Referer: "https://career.avito.com/vacancies/" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const posting = parseJobPosting(await res.text());
        if (!posting || typeof posting.description !== "string") {
          throw new Error("на странице нет JobPosting.description в JSON-LD");
        }
        item.description = textFromHtml(posting.description);
        if (posting.datePosted) item.published = String(posting.datePosted).slice(0, 10);
        if (posting.validThrough) {
          item.validThrough = String(posting.validThrough).slice(0, 10);
          const expiresAt = Date.parse(posting.validThrough);
          if (Number.isFinite(expiresAt) && expiresAt < Date.now()) item.availability = "closed";
        }
      } catch (error) {
        problems.push(`${item.id}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, candidates.length) }, worker));
  return { candidates: candidates.length, problems };
}

export async function fetchAvito() {
  const res = await fetch(API, {
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://career.avito.com/vacancies/",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Авито HTTP ${res.status}`);

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error("Авито: изменилась схема ответа AJAX (ожидался JSON)");
  }
  if (typeof payload?.html !== "string") {
    throw new Error("Авито: изменилась схема ответа AJAX (ожидалось поле html)");
  }

  const items = parseVacancies(payload.html);
  const details = await enrichDetails(items);
  const problems = details.problems;
  return withSourceMeta(items, {
    status: problems.length ? "partial" : "bounded",
    reason: `Публичный AJAX-каталог вернул ${items.length} уникальных вакансий без фильтра направления; JSON-LD карточек ML/DS обогащён для ${details.candidates - problems.length} из ${details.candidates}.${problems.length ? ` Не удалось обогатить: ${problems.join("; ")}.` : ""}`,
  });
}

export default { name: "avito", fetch: fetchAvito };
