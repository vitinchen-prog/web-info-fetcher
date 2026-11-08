import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectSources, evaluateQuality, buildReportArtifacts, validateReportArtifacts } from '../src/lib/report-pipeline.js';
import { deliverReport } from '../src/lib/delivery.js';
import { getWeekRange } from '../src/lib/report-utils.js';

const now = new Date('2026-11-05T02:00:00Z');
const policy = {quality:{minEvents:1,minDistinctSources:1,minSuccessfulSourceRatio:0.5,maxReportAgeHours:24,maxBrowserAgeHours:72},scoring:{minScore:0,maxEvents:30},analysis:{mode:'evidence-only'}};
const source = {name:'OpenAI News',url:'https://openai.com/news/',category:'official-blog',layer:'extension',index:1,status:'ok'};
const article = {title:'A model launch for developers',url:'https://openai.com/index/model-launch/',date:'2026-11-04',dateEvidence:{kind:'time',value:'2026-11-04'},summary:'The announcement describes new tools for developers.',summaryEvidence:{kind:'paragraph',value:'The announcement describes new tools for developers.'}};
const collected = [{...source,articles:[article]}];
function artifacts() { return buildReportArtifacts({sources:collected,now,issue:'45',policy,history:{version:1,events:[],deliveries:[]}}); }
async function files() { const dir = await mkdtemp(path.join(tmpdir(),'report-test-')); const a = artifacts(); const file = path.join(dir,'report.md'); await writeFile(file,a.report); await writeFile(`${file}.manifest.json`,JSON.stringify(a.manifest)); return {dir,file,...a,historyPath:path.join(dir,'history.json')}; }

test('source failures and empty extraction are visible and block insufficient quality', async () => {
  const results = await collectSources([{...source},{name:'Anthropic News',url:'https://www.anthropic.com/news',category:'official-blog'}],{now,policy,browserCollection:{byName:new Map(),byUrl:new Map()},fetchPage:async(url)=>{if(url.includes('anthropic')) throw new Error('HTTP 403'); return {articles:[],links:[{text:'Navigation',href:url}]};}});
  assert.equal(results[0].status,'no-articles'); assert.equal(results[1].status,'fetch-failed');
  const quality = evaluateQuality(results,[],policy); assert.equal(quality.passed,false); assert.ok(quality.warnings.some(w=>w.includes('403')));
});

test('stale browser cache cannot replace current direct fetch', async () => {
  let fetched = false;
  const cache = {...source,collectedAt:'2026-10-01T00:00:00Z',articles:[article]};
  const results = await collectSources([source],{now,policy,browserCollection:{generatedAt:cache.collectedAt,byName:new Map([[source.name,cache]]),byUrl:new Map()},fetchPage:async()=>{fetched=true;return {articles:[article]};}});
  assert.equal(fetched,true); assert.ok(results[0].warnings.some(w=>w.includes('过期')));
});

test('report has concrete sourced events, exact bytes manifest and no fabricated fact-check', () => {
  const a = artifacts(); assert.equal(a.manifest.quality.passed,true); assert.match(a.report,/model launch/); assert.match(a.report,/openai.com\/index\/model-launch/); assert.match(a.report,/未进行独立事实核查/); assert.doesNotMatch(a.report,/请在最终稿中/);
  assert.doesNotThrow(()=>validateReportArtifacts(a.report,a.manifest,{now,policy}));
  assert.throws(()=>validateReportArtifacts(a.report+'changed',a.manifest,{now,policy}),/hash|哈希/i);
  assert.throws(()=>validateReportArtifacts(a.report,a.manifest,{now:new Date('2026-11-07T00:00:00Z'),policy}),/stale|过期/i);
});

test('dry-run validates but never loads transport or creates sent history', async () => {
  const f = await files(); let called = false;
  const result = await deliverReport({reportPath:f.file,historyPath:f.historyPath,now,policy,dryRun:true,createTransport:()=>{called=true;throw Error('must not send');}});
  assert.equal(result.status,'dry-run'); assert.equal(called,false); await assert.rejects(access(f.historyPath));
});

test('bad quality is blocked before SMTP and before history writes', async () => {
  const f=await files(); let called=false;
  await assert.rejects(deliverReport({reportPath:f.file,historyPath:f.historyPath,now,policy:{...policy,quality:{...policy.quality,minEvents:5}},env:{},createTransport:()=>{called=true;}}),/quality|质量/i);
  assert.equal(called,false); await assert.rejects(access(f.historyPath));
});

