import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./env.mjs";

const healthPath = join(projectRoot, "data", "source-health.json");

export function saveSourceHealth(report) {
  mkdirSync(join(projectRoot, "data"), { recursive: true });
  const temporary = `${healthPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, healthPath);
}

export function loadSourceHealth() {
  try {
    return JSON.parse(readFileSync(healthPath, "utf8"));
  } catch {
    return null;
  }
}
