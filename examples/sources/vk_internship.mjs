// VK internship and junior catalogues: public Next.js data in SSR HTML.
import { withSourceMeta } from "../../src/lib/source-meta.mjs";

const PAGES = [
  ["internship", "https://internship.vk.company/internship"],
  ["junior", "https://internship.vk.company/vacancy"],
];
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh) sasaki-agent/0.1" };

export async function fetchVkInternship() {
  const byId = new Map();
  for (const [catalog, url] of PAGES) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`VK internship HTTP ${res.status}`);
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("VK internship: __NEXT_DATA__ не найден");
    const page = JSON.parse(m[1])?.props?.pageProps?.page;
    if (!Array.isArray(page?.vacancies)) {
      throw new Error("VK internship: изменилась схема каталога (ожидалось page.vacancies[])");
    }
    for (const v of page.vacancies) {
      if (v.id == null || !v.title) continue;
      const id = String(v.id);
      byId.set(id, {
        source: "vk_internship",
        id,
        title: v.title,
        company: "VK",
        targetEmployer: "ВК",
        url: `https://internship.vk.company/vacancy/${encodeURIComponent(id)}`,
        salary: "",
        location: [v.city, ({ remote: "удалённо", hybrid: "гибрид", office: "офис" })[v.format] || v.format].filter(Boolean).join(" · "),
        level: v.internship_type === "internship" ? "intern" : v.internship_type === "junior" ? "junior" : "",
        employmentType: v.employment || "",
        availability: v.is_opened === false ? "closed" : v.is_opened === true ? "active" : "unknown",
        opportunityType: "internship",
        forOnlyStudents: Boolean(v.for_only_students),
        directionId: String(v.direction ?? ""),
        businessUnitId: String(v.business_unit ?? ""),
        workStarts: v.date_work_starts || "",
        workEnds: v.date_work_ends || "",
        evidence: { catalog, isOpened: v.is_opened, internshipType: v.internship_type },
        published: "",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const records = [...byId.values()];
  return withSourceMeta(records, {
    status: "bounded",
    reason: "Прочитаны публичные каталоги internship и junior; глубина выдачи определяется SSR-каталогом.",
    catalogs: PAGES.map(([name]) => name),
    count: records.length,
  });
}

export default { name: "vk_internship", fetch: fetchVkInternship };
