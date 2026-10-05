import test from "node:test";
import assert from "node:assert/strict";
import { fetchAvito } from "../src/sources/avito.mjs";
import { fetchRwb } from "../src/sources/rwb.mjs";
import { fetchAvitoStart } from "../examples/sources/avito_start.mjs";

const response = (body, status = 200) => new Response(body, {
  status,
  headers: { "content-type": "application/json" },
});
const htmlResponse = (body, status = 200) => new Response(body, {
  status,
  headers: { "content-type": "text/html; charset=utf-8" },
});

test("Avito fetches the public all-directions AJAX list without direction config", async (t) => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url, options) => {
    requested.push({ url: String(url), options });
    if (String(url).includes("/vacancies/data-science/")) {
      return htmlResponse(`<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", title: "Data Scientist & ML", datePosted: "2026-09-20T12:00:00+03:00",
        validThrough: "2028-09-20T12:00:00+03:00",
        description: "Опыт от&nbsp;3 лет<br>Разработка ML-моделей",
      })}</script>`);
    }
    return response(JSON.stringify({ html: `<div class="js-vacancies-sections">
      <section><div class="vacancies-section__item"
        data-vacancy-id="8229" data-vacancy-section="Data Science"
        data-vacancy-geo="Москва" data-vacancy-remote="Да" data-vacancy-intern="Нет">
        <a href="/vacancies/data-science/20704/" class="vacancies-section__item-name">Data Scientist &amp; ML</a>
        <span class="vacancies-section__item-format">Гибрид</span>
      </div></section></div>` }));
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const jobs = await fetchAvito({});
  assert.equal(new URL(requested[0].url).search, "?q=&action=filter");
  assert.equal(requested[0].options.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(requested[1].url, "https://career.avito.com/vacancies/data-science/20704/");
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    source: "avito",
    id: "20704",
    title: "Data Scientist & ML",
    company: "Авито",
    url: "https://career.avito.com/vacancies/data-science/20704/",
    salary: "",
    location: "Москва · удалённо · Гибрид",
    published: "2026-09-20",
    availability: "active",
    direction: "Data Science",
    description: "Опыт от 3 лет Разработка ML-моделей",
    validThrough: "2028-09-20",
  });
  assert.equal(jobs.sourceMeta.status, "bounded");
  assert.match(jobs.sourceMeta.reason, /JSON-LD карточек ML\/DS обогащён для 1 из 1/);
});

test("Avito reports API and schema failures", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response("{}", 502);
  await assert.rejects(fetchAvito(), /Авито HTTP 502/);
  globalThis.fetch = async () => response(JSON.stringify({ nope: "html" }));
  await assert.rejects(fetchAvito(), /изменилась схема ответа AJAX/);
});

test("Avito preserves the catalog when a JSON-LD detail page fails", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => String(url).includes("/vacancies/data-science/")
    ? response("unavailable", 503)
    : response(JSON.stringify({ html: `<div class="js-vacancies-sections"><div class="vacancies-section__item"
        data-vacancy-id="9" data-vacancy-section="Data Science" data-vacancy-geo="Москва"
        data-vacancy-remote="Нет" data-vacancy-intern="Нет">
        <a href="/vacancies/data-science/9/" class="vacancies-section__item-name">Data Scientist</a>
      </div></div>` }));
  const result = await fetchAvito();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "9");
  assert.equal(result.sourceMeta.status, "partial");
  assert.match(result.sourceMeta.reason, /9: HTTP 503/);
});

test("Avito marks a JSON-LD vacancy closed after validThrough expires", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => String(url).includes("/vacancies/data-science/")
    ? htmlResponse(`<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting", description: "ML vacancy", validThrough: "2025-01-01T00:00:00Z",
    })}</script>`)
    : response(JSON.stringify({ html: `<div class="js-vacancies-sections"><div class="vacancies-section__item"
        data-vacancy-id="10" data-vacancy-section="Data Science" data-vacancy-geo="Москва"
        data-vacancy-remote="Нет" data-vacancy-intern="Нет">
        <a href="/vacancies/data-science/10/" class="vacancies-section__item-name">Data Scientist</a>
      </div></div>` }));
  const result = await fetchAvito();
  assert.equal(result[0].validThrough, "2025-01-01");
  assert.equal(result[0].availability, "closed");
});

