import { withSourceMeta } from "../../src/lib/source-meta.mjs";
import { sourceFetch as fetch } from "../../src/lib/source-fetch.mjs";

const URL = "https://education.tbank.ru/start/ml_engineer/";

export async function fetchTbankStart() {
  const response = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 sasaki-agent/0.1" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Т-Банк ML internship HTTP ${response.status}`);
  const html = await response.text();
  if (!/ML|Machine Learning|машинн\w+ обучен/i.test(html)) {
    throw new Error("Т-Банк ML internship: ожидаемое направление не найдено на публичной странице");
  }
  const explicitlyClosed = /набор\s+(?:закрыт|завершен)|прием\s+заявок\s+завершен/i.test(html);
  const explicitlyOpen = /набор\s+открыт|прием\s+заявок\s+открыт/i.test(html);
  const item = explicitlyOpen ? {
    source: "tbank_start",
    id: "ml_engineer",
    title: "Стажёр ML-инженер",
    company: "Т-Банк",
    url: URL,
    salary: "",
    location: "Удалённо или офис · от 20 часов в неделю",
    availability: "active",
    level: "intern",
    opportunityType: "internship_program",
    description: "Оплачиваемая стажировка для начинающих ML-инженеров. На официальной странице явно отмечен открытый набор.",
    published: "",
  } : null;
  return withSourceMeta(item ? [item] : [], {
    status: explicitlyClosed ? "closed" : explicitlyOpen ? "program_open" : "unknown",
    reason: explicitlyClosed
      ? `Страница сообщает, что набор закрыт: ${URL}`
      : explicitlyOpen
        ? `Страница сообщает об открытом наборе; добавлена карточка программы, не отдельной вакансии: ${URL}`
        : `Страница доступна, но актуальный набор по её тексту не подтверждён. Кнопка подписки на анонсы не считается открытым приёмом: ${URL}`,
    opportunityType: "internship_program",
    page: URL,
  });
}

export default { name: "tbank_start", fetch: fetchTbankStart };
