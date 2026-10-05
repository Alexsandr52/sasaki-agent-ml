import test from "node:test";
import assert from "node:assert/strict";
import { fetchYandexStart } from "../examples/sources/yandex_start.mjs";
import { fetchYandex } from "../src/sources/yandex.mjs";
import { fetchVkInternship } from "../examples/sources/vk_internship.mjs";
import { fetchVk } from "../src/sources/vk.mjs";

test("Yandex ML internship is emitted only when the official page confirms open intake", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(`
    <html><head><title>Машинное обучение ― стажировка в Яндексе</title>
    <meta name="description" content="Улучшайте алгоритмы машинного обучения"></head>
    <body>Стажировка проходит круглый год, поэтому вы&nbsp;можете подать заявку в&nbsp;любое время.</body></html>
  `, { status: 200 });

  const items = await fetchYandexStart();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "yandex-ml-internship");
  assert.equal(items[0].opportunityType, "internship_program");
  assert.equal(items[0].availability, "active");
  assert.equal(items[0].level, "intern");
  assert.equal(items[0].experienceMin, undefined);
  assert.equal(items[0].status, undefined);

  globalThis.fetch = async () => new Response(`<html><head><title>Машинное обучение ― стажировка в Яндексе</title></head></html>`, { status: 200 });
  const unknown = await fetchYandexStart();
  assert.equal(unknown.length, 0);
  assert.equal(unknown.sourceMeta.status, "unknown");
});

test("Yandex public profession API hydrates bounded vacancy details", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://yandex.ru/jobs/api/publications?") && url.includes("professions=ml-developer")) {
      return new Response(JSON.stringify({
        count: 1,
        next: null,
        results: [{
          id: 990001234,
          title: "ML-разработчик",
          publication_slug_url: "ml-razrabotchik-990001234",
          status: "published",
          short_summary: "Развивать модели",
          vacancy: { cities: [{ name: "Москва" }], work_modes: [{ name: "Гибридный" }] },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/990001234")) {
      return new Response(JSON.stringify({
        status: "published",
        published_at: "2026-10-01",
        vacancy: { pro_level_min_display: "publications.pro_level.middle", pro_level_max_display: "publications.pro_level.senior" },
        description: "Развивать ML-модели.",
        key_qualifications: "Опыт машинного обучения от двух лет",
        additional_requirements: "Python",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const jobs = await fetchYandex({ yandex: { professions: ["ml-developer"] } }, { dryRun: true });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].level, "middle");
  assert.equal(jobs[0].levelMax, "senior");
  assert.match(jobs[0].requirements, /двух лет/);
  assert.equal(jobs[0].availability, "active");
  assert.equal(jobs[0].published, "2026-10-01");
  assert.equal(jobs.sourceMeta.detailsHydrated, 1);
  assert.ok(urls[0].includes("professions=ml-developer"));
});

test("Yandex keeps a listing when one detail request fails and does not exceed the detail budget for dates", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/publications?")) {
      return new Response(JSON.stringify({
        count: 1,
        next: null,
        results: [{ id: 990001235, title: "ML-разработчик", publication_slug_url: "ml-990001235", status: "published", short_summary: "ML model" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("unavailable", { status: 503 });
  };
  const jobs = await fetchYandex({ yandex: { professions: ["ml-developer"] } }, { dryRun: true });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "ML-разработчик");
  assert.equal(jobs[0].requirements, "");
  assert.equal(jobs.sourceMeta.status, "partial");
  assert.equal(jobs.sourceMeta.detailsFailed, 1);
  assert.equal(urls.filter((url) => url.endsWith("/990001235")).length, 1);
});

test("VK adapter hydrates SSR listings with requirements and level from vacancy HTML", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith("https://team.vk.company/vacancy/?")) {
      return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { initialVacancies: [{ id: 54687, title: "ML-инженер", group: { name: "AI VK" }, town: { name: "Москва" }, work_format: "Комбинированный", is_opened: true }], initialTotalCount: 1 } },
      })}</script>`, { status: 200 });
    }
    return new Response(`
      <meta name="description" content="Трудоустройство по вакансии ML-инженер уровня senior" />
      <meta itemprop="addressLocality" content="Москва" />
      <div itemprop="description">Короткое описание.<h3>Задачи</h3><ul><li>Модели</li></ul>
      <h3>Требования</h3><ul><li>Опыт в ML от двух лет</li><li>Python</li></ul></div>
      <div class="page-control"></div>
    `, { status: 200 });
  };

  const items = await fetchVk({ vk: { specialties: [283] } });
  assert.equal(items.length, 1);
  assert.match(items[0].requirements, /Опыт в ML от двух лет/);
  assert.equal(items[0].level, "senior");
  assert.equal(items[0].availability, "active");
  assert.equal(items[0].status, undefined);
  assert.ok(requested.includes("https://team.vk.company/vacancy/54687/"));
});

test("VK internship adapter keeps source availability separate from application tracker status", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    const url = String(input);
    const catalog = url.endsWith("/internship") ? "internship" : "junior";
    return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { page: { vacancies: catalog === "internship" ? [{ id: 41, title: "ML intern", internship_type: "internship", is_opened: true }] : [] } } },
    })}</script>`, { status: 200 });
  };
  const jobs = await fetchVkInternship();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].availability, "active");
  assert.equal(jobs[0].status, undefined);
});

test("VK keeps a listed vacancy when its detail page is temporarily unavailable", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://team.vk.company/vacancy/?")) {
      return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { initialVacancies: [{ id: 54687, title: "ML-инженер" }], initialTotalCount: 1 } },
      })}</script>`, { status: 200 });
    }
    return new Response("temporarily unavailable", { status: 503 });
  };
  const jobs = await fetchVk({ vk: { specialties: [283] } });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "54687");
  assert.equal(jobs[0].requirements, "");
  assert.equal(jobs.sourceMeta.status, "partial");
  assert.equal(jobs.sourceMeta.detailsFailed, 1);
});
