import test from "node:test";
import assert from "node:assert/strict";
import { assessItem, matchesItem, structuralOk } from "../src/lib/filter.mjs";

const cfg = {
  directions: ["ML/AI Engineer", "Computer Vision Engineer", "NLP/LLM Engineer"],
  keywords: [],
  stopwords: [],
  grades: ["intern", "junior"],
  formats: [],
};

test("ODS Computer Vision Researcher in entry grades remains visible for review", () => {
  const item = { title: "Computer Vision Researcher (Intern/Junior/Junior+)", source: "ods" };
  assert.equal(matchesItem(item, cfg), true);
  assert.equal(assessItem(item, cfg).decision, "review");
});

test("explicit two years excludes a junior role even when the title says junior", () => {
  const item = { title: "Junior ML Engineer", requirements: "Опыт работы в ML от 2 лет" };
  assert.equal(matchesItem(item, cfg), false);
  assert.equal(assessItem(item, cfg).decision, "excluded");
});

test("senior role without a years count is excluded", () => {
  const item = { title: "Senior Machine Learning Engineer" };
  assert.equal(matchesItem(item, cfg), false);
});

test("AI marketing title does not become an ML role", () => {
  const item = { title: "Marketing Manager AI/ML" };
  assert.equal(matchesItem(item, cfg), false);
});

test("part-time internship stays eligible", () => {
  const item = { title: "ML Engineer Intern, part-time" };
  assert.equal(matchesItem(item, cfg), true);
});

test("closed internship does not remain a live candidate", () => {
  const item = { title: "ML Engineer Intern", status: "closed" };
  assert.equal(matchesItem(item, cfg), false);
});

test("employer level metadata overrides a junior word in the title", () => {
  const item = { title: "Младший Data Science специалист", level: "Middle" };
  assert.equal(matchesItem(item, cfg), false);
  assert.equal(assessItem(item, cfg).decision, "excluded");
});

test("conflicting explicit description grade is surfaced for review", () => {
  const item = { title: "Junior ML Engineer", requirements: "Уровень позиции: Middle" };
  assert.equal(matchesItem(item, cfg), true);
  assert.equal(assessItem(item, cfg).decision, "review");
});

test("closed prefiltered records fail structural checks", () => {
  const item = { title: "Junior ML Engineer", status: "closed", prefiltered: true };
  assert.equal(structuralOk(item, cfg), false);
});

test("unknown experience on a neutral ML title is retained for review", () => {
  const item = { title: "ML Engineer" };
  assert.equal(matchesItem(item, cfg), true);
  assert.equal(assessItem(item, cfg).decision, "review");
});
