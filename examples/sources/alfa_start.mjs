import { withSourceMeta } from "../../src/lib/source-meta.mjs";
import { sourceFetch as fetch } from "../../src/lib/source-fetch.mjs";

const URL = "https://alfabank.ru/alfafuture/ichoosealfa/";

export async function fetchAlfaStart() {
  const response = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 sasaki-agent/0.1" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Альфа Future HTTP ${response.status}`);
  const html = await response.text();
  if (!/Альфа.?Фьюче?r|iChooseAlfa|стажировк/i.test(html)) {
    throw new Error("Альфа Future: ожидаемая студенческая программа не найдена на публичной странице");
  }
  const explicitlyClosed = /набор\s+(?:закрыт|завершен)|прием\s+заявок\s+завершен/i.test(html);
  const explicitlyOpen = /набор\s+открыт|прием\s+заявок\s+открыт/i.test(html);
  const activeMlCard = /data.?scientist|машинн\w+ обучен|\bML\b|machine learning|\bNLP\b|\bLLM\b/i.test(html);
  const item = explicitlyOpen && activeMlCard ? {
    source: "alfa_start",
    id: "ichoosealfa-ml",
    title: "Стажёр ML / Data Science — iChooseAlfa",
    company: "Альфа-Банк",
    url: URL,
    salary: "",
    location: "",
    availability: "active",
    level: "intern",
    opportunityType: "internship_program",
    description: "Официальная страница сообщает об открытом наборе и содержит ML/Data Science направление.",
    published: "",
  } : null;
  return withSourceMeta(item ? [item] : [], {
    status: explicitlyClosed ? "closed" : item ? "program_open" : "unknown",
    reason: explicitlyClosed
      ? `Страница сообщает, что набор закрыт: ${URL}`
      : item
        ? `Страница сообщает об открытом наборе и содержит ML/DS направление; карточка отражает программу, не отдельную вакансию: ${URL}`
        : `Страница или публичная сеть не подтвердили текущий набор именно на ML-стажировку: ${URL}`,
    opportunityType: "internship_program",
    page: URL,
  });
}

export default { name: "alfa_start", fetch: fetchAlfaStart };
