import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const restore=require('../.github/scripts/restore-history.cjs');

test('restore audits a rerun of an older workflow, including prior attempts',async()=>{
 const actions={listArtifactsForRepo:'artifacts',listWorkflowRuns:'runs',listJobsForWorkflowRun:'jobs',listJobsForWorkflowRunAttempt:'attempts',getWorkflowRun:async()=>({data:{id:20,created_at:'2026-11-04T00:00:00Z',updated_at:'2026-11-04T01:00:00Z',run_attempt:1}}),downloadArtifact:async()=>{throw Error('must not download stale history');}};
 const inspected=[];
 const github={rest:{actions},paginate:async(method,args)=>{
  if(method==='artifacts') return [{id:30,name:'ai-report-delivery-state-20-1',created_at:'2026-11-04T01:00:00Z',workflow_run:{id:20,head_branch:'main'}}];
  if(method==='runs') {assert.equal(args.created,undefined,'created filter misses older reruns');return [{id:10,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-05T02:00:00Z',run_attempt:3},{id:20,created_at:'2026-11-04T00:00:00Z',updated_at:'2026-11-04T01:00:00Z',run_attempt:1}];}
  inspected.push([args.run_id,args.attempt_number]);
  if(args.run_id===10 && args.attempt_number===2) return [{steps:[{name:'Send email',status:'completed',conclusion:'success',started_at:'2026-11-05T00:00:00Z',completed_at:'2026-11-05T00:01:00Z'}]}];
  return [{steps:[{name:'Send email',status:'completed',conclusion:'skipped'}]}];
 }};
 await assert.rejects(restore({github,context:{repo:{owner:'test',repo:'test'},ref:'refs/heads/main',runId:99},core:{info(){},warning(){}}}),/reconciliation/);
 assert.ok(inspected.some(([id,attempt])=>id===10 && attempt===2));
});
