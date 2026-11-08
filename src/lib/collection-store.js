import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
export const browserOutputDir = path.resolve('data/browser-collections');
const emptyCollection = (warnings=[]) => ({generatedAt:null,file:null,byName:new Map(),byUrl:new Map(),warnings});

// Stored dates, not MMDD filenames, determine freshness across year boundaries.
export async function loadLatestBrowserCollection({directory=browserOutputDir}={}) {
  let files;
  try { files=await readdir(directory); }
  catch(error) { return emptyCollection(error.code==='ENOENT'?[]:[`浏览器缓存无法读取：${error.message}`]); }
  const warnings=[], collections=[];
  for(const file of files.filter(f=>f.startsWith('browser_collection_') && f.endsWith('.json'))) {
    try {
      const parsed=JSON.parse(await readFile(path.join(directory,file),'utf8'));
      if(!Array.isArray(parsed.results) || !Number.isFinite(Date.parse(parsed.generatedAt))) throw Error('缺少有效采集时间或 results');
      collections.push({parsed,file});
    } catch(error) { warnings.push(`浏览器缓存 ${file} 无法使用：${error.message}`); }
  }
  collections.sort((a,b)=>Date.parse(b.parsed.generatedAt)-Date.parse(a.parsed.generatedAt));
  if(!collections.length) return emptyCollection(warnings);
  const {parsed,file}=collections[0], byName=new Map(),byUrl=new Map();
  for(const result of parsed.results) {
    if(!result || typeof result!=='object') continue;
    if(result.name) byName.set(result.name,result);
    if(result.url) byUrl.set(result.url,result);
  }
  return {generatedAt:parsed.generatedAt,file,byName,byUrl,warnings};
}
