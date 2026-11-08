import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLatestBrowserCollection } from './lib/collection-store.js';
import { collectSources, buildReportArtifacts } from './lib/report-pipeline.js';
import { formatDateForFilename, getCliArg } from './lib/report-utils.js';
import { loadHistory } from './lib/history-store.js';

export async function main(args=process.argv.slice(2)) {
  const fixture=getCliArg('fixture',null,args);
  const dateArg=getCliArg('now',null,args);
  if(dateArg && !fixture) throw Error('--now is only allowed with --fixture (offline regression)');
  const now=dateArg?new Date(dateArg):new Date();
  if(!Number.isFinite(now.getTime())) throw Error('Invalid --now');
  const issue=getCliArg('issue','1',args);
  if(!/^[a-zA-Z0-9_-]{1,40}$/.test(issue)) throw Error('Invalid issue identifier');
  const policy=JSON.parse(await readFile(getCliArg('policy',new URL('../config/report-policy.json',import.meta.url),args),'utf8'));
  const historyPath=path.resolve(getCliArg('history','data/delivery-history.json',args));
  const history=await loadHistory(historyPath);
  const outputDir=path.resolve(getCliArg('output-dir','reports',args));
  const outputFile=path.join(outputDir,`weekly_ai_report_issue_${issue}_mon_${formatDateForFilename(now)}.md`);
  let sources;
  if(fixture) {
    sources=JSON.parse(await readFile(fixture,'utf8')).sources;
    if(!Array.isArray(sources)) throw Error('Fixture must contain sources array');
  } else {
    const config=JSON.parse(await readFile(new URL('../config/sources.json',import.meta.url),'utf8'));
    sources=await collectSources(config.requiredSources,{now,policy,browserCollection:await loadLatestBrowserCollection()});
  }
  const {report,manifest}=buildReportArtifacts({sources,now,issue,policy,history,extraWarnings:fixture?['离线固定样本，仅用于测试；不代表当前资讯。']:[]});
  manifest.simulation=Boolean(fixture);
  await mkdir(outputDir,{recursive:true});
  await writeFile(outputFile,report,'utf8');
  await writeFile(`${outputFile}.manifest.json`,JSON.stringify(manifest,null,2)+'\n','utf8');
  const result={file:outputFile,manifest:`${outputFile}.manifest.json`,quality:manifest.quality,simulation:manifest.simulation};
  await writeFile(path.join(outputDir,'latest-report.json'),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(`Report written to ${outputFile}`);
  console.log(`Quality gate: ${manifest.quality.passed?'PASS':'BLOCKED'}`);
  for(const warning of manifest.quality.warnings) console.warn(`Warning: ${warning}`);
  if(!manifest.quality.passed) for(const error of manifest.quality.errors) console.error(`Quality: ${error}`);
  return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
