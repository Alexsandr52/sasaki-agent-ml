import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runPipeline } from '../src/lib/run.mjs';
import { discoverSources } from '../src/lib/registry.mjs';

function snapshot() {
  const dir = new URL('../data/', import.meta.url);
  let files;
  try { files = readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  return Object.fromEntries(files.filter((f) => f.endsWith('.json')).sort().map((f) => [f,createHash('sha256').update(readFileSync(new URL(f,dir))).digest('hex')]));
}
test('diagnostic run returns report without modifying workspace data', async () => {
  const before = snapshot();
  const cfg = {sources:Object.fromEntries((await discoverSources()).map((s)=>[s.name,false]))};
  const result = await runPipeline(cfg,{diagnose:true,onLog:()=>{}});
  assert.equal(result.report.totals.raw,0);
  assert.deepEqual(result.matched,[]);
  assert.deepEqual(snapshot(),before);
});
