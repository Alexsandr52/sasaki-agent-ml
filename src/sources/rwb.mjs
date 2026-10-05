import { withSourceMeta } from "../lib/source-meta.mjs";

// Endpoint and filter names are taken from the public career site bundle:
// /hr-crm-api/api/v2/pub/vacancies?limit=…&offset=…
const API = "https://career.rwb.ru/hr-crm-api/api/v2/pub/vacancies";
const PAGE_SIZE = 50; // The API currently caps list responses at 50 even when limit is larger.
const MAX_PAGES = 40;
const MAX_DETAIL_ITEMS = 25;
const DETAIL_CONCURRENCY = 4;
const DETAIL_RETRIES = 1;
const TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (Macintosh) sasaki-agent/0.1";

async function fetchPage(offset) {
  const url = new URL(API);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://career.rwb.ru/vacancies" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RWB HTTP ${res.status}`);

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error("RWB: изменилась схема ответа API (ожидался JSON)");
  }
  const data = payload?.data;
  if (!Array.isArray(data?.items) || !Number.isFinite(Number(data?.range?.count))) {
    throw new Error("RWB: изменилась схема ответа API (ожидались data.items[] и data.range.count)");
  }
  return data;
}

async function fetchDetail(id) {
  const url = `${API}/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://career.rwb.ru/vacancies" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RWB vacancy ${id} HTTP ${res.status}`);

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`RWB vacancy ${id}: изменилась схема detail API (ожидался JSON)`);
  }
  const detail = payload?.data;
  if (!detail || String(detail.id) !== String(id)) {
    throw new Error(`RWB vacancy ${id}: изменилась схема detail API (ожидался data.id)`);
  }
  return detail;
}

async function fetchDetailWithRetry(id) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchDetail(id);
    } catch (error) {
      if (attempt >= DETAIL_RETRIES || !/fetch failed|timeout|timed out|HTTP 5\d\d|HTTP 429|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(error.message)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

function toJob(v) {
  if (v.id == null || typeof v.name !== "string" || !v.name.trim()) {
    throw new Error("RWB: изменилась схема ответа API (у вакансии нет id или name)");
  }
  const employment = (v.employment_types || []).map((e) => e.title).filter(Boolean);
  const location = [
    v.city_title,
    ...employment,
    v.experience_type_title,
  ].filter(Boolean).join(" · ");
  return {
    source: "rwb",
    id: String(v.id),
    title: v.name.trim(),
    company: "RWB (Wildberries)",
    targetEmployer: "Wildberries",
    url: `https://career.rwb.ru/vacancies/${v.id}`,
    salary: "",
    location,
    published: "",
    availability: "unknown",
    direction: v.direction_title || "",
    level: v.experience_type_title || "",
    experience_type_title: v.experience_type_title || "",
    employmentType: employment.join("/") || "",
  };
}

function isMlCandidate(job) {
  return /\b(?:ML|MLOps|Data Scientist|Data Science|Machine Learning|NLP|LLM|CV)\b|машинн\w+ обуч|компьютерн\w+ зрени/i
    .test(`${job.title} ${job.direction}`);
}

async function enrichDetails(items) {
  const candidates = items.filter(isMlCandidate);
  const details = candidates.slice(0, MAX_DETAIL_ITEMS);
  const problems = [];
  let hydrated = 0;
  if (candidates.length > details.length) {
    problems.push(`детали загружены только для первых ${details.length} из ${candidates.length} ML/DS вакансий`);
  }
  let next = 0;

  async function worker() {
    while (next < details.length) {
      const item = details[next++];
      try {
        const detail = await fetchDetailWithRetry(item.id);
        if (typeof detail.description !== "string" || typeof detail.requirements !== "string") {
          throw new Error(`RWB vacancy ${item.id}: в detail API отсутствуют description или requirements`);
        }
        item.description = detail.description;
        item.requirements = detail.requirements;
        hydrated += 1;
        if (detail.experience_type_title) {
          item.level = detail.experience_type_title;
          item.experience_type_title = detail.experience_type_title;
        }
        if (typeof detail.is_active === "boolean" && typeof detail.is_public === "boolean") {
          item.availability = detail.is_active && detail.is_public ? "active" : "closed";
        } else {
          item.availability = "unknown";
          problems.push(`${item.id}: в detail API нет булевых is_active/is_public`);
        }
      } catch (error) {
        problems.push(`${item.id}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, details.length) }, worker));
  return { candidates: candidates.length, hydrated, problems };
}

export async function fetchRwb() {
  const byId = new Map();
  let expectedCount = null;
  let offset = 0;
  let pages = 0;
  const problems = [];

  while (expectedCount === null || offset < expectedCount) {
    if (pages >= MAX_PAGES) {
      problems.push(`достигнут лимит страниц (${MAX_PAGES})`);
      break;
    }
    let data;
    try {
      data = await fetchPage(offset);
    } catch (error) {
      if (!pages) throw error;
      problems.push(`страница offset=${offset} не получена: ${error.message}`);
      break;
    }
    const pageCount = Number(data.range.count);
    if (expectedCount === null) expectedCount = pageCount;
    else if (pageCount !== expectedCount) {
      problems.push(`число вакансий изменилось во время пагинации (${expectedCount} → ${pageCount})`);
      expectedCount = pageCount;
    }
    if (!data.items.length && offset < expectedCount) {
      problems.push(`пустая страница на offset=${offset} при total=${expectedCount}`);
      break;
    }

    for (const vacancy of data.items) {
      try {
        const job = toJob(vacancy);
        byId.set(job.id, job);
      } catch (error) {
        problems.push(error.message);
      }
    }
    pages += 1;
    offset += data.items.length;
    if (offset < expectedCount) await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const items = [...byId.values()];
  const detailResult = await enrichDetails(items);
  problems.push(...detailResult.problems);
  return withSourceMeta(items, {
    status: problems.length ? "partial" : "bounded",
    reason: `Публичный каталог RWB: получено ${items.length} уникальных вакансий из ${expectedCount}; страниц: ${pages}; ML/DS detail заполнен для ${detailResult.hydrated} из ${detailResult.candidates}.${problems.length ? ` Неполнота: ${[...new Set(problems)].join("; ")}.` : " API листается до текущего total; карточки ML/DS ограничены фильтром каталога."}`,
    detailsHydrated: detailResult.hydrated,
    maxDetailItems: MAX_DETAIL_ITEMS,
  });
}

export default { name: "rwb", fetch: fetchRwb };
