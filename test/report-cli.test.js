import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('offline CLI creates bound simulation artifacts, with no delivered state or SMTP',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'report-cli-')), history=path.join(dir,'history.json');
 const child=spawnSync(process.execPath,['src/generate-report.js','--fixture','test/fixtures/report-sources.json','--now','2026-11-08T08:00:00Z','--issue','fixture','--history',history,'--output-dir',dir],{encoding:'utf8',env:{...process.env,SMTP_PASS:''}});
 assert.equal(child.status,0,child.stderr); const latest=JSON.parse(await readFile(path.join(dir,'latest-report.json'),'utf8'));
 assert.equal(latest.quality.passed,true); const manifest=JSON.parse(await readFile(latest.manifest,'utf8')); assert.equal(manifest.simulation,true); assert.equal(manifest.events.length,3);
 await assert.rejects(access(history));
 const send=spawnSync(process.execPath,['src/send-email.js',latest.file,'--history',history],{encoding:'utf8',env:{...process.env,SMTP_PASS:''}});
 assert.equal(send.status,1); assert.match(send.stderr,/simulation|模拟|过期/i); await assert.rejects(access(history));
});

test('issue is rejected before it can affect output paths',()=>{
 const child=spawnSync(process.execPath,['src/generate-report.js','--issue','../../unsafe'],{encoding:'utf8'});
 assert.equal(child.status,1); assert.match(child.stderr,/Invalid issue/);
});
