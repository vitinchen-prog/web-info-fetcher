import { createHash } from 'node:crypto';
import { articlesFromLinks } from './extract-articles.js';
import { fetchPageInfo } from './fetch-page-info.js';
import { getArticleRules } from './source-rules.js';
import { getWeekRange, isWithinWeek, shanghaiDate } from './report-utils.js';
import { buildEvents } from './events.js';
import { analyzeEvents } from './analysis.js';

const DEFAULT_QUALITY = {minEvents:3,minDistinctSources:2,minSuccessfulSourceRatio:0.5,maxReportAgeHours:24,maxBrowserAgeHours:72};
export function qualityPolicy(policy = {}) {
  const quality = {...DEFAULT_QUALITY,...policy.quality};
  for (const [key,value] of Object.entries(quality)) {
    if (!Number.isFinite(value) || value < 0) throw Error(`Invalid quality policy: ${key}`);
  }
  if (quality.minEvents < 1 || quality.minDistinctSources < 1 || quality.minSuccessfulSourceRatio > 1 || quality.maxReportAgeHours <= 0 || quality.maxBrowserAgeHours <= 0) throw Error('Invalid quality policy thresholds');
  return quality;
}

export async function collectSources(sources,{now = new Date(),policy = {},browserCollection = {},fetchPage = fetchPageInfo} = {}) {
  const quality = qualityPolicy(policy);
  const results = [];
  for (let i=0;i<sources.length;i++) {
    const source = sources[i], rules = getArticleRules(source), warnings = [...(browserCollection.warnings || [])];
    const base = {...source,index:i+1,articles:[],links:[],warnings};
    const cached = browserCollection.byUrl?.get(source.url) || browserCollection.byName?.get(source.name);
    const cacheTime = new Date(cached?.collectedAt || browserCollection.generatedAt || 'invalid').getTime();
    const age = now.getTime()-cacheTime;
    const fresh = Number.isFinite(age) && age>=-300000 && age<=quality.maxBrowserAgeHours*3600000;
    if (cached && !fresh) warnings.push('浏览器采集过期或时间不明，未采用');
    if (cached?.status === 'ok' && fresh && rules) {
      const articles = articlesFromLinks(cached.articles?.length ? cached.articles : cached.links || [], rules, {baseUrl:source.url});
      results.push({...base,status:articles.length?'browser-collected':'no-articles',articles,collectedAt:new Date(cacheTime).toISOString()});
      continue;
    }
    if (!rules) {
      results.push({...base,status:source.category==='x'?'manual-review-required':'unsupported',error:source.category==='x'?'未采集可核验的 X 帖文；需要授权 API 或人工浏览器采集流程':'产品首页不作为新闻事件，尚无文章采集规则'});
      continue;
    }
    try {
      const info = await fetchPage(source.url,{articleRules:rules});
      results.push({...base,status:info.articles?.length?'ok':'no-articles',articles:info.articles || [],collectedAt:now.toISOString()});
    } catch (error) {
      results.push({...base,status:'fetch-failed',error:error.message});
    }
  }
  return results;
}

export function evaluateQuality(sources,events,policy = {}) {
  const q = qualityPolicy(policy), errors = [], warnings = [];
  const supported = sources.filter(s=>getArticleRules(s));
  const healthy = supported.filter(s=>['ok','browser-collected'].includes(s.status) && s.articles?.length);
  const distinctSources = new Set(events.flatMap(e=>(e.articles || []).map(a=>a.source?.name))).size;
  const ratio = supported.length ? healthy.length/supported.length : 0;
  if(events.length < q.minEvents) errors.push(`当前可发送事件 ${events.length}，低于门槛 ${q.minEvents}`);
  if(distinctSources < q.minDistinctSources) errors.push(`事件信源 ${distinctSources}，低于门槛 ${q.minDistinctSources}`);
  if(ratio < q.minSuccessfulSourceRatio) errors.push(`文章信源采集成功率 ${Math.round(ratio*100)}%，低于门槛 ${Math.round(q.minSuccessfulSourceRatio*100)}%`);
  for (const source of sources) {
    if(!['ok','browser-collected'].includes(source.status)) warnings.push(`${source.name}: ${statusLabel(source.status)}${source.error?`（${source.error}）`:''}`);
    for(const warning of source.warnings || []) warnings.push(`${source.name}: ${warning}`);
  }
  return {passed:errors.length===0,errors,warnings:[...new Set(warnings)],metrics:{events:events.length,distinctSources,supportedSources:supported.length,healthySources:healthy.length,successfulSourceRatio:ratio}};
}

