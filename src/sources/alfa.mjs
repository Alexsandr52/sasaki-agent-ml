// Альфа-Банк: открытый JSON API. businessLine задаётся в локальной конфигурации.
import { sourceFetch as fetch } from "../lib/source-fetch.mjs";
const API = "https://job.alfabank.ru/api/vacancies";
const PAGE = 100;
const MAX_PAGES = 5;
import { withSourceMeta } from "../lib/source-meta.mjs";

export async function fetchAlfa(cfg) {
  const lines = cfg.alfa?.businessLines || [];
  const out = [];
  const cappedLines = [];
  if (!lines.length) return withSourceMeta([], { status: "not_configured", reason: "Укажите alfa.businessLines после проверки справочника направлений." });
  for (const line of lines) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ businessLine: String(line), take: String(PAGE), skip: String(page * PAGE) });
      const url = `${API}?${params}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`Альфа HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.items) || !Number.isFinite(Number(json.total))) {
        throw new Error("Альфа: изменилась схема API (ожидались items[] и total)");
      }
      for (const v of json.items || []) {
        out.push({
          source: "alfa",
          id: String(v.id),
          title: v.name,
          company: "Альфа-Банк",
          url: `https://job.alfabank.ru/vacancies${v.slug}`,
          salary: "",
          location: fmtLocation(v),
          description: v.descriptionText || v.description || "",
          requirements: v.requirementsText || v.requirements || "",
          experience: v.experience || v.experienceCode || "",
          experienceText: v.experienceTitle || v.experienceText || "",
          level: levelFromTitle(v.name),
          availability: availabilityFrom(v),
          experienceCategory: v.experienceTitle || v.experienceText || "",
          experienceCode: v.experienceId || "",
          canonicalUrl: `https://job.alfabank.ru/vacancies${v.slug}`,
          published: v.createdAt || "",
        });
      }
      if (page === MAX_PAGES - 1 && (page + 1) * PAGE < Number(json.total)) cappedLines.push(String(line));
      if ((page + 1) * PAGE >= (json.total || 0)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return withSourceMeta(out, {
    status: cappedLines.length ? "partial" : "bounded",
    reason: cappedLines.length ? `достигнут предел ${MAX_PAGES} страниц для businessLine ${cappedLines.join(", ")}` : "результат ограничен настроенными businessLine; опыт берётся из требований/названия, API не отдаёт единый нормализованный грейд",
    maxPagesPerBusinessLine: MAX_PAGES,
    cappedLines,
  });
}

function availabilityFrom(v) {
  if (v.isHidden === true || v.isActive === false) return "inactive";
  if (v.isActive === true) return "active";
  const end = Date.parse(v.expirationDate || "");
  if (Number.isFinite(end)) return end > Date.now() ? "active" : "inactive";
  return "unknown";
}

function levelFromTitle(value) {
  const title = String(value || "").toLowerCase().replaceAll("ё", "е");
  if (/\b(?:senior|team lead|lead)\b/i.test(title) || /старш[а-яё]*|ведущ[а-яё]*|главн[а-яё]*|начальник|руководител[а-яё]*/i.test(title)) return "senior";
  if (/\bmiddle\b|\bмидл\b/i.test(title)) return "middle";
  if (/\bjunior\b|\bджун\b/i.test(title)) return "junior";
  if (/\bintern\b|стажер[а-яё]*/i.test(title)) return "intern";
  return "";
}

// Структурного поля формата у API нет: город берём из слага, формат работы
// вылавливаем из текста условий — слова, которые понимает фильтр «Формат».
const CITY = { moskva: "Москва", "sankt-peterburg": "Санкт-Петербург", ekaterinburg: "Екатеринбург", novosibirsk: "Новосибирск" };

function fmtLocation(v) {
  const slugCity = (v.slug || "").split("/")[1] || "";
  const city = CITY[slugCity] || slugCity;
  const t = [v.conditions, v.descriptionText].join(" ").toLowerCase().replaceAll("ё", "е");
  const fmt = [];
  if (/гибрид/.test(t)) fmt.push("гибрид");
  if (/удаленн|удаленк|дистанционн/.test(t)) fmt.push("удалённо");
  return [city, fmt.join("/")].filter(Boolean).join(" · ");
}

export default { name: "alfa", fetch: fetchAlfa };
