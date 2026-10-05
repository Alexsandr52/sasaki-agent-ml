// Official Yandex ML internship programme. Emit it as a programme opportunity
// only while the page still states that applications are accepted year-round.
import { withSourceMeta } from "../../src/lib/source-meta.mjs";

const ML_URL = "https://yandex.ru/yaintern/ml";
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" };
const OPEN_EVIDENCE = /Стажировка проходит круглый год, поэтому вы можете подать заявку в любое время/i;

export async function fetchYandexStart() {
  const response = await fetch(ML_URL, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Яндекс ML-стажировка HTTP ${response.status}`);
  const html = await response.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const description = decodeEntities(html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] || "");
  const relevantPage = /машинное обучение/i.test(decodeEntities(title)) && /стажировка/i.test(decodeEntities(title));
  const text = decodeEntities(html.replace(/&nbsp;|&#160;/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
  const available = relevantPage && OPEN_EVIDENCE.test(text);
  if (!available) {
    return withSourceMeta([], {
      status: "unknown",
      reason: "Официальная страница не подтверждает одновременно ML-направление и открытый круглогодичный приём.",
      opportunityType: "internship_program",
      page: ML_URL,
    });
  }
  return withSourceMeta([{
    source: "yandex_start",
    id: "yandex-ml-internship",
    title: "ML-стажировка в Яндексе",
    company: "Яндекс",
    url: ML_URL,
    applyUrl: ML_URL,
    salary: "",
    location: "",
    level: "intern",
    opportunityType: "internship_program",
    availability: "active",
    description,
    requirements: "Стажировка не предполагает обучение с нуля; ожидаются базовые знания по выбранному направлению.",
    published: "",
  }], {
    status: "program_open",
    reason: "Страница ML-стажировки подтверждает круглогодичный приём заявок. Минимальный опыт в годах не указан.",
    opportunityType: "internship_program",
    page: ML_URL,
    applicationUrl: ML_URL,
  });
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

export default { name: "yandex_start", fetch: fetchYandexStart };
