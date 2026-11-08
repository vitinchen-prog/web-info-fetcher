import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deliverReport } from './lib/delivery.js';
import { getCliArg } from './lib/report-utils.js';

export async function main(args=process.argv.slice(2)) {
  const file=args[0];
  if(!file || file.startsWith('--')) throw Error('Usage: npm run send -- <report-file> [--dry-run] [--history <file>] [--policy <file>]');
  const policy=JSON.parse(await readFile(getCliArg('policy',new URL('../config/report-policy.json',import.meta.url),args),'utf8'));
  const result=await deliverReport({reportPath:path.resolve(file),historyPath:path.resolve(getCliArg('history','data/delivery-history.json',args)),policy,dryRun:args.includes('--dry-run')});
  console.log(result.status==='sent'?`Report accepted by SMTP for ${result.to}; inbox delivery is not confirmed`:`Dry run passed for ${result.events} events; no email sent and no history changed`);
  return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