export function reportHash(report) { return createHash('sha256').update(report,'utf8').digest('hex'); }
function plain(value) { return String(value ?? '').replace(/[\r\n|]/g,' ').replace(/[<>]/g,'').trim(); }
function statusLabel(status) { return ({ok:'已采集文章','browser-collected':'浏览器已采集文章','no-articles':'页面可达但未提取到文章','fetch-failed':'抓取失败','manual-review-required':'需登录或 API，未覆盖',unsupported:'仅首页，未提供事件证据'})[status] || status; }
function renderEvent(event) {
  const sources = event.articles.map(a=>`${plain(a.source.name)}：${a.url}`).join('\n');
  const observations = (event.analysis?.observations || []).map(o=>`- ${plain(o.text)}\n  ${o.sourceUrls.join(' ')}`).join('\n');
  return `### ${plain(event.title)}\n\n日期：${event.date}；评分：${event.score}；主题：${(event.topics||[]).map(plain).join('、') || '未分类'}\n\n**来源陈述（未经独立核验）**\n\n${observations || '- 无可支持的正文摘要，仅有标题证据。'}\n\n**条件性解读**：${plain(event.analysis?.implication || '证据有限，暂不推导行业结论。')}\n\n解读依据：${(event.analysis?.implicationEvidence?.terms || []).map(plain).join('、') || '无明确触发证据'}；${(event.analysis?.implicationEvidence?.sourceUrls || []).join(' ')}\n\n**证据限制**：${(event.analysis?.limitations || ['仅采集列表页证据，未进行独立事实核查。']).map(plain).join('；')}\n\n评分依据：${(event.scoreReasons || []).map(plain).join('；')}\n\n原始报道：\n${sources}\n`;
}
export function buildReportArtifacts({sources,now = new Date(),issue='1',policy={},history,extraWarnings=[]}) {
  const week = getWeekRange(now);
  const result = buildEvents(sources,{now,week,policy,history});
  const analysis = analyzeEvents(result.events,{policy});
  const events = analysis.events;
  const quality = evaluateQuality(sources,events,policy);
  quality.warnings.push(...extraWarnings,...analysis.warnings);
  const byLayer = [['extension','一、外延层'],['platform','二、平台层'],['product','三、产品层'],['cross-layer','四、跨层事件']].map(([layer,label])=>`## ${label}\n\n${events.filter(e=>e.layer===layer).map(renderEvent).join('\n') || '本期没有满足日期、证据与去重条件的新事件；不据此判断该领域没有进展。'}`).join('\n\n');
  const sourceTable = sources.map(s=>`| ${plain(s.name)} | ${plain(statusLabel(s.status))} | ${(s.articles||[]).length} | ${plain(s.error || (s.warnings||[]).join('；'))} |`).join('\n');
  const report = `# 本周 AI 资讯周报 Issue ${plain(issue)}\n\n生成时间：${now.toISOString()}\n覆盖周期（Asia/Shanghai）：${week.label}\n\n## 执行摘要\n\n本期选出 ${events.length} 个新事件，来自 ${quality.metrics.distinctSources} 个信源；合并重复或排除不合条件候选 ${result.suppressedCount} 条。分析模式：${analysis.mode}。本报告只使用采集到的标题和摘要证据，未进行独立事实核查，不把多家转述视为独立验证。\n\n发送质量门槛：**${quality.passed?'通过':'未通过，禁止自动发送'}**\n${quality.errors.map(e=>`- ${plain(e)}`).join('\n')}\n\n${byLayer}\n\n## 采集状态与异常\n\n| 信源 | 状态 | 文章数 | 说明 |\n| --- | --- | ---: | --- |\n${sourceTable}\n\n${quality.warnings.map(w=>`- ${plain(w)}`).join('\n') || '- 无额外采集异常。'}\n\n## 方法与边界\n\n- 日期必须有原始证据；无日期、未来日期、非本周或已发送内容不充当本期新闻。\n- 去重为 URL/标题规则推断，跨语言改写可能遗漏；所有合并来源保留。\n- 评分是可配置关注度排序，不是事实可信度评分。\n- 模型/API 未接入，当前无付费调用。解读是基于有限证据的条件判断，不能替代阅读原文。\n`;
  return {report,manifest:{version:1,generatedAt:now.toISOString(),issue:String(issue),period:{start:week.start,end:week.end},reportHash:reportHash(report),quality,analysisMode:analysis.mode,sources,events,suppressedCount:result.suppressedCount}};
}

export function validateReportArtifacts(report,manifest,{now = new Date(),policy={}}={}) {
  if(manifest?.version!==1 || !Array.isArray(manifest.sources) || !Array.isArray(manifest.events)) throw Error('Invalid report manifest');
  if(manifest.reportHash!==reportHash(report)) throw Error('Report hash mismatch: 文件已改变，必须重新生成');
  const q=qualityPolicy(policy), generated = new Date(manifest.generatedAt), age=now-generated;
  if(!Number.isFinite(age) || age < -300000 || age>q.maxReportAgeHours*3600000) throw Error('Report stale/过期 or invalid generation time');
  const week = getWeekRange(generated), today=shanghaiDate(now);
  if(manifest.period?.start!==week.start || manifest.period?.end!==week.end) throw Error('Invalid report period');
  for(const source of manifest.sources.filter(source=>source.status==='browser-collected')) {
    const cacheAge=now-new Date(source.collectedAt || 'invalid');
    if(!Number.isFinite(cacheAge) || cacheAge < -300000 || cacheAge>q.maxBrowserAgeHours*3600000) throw Error('Browser/浏览器 evidence expired or invalid; regenerate report');
  }
  if(new Set(manifest.events.map(e=>e.id)).size!==manifest.events.length) throw Error('Duplicate event ids in manifest');
  for(const event of manifest.events) {
    if(!event.id || !event.title || !isWithinWeek(event.date,week) || event.date>today || !event.articles?.length) throw Error('Invalid event evidence or date');
    for(const article of event.articles) {
      if(!article.title || !['time','url','text'].includes(article.dateEvidence?.kind) || !article.dateEvidence?.value || !isWithinWeek(article.date,week) || article.date>today || !article.source?.name || !/^https?:\/\//.test(article.url)) throw Error('Missing article evidence');
    }
  }
  const quality=evaluateQuality(manifest.sources,manifest.events,policy);
  if(!quality.passed) throw Error(`Report quality/质量 gate failed: ${quality.errors.join('; ')}`);
  return quality;
}
