import test from "node:test";
import assert from "node:assert/strict";
import { fetchHHTargets, ROLE_QUERIES } from "../src/sources/hh_targets.mjs";

const feed = (id, company) => `<rss><channel><item><title>ML стажер</title><link>https://hh.ru/vacancy/${id}</link><description><![CDATA[<p>Вакансия компании: ${company}</p><p>Регион: Москва</p>]]></description><pubDate>Sat, 04 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;

test("HH target search splits ML roles, deduplicates, and requires exact employer aliases", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    const params = new URL(url).searchParams;
    requested.push(params.get("text"));
    return new Response(feed("12345", "Альфа-Банк"), { status: 200 });
  };
  try {
    const items = await fetchHHTargets({ hh: {
      targetsPauseMs: 0,
      targetDetailsLimit: 0,
      employers: [
        { name: "Альфа-Банк", aliases: ["Альфа-Банк"] },
        { name: "Альфа-Банк Технологии", aliases: ["Альфа-Банк Технологии"] },
      ],
    } });
    assert.equal(ROLE_QUERIES.length, 7);
    assert.ok(ROLE_QUERIES.some(([, query]) => query === "NAME:ML"));
    assert.equal(requested.length, 14);
    assert.equal(items.length, 1);
    assert.equal(items[0].company, "Альфа-Банк");
    assert.deepEqual(items[0].roleQueries, ["ml", "machine_learning", "data_scientist", "data_science", "computer_vision", "nlp", "llm"]);
    assert.equal(items.sourceMeta.employers[0].duplicates, 6);
    assert.equal(items.sourceMeta.employers[1].unique, 0);
    assert.equal(items.sourceMeta.employers[1].companyMismatches, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HH target search records per-query errors and continues", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(feed("54321", "Т-Банк"), { status: 200 });
  };
  try {
    const items = await fetchHHTargets({ hh: {
      targetsPauseMs: 0,
      targetDetailsLimit: 0,
      employers: [{ name: "Т-Банк", aliases: ["Т-Банк", "Тинькофф"] }],
    } });
    assert.equal(calls, 7);
    assert.equal(items.length, 1);
    assert.equal(items.sourceMeta.status, "partial");
    assert.equal(items.sourceMeta.employers[0].failedQueries[0].query, "ml");
    assert.equal(items.sourceMeta.successfulRequests, 6);
    assert.equal(items.sourceMeta.failedRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HH target enrichment reads bounded JobPosting JSON-LD and experience category", async () => {
  const originalFetch = globalThis.fetch;
  const feedCalls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/vacancy/98765") {
      return new Response(`<html><head><meta name="description" content="Требуемый опыт: 3–6 лет."></head><script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org", "@type": "JobPosting", title: "ML Engineer", description: "Требования: опыт ML; Python.", experienceRequirements: "Опыт разработки ML-моделей",
      })}</script></html>`, { status: 200 });
    }
    feedCalls.push(parsed.searchParams.get("text"));
    return new Response(feed("98765", "Т-Банк"), { status: 200 });
  };
  try {
    const items = await fetchHHTargets({ hh: {
      targetsPauseMs: 0,
      targetDetailsLimit: 1,
      employers: [{ name: "Т-Банк", aliases: ["Т-Банк"] }],
    } });
    assert.equal(items.length, 1);
    assert.equal(items[0].targetEmployer, "Т-Банк");
    assert.equal(items[0].description, "Требования: опыт ML; Python.");
    assert.equal(items[0].requirements, "Опыт разработки ML-моделей");
    assert.equal(items[0].experienceCategory, "3–6 лет");
    assert.equal(items[0].experienceCategoryMin, 3);
    assert.equal(items.sourceMeta.detailEnrichment.attempted, 1);
    assert.equal(items.sourceMeta.detailEnrichment.enriched, 1);
    assert.equal(feedCalls.length, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HH target detail cap rotates across employers before deepening one employer", async () => {
  const originalFetch = globalThis.fetch;
  const detailIds = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    const detail = parsed.pathname.match(/^\/vacancy\/(\d+)$/);
    if (detail) {
      detailIds.push(detail[1]);
      return new Response(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", description: "requirements" })}</script>`, { status: 200 });
    }
    const isAlfa = /Альфа/.test(parsed.searchParams.get("text"));
    return new Response(feed(isAlfa ? "11111" : "22222", isAlfa ? "Альфа-Банк" : "Т-Банк"), { status: 200 });
  };
  try {
    const items = await fetchHHTargets({ hh: {
      targetsPauseMs: 0,
      targetDetailsLimit: 2,
      employers: [
        { name: "Альфа-Банк", aliases: ["Альфа-Банк"] },
        { name: "Т-Банк", aliases: ["Т-Банк"] },
      ],
    } });
    assert.deepEqual(detailIds, ["11111", "22222"]);
    assert.equal(items.sourceMeta.detailEnrichment.candidateCount, 2);
    assert.equal(items.sourceMeta.detailEnrichment.skipped, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