const env={SMTP_HOST:'smtp.example.test',SMTP_PORT:'465',SMTP_USER:'sender@example.test',SMTP_PASS:'test-only-not-a-secret',REPORT_TO:'recipient@example.test'};
test('confirmed delivery advances history once and blocks repeated report', async () => {
  const f=await files(); let sent=0;
  const createTransport=()=>({sendMail:async()=>{sent++;return {accepted:[env.REPORT_TO],rejected:[],messageId:'test-id'};}});
  await deliverReport({...f,reportPath:f.file,now,policy,env,createTransport});
  const history=JSON.parse(await readFile(f.historyPath,'utf8')); assert.equal(history.events.length,1); assert.equal(history.deliveries[0].status,'sent');
  await assert.rejects(deliverReport({...f,reportPath:f.file,now,policy,env,createTransport}),/already|已发送/i); assert.equal(sent,1);
});

test('uncertain SMTP outcome persists pending attempt without claiming events delivered', async () => {
  const f=await files(); let sent=0;
  const createTransport=()=>({sendMail:async()=>{sent++;throw Error('connection lost after DATA');}});
  await assert.rejects(deliverReport({...f,reportPath:f.file,now,policy,env,createTransport}),/uncertain|不确定/i);
  const history=JSON.parse(await readFile(f.historyPath,'utf8')); assert.equal(history.events.length,0); assert.equal(history.deliveries[0].status,'pending');
  await assert.rejects(deliverReport({...f,reportPath:f.file,now,policy,env,createTransport}),/pending|待核对/i); assert.equal(sent,1);
});

test('partial recipient acceptance does not commit sent state', async () => {
  const f=await files(); const multi={...env,REPORT_TO:'recipient@example.test,other@example.test'};
  await assert.rejects(deliverReport({...f,reportPath:f.file,now,policy,env:multi,createTransport:()=>({sendMail:async()=>({accepted:['recipient@example.test'],rejected:['other@example.test']})})}),/partial|不确定/i);
  const history=JSON.parse(await readFile(f.historyPath,'utf8')); assert.equal(history.events.length,0); assert.equal(history.deliveries[0].status,'pending');
});

test('Shanghai week boundaries are stable across runtime timezones',()=>{
  const week=getWeekRange(new Date('2026-11-08T17:00:00Z'));
  assert.equal(week.start,'2026-11-09'); assert.equal(week.end,'2026-11-15');
});

test('simulation manifest is never allowed to send a real email',async()=>{
  const f=await files(); f.manifest.simulation=true; await writeFile(`${f.file}.manifest.json`,JSON.stringify(f.manifest)); let called=false;
  await assert.rejects(deliverReport({...f,reportPath:f.file,now,policy,env,createTransport:()=>{called=true;}}),/simulation|模拟/i);
  assert.equal(called,false); await assert.rejects(access(f.historyPath));
});

test('invalid evidence and future article dates cannot bypass a send manifest',()=>{
  const a=artifacts(); a.manifest.events[0].articles[0].date='2030-01-01';
  assert.throws(()=>validateReportArtifacts(a.report,a.manifest,{now,policy}),/evidence|date/i);
});

test('browser evidence is checked for expiry again immediately before sending',()=>{
 const browserSources=[{...source,status:'browser-collected',collectedAt:'2026-11-02T03:00:00Z',articles:[article]}];
 const a=buildReportArtifacts({sources:browserSources,now,policy,history:{version:1,events:[],deliveries:[]}});
 assert.doesNotThrow(()=>validateReportArtifacts(a.report,a.manifest,{now,policy}));
 assert.throws(()=>validateReportArtifacts(a.report,a.manifest,{now:new Date('2026-11-06T01:00:00Z'),policy}),/browser|浏览器/i);
 assert.throws(()=>validateReportArtifacts(a.report,a.manifest,{now,policy:{...policy,quality:{...policy.quality,maxBrowserAgeHours:48}}}),/browser|浏览器/i);
});

test('missing nodemailer stops explicitly without creating history',async()=>{
 const {cp}=await import('node:fs/promises'); const {spawnSync}=await import('node:child_process');
 const f=await files(); await cp(new URL('../src',import.meta.url),path.join(f.dir,'src'),{recursive:true});
 await writeFile(path.join(f.dir,'package.json'),'{"type":"module"}');
 const script=`import {deliverReport} from './src/lib/delivery.js'; try { await deliverReport({reportPath:${JSON.stringify(f.file)},historyPath:${JSON.stringify(f.historyPath)},now:new Date(${JSON.stringify(now.toISOString())}),policy:${JSON.stringify(policy)},env:${JSON.stringify(env)}}); } catch(e) { console.error(e.message);process.exitCode=1; }`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:f.dir,encoding:'utf8'});
 assert.equal(child.status,1); assert.match(child.stderr,/nodemailer.*unavailable/i); await assert.rejects(access(f.historyPath));
});
