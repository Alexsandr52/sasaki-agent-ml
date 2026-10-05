import { sourceFetch as fetch } from "../lib/source-fetch.mjs";
// ODS.ai Jobs: публичный API, который использует страница /jobs.
// Список содержит опубликованные вакансии; листаем свежие записи до конца.
const API = "https://api.ods.ai/api/tools/vacancy/list/";
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const CURRENCY = { RUB: "₽", USD: "$", EUR: "€", KZT: "₸" };
const PERIOD = { Month: "/мес.", Year: "/год", Hour: "/час" };
import { withSourceMeta } from "../lib/source-meta.mjs";

export async function fetchOds(cfg) {
  const out = [];
  let lastPageSize = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1",
        Referer: "https://ods.ai/jobs",
      },
      body: JSON.stringify({
        status: ["Published"],
        sort: "-publication_dt",
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    });
    if (!res.ok) throw new Error(`ODS.ai HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.vacancies)) throw new Error("ODS.ai: изменилась схема API (ожидалось vacancies[])");
    const vacancies = data.vacancies || [];
    lastPageSize = vacancies.length;
    for (const v of vacancies) {
      const cities = (v.cities || []).map((city) => typeof city === "string" ? city : city.name).filter(Boolean);
      out.push({
        source: "ods",
        id: String(v.id),
        title: v.title || "",
        company: typeof v.company === "string" ? v.company : v.company?.name || v.company_name || "",
        url: `https://ods.ai/jobs/${v.id}`,
        salary: salaryOf(v),
        location: [formatOf(v.work_type), ...cities, v.type_of_employment].filter(Boolean).join(" · "),
        published: v.publication_dt || "",
        description: v.description || v.description_text || "",
        requirements: v.requirements || "",
        experience: v.experience || v.experience_text || "",
        employmentType: v.type_of_employment || "",
        availability: v.status === "Published" ? "active" : String(v.status || "unknown").toLowerCase(),
        canonicalUrl: `https://ods.ai/jobs/${v.id}`,
      });
    }
    if (vacancies.length < PAGE_SIZE) break;
    if (page + 1 < MAX_PAGES) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const limited = lastPageSize === PAGE_SIZE && out.length >= PAGE_SIZE * MAX_PAGES;
  return withSourceMeta(out, {
    status: limited ? "partial" : "bounded",
    reason: limited ? `достигнут предел ${MAX_PAGES} страниц по ${PAGE_SIZE}` : "полнота относится к опубликованным записям API на момент запроса",
    maxPages: MAX_PAGES,
    pageSize: PAGE_SIZE,
  });
}

function salaryOf(v) {
  if (!v.salary_from && !v.salary_to) return "";
  const currency = CURRENCY[v.salary_currency] || v.salary_currency || "";
  const amount = (n) => `${Number(n).toLocaleString("ru-RU")} ${currency}`.trim();
  const range = v.salary_from && v.salary_to
    ? `${amount(v.salary_from)}–${amount(v.salary_to)}`
    : v.salary_from ? `от ${amount(v.salary_from)}` : `до ${amount(v.salary_to)}`;
  return `${range}${PERIOD[v.salary_payment_period] || ""}`;
}

function formatOf(value) {
  if (!value) return "";
  return String(value).replace(/remote/ig, "удалённо").replace(/office/ig, "офис");
}

export default { name: "ods", fetch: fetchOds };
