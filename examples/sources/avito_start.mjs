import { withSourceMeta } from "../../src/lib/source-meta.mjs";

const CATALOG = "https://start.avito.ru/internships";
const DATA_SCIENCE = "https://start.avito.ru/datascience-internship";

export async function fetchAvitoStart() {
  const headers = { "User-Agent": "Mozilla/5.0 sasaki-agent/0.1" };
  const catalog = await fetch(CATALOG, { headers, signal: AbortSignal.timeout(12_000) });
  if (!catalog.ok) throw new Error(`Авито Start HTTP ${catalog.status}`);
  const html = await catalog.text();
  if (!html.includes("datascience-internship")) {
    throw new Error("Авито Start: ссылка на Data Science стажировку не найдена (изменилась схема каталога?)");
  }
  const detail = await fetch(DATA_SCIENCE, { headers, signal: AbortSignal.timeout(12_000) });
  if (!detail.ok) throw new Error(`Авито Data Science стажировка HTTP ${detail.status}`);
  const body = await detail.text();
  if (/Регистрация\s+закрыта/i.test(body)) {
    return withSourceMeta([], {
      status: "closed",
      reason: `На официальной странице указано «Регистрация закрыта»: ${DATA_SCIENCE}. Data Science Bootcamp — отдельная учебная программа и не включается как вакансия.`,
      opportunityType: "internship_program",
      page: CATALOG,
    });
  }
  if (/Регистрация\s+открыта|Подать\s+заявку/i.test(body)) {
    return withSourceMeta([], {
      status: "unknown",
      reason: `Страница программы доступна, но активность набора пока не извлекается надёжно: ${DATA_SCIENCE}`,
      opportunityType: "internship_program",
      page: CATALOG,
    });
  }
  throw new Error("Авито Start: статус регистрации не распознан на странице Data Science стажировки");
}

export default { name: "avito_start", fetch: fetchAvitoStart };