test("RWB reads all pages from the public v2 API without direction IDs", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname.endsWith("/1") || parsed.pathname.endsWith("/2")) {
      const id = parsed.pathname.split("/").at(-1);
      const active = id === "1";
      return response(JSON.stringify({ data: {
        id: Number(id), is_active: active, is_public: true,
        description: `${id} description`, requirements: `${id} requirements`,
        experience_type_title: active ? "Без опыта" : "От 3 лет",
      } }));
    }
    const offset = Number(parsed.searchParams.get("offset"));
    const all = [
      { id: 1, name: "Data Scientist intern", direction_title: "Data science", experience_type_title: "Без опыта", city_title: "Москва", employment_types: [{ title: "Удаленно" }] },
      { id: 2, name: "ML Engineer", direction_title: "Разработка", experience_type_title: "От 3 лет", city_title: "Москва", employment_types: [] },
      { id: 3, name: "Data Analyst", direction_title: "Аналитика", experience_type_title: "Без опыта", city_title: "", employment_types: [] },
    ];
    const items = offset === 0 ? all.slice(0, 2) : all.slice(2);
    return response(JSON.stringify({ data: { items, range: { count: all.length, limit: 50, offset } } }));
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const jobs = await fetchRwb({});
  const listRequests = requests.filter((url) => url.searchParams.has("offset"));
  const detailRequests = requests.filter((url) => !url.searchParams.has("offset"));
  assert.deepEqual(listRequests.map((url) => Number(url.searchParams.get("offset"))), [0, 2]);
  assert(listRequests.every((url) => url.pathname === "/hr-crm-api/api/v2/pub/vacancies"));
  assert.deepEqual(detailRequests.map((url) => url.pathname.split("/").at(-1)).sort(), ["1", "2"]);
  assert.equal(jobs.length, 3);
  assert.equal(jobs[0].availability, "active");
  assert.equal(jobs[0].targetEmployer, "Wildberries");
  assert.equal(jobs[0].description, "1 description");
  assert.equal(jobs[0].requirements, "1 requirements");
  assert.equal(jobs[0].level, "Без опыта");
  assert.equal(jobs[0].experience_type_title, "Без опыта");
  assert.equal(jobs[1].availability, "closed");
  assert.equal(jobs[1].requirements, "2 requirements");
  assert.equal(jobs[1].location, "Москва · От 3 лет");
  assert.equal(jobs[2].url, "https://career.rwb.ru/vacancies/3");
  assert.equal(jobs.sourceMeta.status, "bounded");
  assert.equal(jobs.sourceMeta.detailsHydrated, 2);
  assert.match(jobs.sourceMeta.reason, /3 уникальных вакансий из 3/);
});

test("RWB rejects malformed first page and preserves records when later pages are incomplete", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response(JSON.stringify({ data: { items: [], range: {} } }));
  await assert.rejects(fetchRwb(), /изменилась схема ответа API/);
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/1")) return response("upstream failure", 503);
    const offset = Number(parsed.searchParams.get("offset"));
    if (!offset) return response(JSON.stringify({ data: { items: [{ id: 1, name: "ML Intern" }], range: { count: 2, limit: 50, offset } } }));
    return response("upstream failure", 503);
  };
  const partial = await fetchRwb();
  assert.equal(partial.length, 1);
  assert.equal(partial[0].id, "1");
  assert.equal(partial.sourceMeta.status, "partial");
  assert.match(partial.sourceMeta.reason, /offset=1 не получена/);
});

test("RWB keeps valid pages and marks total-count drift partial", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    const item = { id: offset + 1, name: `Vacancy ${offset + 1}` };
    return response(JSON.stringify({ data: { items: [item], range: { count: offset ? 3 : 2, limit: 50, offset } } }));
  };
  const result = await fetchRwb();
  assert.equal(result.length, 3);
  assert.equal(result.sourceMeta.status, "partial");
  assert.match(result.sourceMeta.reason, /изменилось во время пагинации \(2 → 3\)/);
});

test("Avito Start keeps the closed training program separate from vacancies", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => String(url).includes("/internships")
    ? htmlResponse('<a href="/datascience-internship">Data Science</a>')
    : htmlResponse("Регистрация закрыта");
  const result = await fetchAvitoStart();
  assert.equal(result.length, 0);
  assert.equal(result.sourceMeta.status, "closed");
  assert.equal(result.sourceMeta.opportunityType, "internship_program");
  assert.match(result.sourceMeta.reason, /Bootcamp.*не включается как вакансия/);
});
