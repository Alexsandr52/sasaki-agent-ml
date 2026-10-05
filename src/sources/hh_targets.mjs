import { withSourceMeta } from "../lib/source-meta.mjs";

const RSS = "https://hh.ru/search/vacancy/rss";
const UA = "sasaki-agent/0.1 (+https://github.com/peachcardinal/sasaki-agent)";
const PAUSE = 5000;
const TIMEOUT_MS = 12000;
const DETAIL_PAUSE = 1000;

// Separate searches preserve headroom under the 20-item RSS cap. In particular,
// NAME:ML is useful because HH's title tokenization misses some expanded terms.
export const ROLE_QUERIES = [
  ["ml", "NAME:ML"],
  ["machine_learning", 'NAME:"machine learning"'],
  ["data_scientist", 'NAME:"data scientist"'],
  ["data_science", 'NAME:"data science"'],
  ["computer_vision", 'NAME:"computer vision"'],
  ["nlp", "NAME:NLP"],
  ["llm", "NAME:LLM"],
];

const normalizeCompany = (value) => String(value || "")
  .toLowerCase().replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/gi, "");

export async function fetchHHTargets(cfg) {
  const employers = normalizeEmployers(cfg.hh?.employers || []);
  if (!employers.length) return withSourceMeta([], {
    status: "not_configured",
    reason: "Укажите hh.employers с точными названиями и проверенными алиасами.",
  });

  const pauseMs = Number.isFinite(cfg.hh?.targetsPauseMs) ? Math.max(0, cfg.hh.targetsPauseMs) : PAUSE;
  const byId = new Map();
  const employerStats = [];
  let successfulRequests = 0;
  let failedRequests = 0;
  let detailLimit = Number.isInteger(cfg.hh?.targetDetailsLimit)
    ? Math.max(0, Math.min(80, cfg.hh.targetDetailsLimit)) : 80;
  const detailErrors = [];
  let detailsAttempted = 0;
  let detailsEnriched = 0;

  for (const employer of employers) {
    const aliases = new Set(employer.aliases.map(normalizeCompany));
    const stat = {
      employer: employer.name,
      queries: ROLE_QUERIES.length,
      successfulQueries: 0,
      failedQueries: [],
      cappedQueries: [],
      raw: 0,
      companyMismatches: 0,
      duplicates: 0,
      unique: 0,
    };
    for (const [queryName, roleQuery] of ROLE_QUERIES) {
      const params = new URLSearchParams({
        text: `${roleQuery} AND (${employer.aliases.map((name) => `COMPANY_NAME:"${escapeSearch(name)}"`).join(" OR ")})`,
      });
      if (cfg.hh?.area) params.set("area", String(cfg.hh.area));
      if (cfg.hh?.period) params.set("period", String(cfg.hh.period));
      try {
        const response = await fetch(`${RSS}?${params}`, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const items = parseItems(await response.text());
        successfulRequests++;
        stat.successfulQueries++;
        stat.raw += items.length;
        if (items.length >= 20) stat.cappedQueries.push(queryName);
        for (const item of items) {
          // Exact normalized equality prevents short or overlapping aliases from
          // attributing another legal entity to the target employer.
          if (!aliases.has(normalizeCompany(item.company))) {
            stat.companyMismatches++;
            continue;
          }
          const existing = byId.get(item.id);
          if (existing) {
            stat.duplicates++;
            if (existing.targetEmployer !== employer.name) existing.alsoMatchedEmployers.push(employer.name);
            else existing.roleQueries.push(queryName);
            continue;
          }
          item.source = "hh_targets";
          item.targetEmployer = employer.name;
          item.alsoMatchedEmployers = [];
          item.roleQueries = [queryName];
          byId.set(item.id, item);
          stat.unique++;
        }
      } catch (error) {
        failedRequests++;
        stat.failedQueries.push({ query: queryName, error: error.message });
      }
      if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    employerStats.push(stat);
  }

  // RSS omits full requirements. Enrich only a small, bounded number of unique
  // HH vacancy URLs, and never follow a URL outside hh.ru.
  const allCandidates = [...byId.values()];
  const detailCandidates = roundRobinDetails(allCandidates).slice(0, detailLimit);
  const detailsSkipped = allCandidates.length - detailCandidates.length;
  for (const [index, item] of detailCandidates.entries()) {
    const detailUrl = safeVacancyUrl(item.url);
    if (!detailUrl) continue;
    if (index && DETAIL_PAUSE) await new Promise((resolve) => setTimeout(resolve, DETAIL_PAUSE));
    detailsAttempted++;
    try {
      const response = await fetch(detailUrl, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const detail = await parseJobPosting(await response.text());
      if (detail) {
        item.description = detail.description;
        item.requirements = detail.experienceRequirements;
        item.experienceCategory = detail.experienceCategory;
        item.experienceCategoryMin = detail.experienceCategoryMin;
        if (detail.title) item.detailTitle = detail.title;
        if (detail.employmentType) item.employmentType = detail.employmentType;
        detailsEnriched++;
      } else detailErrors.push({ id: item.id, error: "JobPosting JSON-LD отсутствует или не разобран" });
    } catch (error) {
      detailErrors.push({ id: item.id, error: error.message });
    }
  }

  if (!successfulRequests) {
    const details = employerStats.flatMap((s) => s.failedQueries.map((f) => `${s.employer}/${f.query}: ${f.error}`));
    throw new Error(`hh.ru employer RSS: все ${failedRequests} запросов завершились ошибкой (${details.slice(0, 5).join("; ")})`);
  }

  const capped = employerStats.flatMap((s) => s.cappedQueries.map((q) => `${s.employer}/${q}`));
  const failed = employerStats.flatMap((s) => s.failedQueries.map((f) => `${s.employer}/${f.query}`));
  const partial = capped.length || failed.length || detailErrors.length || detailsSkipped > 0;
  return withSourceMeta([...byId.values()], {
    status: partial ? "partial" : "bounded",
    reason: [
      "HH RSS ограничивает каждую ролевую выдачу 20 карточками, не сообщает total и не отдаёт полное описание",
      capped.length ? `достигнут лимит в ${capped.length} запросах` : "",
      failed.length ? `ошибки в ${failed.length} запросах, остальные запросы продолжены` : "",
      detailErrors.length ? `ошибки загрузки ${detailErrors.length} страниц вакансий` : "",
      detailsSkipped ? `JSON-LD не загружался для ещё ${detailsSkipped} карточек из-за лимита detail` : "",
      "работодатель принят только при точном совпадении нормализованного имени карточки с алиасом",
    ].filter(Boolean).join("; "),
    employers: employerStats,
    requestCount: ROLE_QUERIES.length * employers.length,
    successfulRequests,
    failedRequests,
    resultLimitPerQuery: 20,
    cappedQueries: capped,
    failedQueries: failed,
    detailEnrichment: { limit: detailLimit, candidateCount: allCandidates.length, attempted: detailsAttempted, enriched: detailsEnriched, skipped: detailsSkipped, errors: detailErrors },
  });
}

function roundRobinDetails(items) {
  const groups = new Map();
  for (const item of items) {
    const employer = item.targetEmployer || "other";
    if (!groups.has(employer)) groups.set(employer, []);
    groups.get(employer).push(item);
  }
  const queues = [...groups.values()].map((group) => group.map((item, index) => ({ item, index, priority: titlePriority(item.title) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index).map(({ item }) => item));
  const ordered = [];
  while (queues.some((queue) => queue.length)) {
    for (const queue of queues) if (queue.length) ordered.push(queue.shift());
  }
  return ordered;
}

function titlePriority(title) {
  const value = String(title || "").toLowerCase().replaceAll("ё", "е");
  if (/\b(?:intern|internship|junior|джун)\b/i.test(value) || /стажер|стажировк/i.test(value)) return 0;
  if (/\b(?:senior|lead|head)\b/i.test(value) || /руководител|начальник|старш|ведущ/i.test(value)) return 2;
  return 1;
}

function safeVacancyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hh.ru" && /^\/vacancy\/\d+\/?$/.test(url.pathname)
      ? url.href : "";
  } catch { return ""; }
}

async function parseJobPosting(html) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const root = JSON.parse(match[1].replaceAll("&quot;", '"').trim());
      const queue = Array.isArray(root) ? [...root] : [root];
      while (queue.length) {
        const value = queue.shift();
        if (!value || typeof value !== "object") continue;
        if (Array.isArray(value)) { queue.push(...value); continue; }
        if (value["@graph"]) queue.push(value["@graph"]);
        const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
        if (type.includes("JobPosting")) {
          const description = htmlText(value.description || "");
          const experienceRequirements = experienceText(value.experienceRequirements || "");
          const pageDescription = htmlText((html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || "");
          const experienceCategory = (pageDescription.match(/требуемый опыт:\s*([^.;]+)/i) || [])[1]?.trim() || "";
          const range = experienceCategory.match(/(\d+)\s*[–—-]\s*(\d+)\s*лет/i);
          return {
            title: htmlText(value.title || ""),
            description,
            experienceRequirements,
            experienceCategory,
            experienceCategoryMin: range ? Number(range[1]) : undefined,
            employmentType: Array.isArray(value.employmentType) ? value.employmentType.join(", ") : String(value.employmentType || ""),
          };
        }
      }
    } catch { /* Ignore unrelated or malformed JSON-LD blocks. */ }
  }
  return null;
}

function htmlText(value) {
  return String(value || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function experienceText(value) {
  if (Array.isArray(value)) return value.map(experienceText).filter(Boolean).join("; ");
  if (value && typeof value === "object") {
    const months = Number(value.monthsOfExperience);
    if (Number.isFinite(months) && months >= 0) return `${months} мес. опыта`;
    return Object.entries(value).filter(([key]) => !key.startsWith("@"))
      .map(([key, item]) => `${key}: ${experienceText(item)}`).join("; ");
  }
  return htmlText(value);
}

function normalizeEmployers(entries) {
  return entries.map((entry) => typeof entry === "string" ? { name: entry, aliases: [entry] } : entry)
    .filter((entry) => entry?.name && Array.isArray(entry.aliases) && entry.aliases.length)
    .map((entry) => ({ name: String(entry.name), aliases: [...new Set(entry.aliases.map(String).filter((s) => normalizeCompany(s)))] }))
    .filter((entry) => entry.aliases.length);
}

const escapeSearch = (value) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');

function parseItems(xml) {
  const out = [];
  for (const block of xml.split("<item>").slice(1)) {
    const url = tag(block, "link");
    const id = (url.match(/vacancy\/(\d+)/) || [])[1];
    if (!id) continue;
    const description = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || "";
    out.push({
      source: "hh_targets", id,
      title: decode(tag(block, "title")),
      company: decode(field(description, "Вакансия компании")),
      url, salary: "", location: decode(field(description, "Регион")),
      availability: "active", formatUnknown: true, published: tag(block, "pubDate"),
    });
  }
  return out;
}

const tag = (block, name) => (block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]?.trim() || "";
const field = (description, label) => (description.match(new RegExp(`${label}:\\s*([^<]*)`)) || [])[1]?.trim() || "";
const decode = (value) => String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export default { name: "hh_targets", fetch: fetchHHTargets };
