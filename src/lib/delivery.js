import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateReportArtifacts } from './report-pipeline.js';
import { buildEvents } from './events.js';
import { getWeekRange } from './report-utils.js';
import { loadHistory, saveHistory, recordDelivery } from './history-store.js';

async function defaultTransport(options) {
  const {default:nodemailer}=await import('nodemailer');
  return nodemailer.createTransport(options);
}
function checkHistory(history,manifest,policy) {
  if(history.deliveries.some(d=>d.status==='pending')) throw Error('Delivery pending/待核对：上次 SMTP 结果不确定，请先人工核对，禁止自动重发');
  if(history.deliveries.some(d=>d.reportHash===manifest.reportHash)) throw Error('Report already/已发送');
  const candidates = buildEvents(manifest.sources,{now:new Date(manifest.generatedAt),week:getWeekRange(new Date(manifest.generatedAt)),policy,history});
  const ids=new Set(candidates.events.map(e=>e.id));
  if(manifest.events.some(e=>!ids.has(e.id))) throw Error('Event already/已发送 or no longer eligible; regenerate report');
}
export async function deliverReport({reportPath,historyPath=path.resolve('data/delivery-history.json'),now=new Date(),policy={},dryRun=false,env=process.env,createTransport=defaultTransport}) {
  const report=await readFile(reportPath,'utf8');
  let manifest;
  try { manifest=JSON.parse(await readFile(`${reportPath}.manifest.json`,'utf8')); }
  catch { throw Error('Missing or invalid report manifest; regenerate report before sending'); }
  validateReportArtifacts(report,manifest,{now,policy});
  if(manifest.simulation && !dryRun) throw Error('Simulation/模拟报告禁止实际发送');
  // Dry runs require neither SMTP credentials nor nodemailer, and create no state.
  if(dryRun) {
    checkHistory(await loadHistory(historyPath),manifest,policy);
    return {status:'dry-run',events:manifest.events.length,reportHash:manifest.reportHash};
  }
  const missing=['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS'].filter(key=>!env[key]);
  if(missing.length) throw Error(`Missing email environment variables: ${missing.join(', ')}`);
  if(!Number.isInteger(Number(env.SMTP_PORT)) || Number(env.SMTP_PORT)<=0 || Number(env.SMTP_PORT)>65535) throw Error('Invalid SMTP_PORT');
  // Parse using the same library as SMTP, before committing a pending attempt.
  let addressParser;
  try { ({default:addressParser}=await import('nodemailer/lib/addressparser/index.js')); }
  catch { throw Error('Email dependency nodemailer unavailable; no email sent or history changed. Run npm ci.'); }
  const to=env.REPORT_TO || 'vitinchen@gmail.com';
  const expected=addressParser(to,{flatten:true}).map(a=>a.address.toLowerCase());
  if(!expected.length || expected.some(a=>!a.includes('@'))) throw Error('Invalid REPORT_TO');
  const transport=await createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT),secure:env.SMTP_SECURE==='true',auth:{user:env.SMTP_USER,pass:env.SMTP_PASS}});
  await mkdir(path.dirname(historyPath),{recursive:true});
  const lockPath=`${historyPath}.lock`;
  let lock;
  try { lock=await open(lockPath,'wx',0o600); }
  catch(error) { if(error.code==='EEXIST') throw Error('Delivery lock exists: another run or interrupted attempt requires review'); throw error; }
  try {
    const history=await loadHistory(historyPath);
    checkHistory(history,manifest,policy);
    const pending={...history,deliveries:[...history.deliveries,{reportHash:manifest.reportHash,status:'pending',sentAt:null,attemptedAt:now.toISOString(),eventIds:manifest.events.map(e=>e.id)}]};
    await saveHistory(historyPath,pending);
    let info;
    try {
      info=await transport.sendMail({from:env.REPORT_FROM || env.SMTP_USER,to,subject:env.REPORT_SUBJECT || '本周 AI 资讯周报',text:report,attachments:[{filename:path.basename(reportPath),content:report}]});
      const accepted=new Set((info.accepted || []).map(a=>String(a.address || a).toLowerCase()));
      if(info.rejected?.length || expected.some(a=>!accepted.has(a))) throw Error('partial recipient acceptance');
    } catch(error) {
      throw Error(`SMTP outcome uncertain/不确定 (${error.message}); pending history retained, manual reconciliation required`);
    }
    const confirmed=recordDelivery(pending,manifest.events,{reportHash:manifest.reportHash,sentAt:now.toISOString(),messageId:info.messageId || ''});
    try { await saveHistory(historyPath,confirmed); }
    catch { throw Error('SMTP accepted but history save failed; pending attempt retained, do not retry before reconciliation'); }
    return {status:'sent',events:manifest.events.length,messageId:info.messageId || '',to};
  } finally {
    await lock.close(); await unlink(lockPath);
    transport?.close?.();
  }
}
