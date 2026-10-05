#!/usr/bin/env node
// Прогон по расписанию: собрать → отфильтровать → отсеять виденное → доставить.
// Вся логика — в src/lib/run.mjs (её же использует UI-сервер).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, projectRoot } from "./lib/env.mjs";
import { runPipeline } from "./lib/run.mjs";

loadEnv();
let cfg;
try {
  cfg = JSON.parse(readFileSync(join(projectRoot, "config.json"), "utf8"));
} catch {
  console.error("Нет config.json — сначала запусти мастер настройки: npm run setup");
  process.exit(1);
}

const diagnose = process.argv.includes("--diagnose");
const refreshOnly = process.argv.includes("--refresh-only");
const sourceArg = process.argv.find((arg) => arg.startsWith("--sources="));
if (sourceArg) {
  const { discoverSources } = await import("./lib/registry.mjs");
  const selected = new Set(sourceArg.slice("--sources=".length).split(","));
  const known = (await discoverSources()).map((s) => s.name);
  const unknown = [...selected].filter((name) => !known.includes(name));
  if (unknown.length) throw new Error(`Неизвестные источники: ${unknown.join(", ")}`);
  cfg.sources = Object.fromEntries(known.map((name) => [name, selected.has(name)]));
}
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
if (output && !diagnose) throw new Error("--output доступен только с --diagnose");
const result = await runPipeline(cfg, { diagnose, refreshOnly });
if (output) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
if (diagnose || refreshOnly) {
  console.log("\nDIAGNOSTIC_REPORT");
  console.log(JSON.stringify(result.report, null, 2));
}
