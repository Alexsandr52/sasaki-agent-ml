import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('refresh updates excluded existing vacancies without losing applications or notes', async () => {
  const root = mkdtempSync(join(tmpdir(),'sasaki-state-test-'));
  try {
    mkdirSync(join(root,'src/lib'),{recursive:true}); mkdirSync(join(root,'data'));
    for (const f of ['state.mjs','filter.mjs','env.mjs','opportunity.mjs']) copyFileSync(new URL(`../src/lib/${f}`,import.meta.url),join(root,'src/lib',f));
    const prior = [
      { source:'x',id:'1',title:'ML Engineer',status:'active',collectedAt:'yesterday' },
      { source:'program',id:'p',title:'ML Internship',opportunityType:'internship_program',availability:'active',status:'Отклик' },
      { source:'x',id:'2',title:'Junior ML Engineer',status:'Отклик',letter:'my letter',notes:'my notes',collectedAt:'yesterday' },
    ];
    writeFileSync(join(root,'data/jobs.json'),JSON.stringify(prior));
    const { appendJobs } = await import(pathToFileURL(join(root,'src/lib/state.mjs')));
    appendJobs([{source:'x',id:'3',title:'ML Intern',availability:'active'}],{programStates:{program:'closed'},updates:[
      {source:'x',id:'1',availability:'closed',requirements:'Опыт от 3 лет'},
      {source:'x',id:'2',availability:'closed',letter:'external',notes:'external'},
      {source:'x',id:'999',title:'Unrelated excluded vacancy'},
    ]});
    const after = JSON.parse(readFileSync(join(root,'data/jobs.json')));
    assert.equal(after.length,4);
    assert.equal(after.find(v=>v.id==='p').availability,'closed');
    assert.equal(after.find(v=>v.id==='p').status,'Отклик');
    assert.equal(after.find(v=>v.id==='1').availability,'closed');
    assert.equal(after.find(v=>v.id==='1').status,undefined);
    assert.equal(after.find(v=>v.id==='2').status,'Отклик');
    assert.equal(after.find(v=>v.id==='2').letter,'my letter');
    assert.equal(after.find(v=>v.id==='2').notes,'my notes');
    assert.equal(after.find(v=>v.id==='2').collectedAt,'yesterday');
    assert.equal(after.find(v=>v.id==='3').status,undefined);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
