import { withSourceMeta } from "../../src/lib/source-meta.mjs";
import { sourceFetch as fetch } from "../../src/lib/source-fetch.mjs";

const URL = "https://career.raiffeisen.ru/start";

export async function fetchRaiffeisenStart() {
  const response = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 sasaki-agent/0.1" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Райффайзен Evolve HTTP ${response.status}`);
  const html = await response.text();
  if (!/Evolve Internship/i.test(html)) {
    throw new Error("Райффайзен Evolve: программа не найдена на публичной странице");
  }
  const dataProgram = /работа с данными|данными/i.test(html);
  const openMlIntake = /(?:набор|прием заявок)\s+(?:открыт|идет)[\s\S]{0,400}(?:ML|машинн\w+ обучен|Data Science)/i.test(html);
  const item = openMlIntake ? {
    source: "raiffeisen_start",
    id: "evolve-ml",
    title: "Стажёр Data Science / ML — Evolve Internship",
    company: "Райффайзенбанк",
    url: URL,
    salary: "",
    location: "",
    availability: "active",
    level: "intern",
    opportunityType: "internship_program",
    description: "Официальная страница сообщает об открытом наборе на ML/Data Science направление.",
    published: "",
  } : null;
  return withSourceMeta(item ? [item] : [], {
    status: item ? "program_open" : "unknown",
    reason: item
      ? `Публичная страница Evolve сообщает об активном приёме на ML/Data Science направление: ${URL}`
      : `Публичная страница Evolve Internship доступна${dataProgram ? " и описывает работу с данными" : ""}, но текущий ML-набор не подтверждён: ${URL}`,
    opportunityType: "internship_program",
    page: URL,
  });
}

export default { name: "raiffeisen_start", fetch: fetchRaiffeisenStart };
