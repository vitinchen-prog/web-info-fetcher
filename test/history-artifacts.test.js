import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectHistoryArtifact} from '../src/lib/history-artifacts.js';
const artifact=(id,created_at,branch='main',expired=false)=>({id,name:'ai-report-delivery-state',created_at,expired,workflow_run:{head_branch:branch}});
test('restores newest history only from current branch',()=>{
 assert.equal(selectHistoryArtifact([artifact(1,'2026-11-02T00:00:00Z'),artifact(2,'2026-11-04T00:00:00Z'),artifact(3,'2026-11-05T00:00:00Z','feature')],'main').id,2);
});
test('expired latest history blocks rather than rolling back state',()=>{
 assert.throws(()=>selectHistoryArtifact([artifact(1,'2026-11-02T00:00:00Z'),artifact(2,'2026-11-04T00:00:00Z','main',true)],'main'),/expired/);
});
test('no history requires an explicit first-run bootstrap',()=>{
 assert.throws(()=>selectHistoryArtifact([],'main'),/initialize_history/);
 assert.equal(selectHistoryArtifact([],'main',{initialize:true}),null);
});

const {assertHistoryCoversAttempts}=await import('../src/lib/history-artifacts.js');
test('send attempts newer than durable history fail closed',()=>{
 const a=artifact(1,'2026-11-04T01:00:00Z');
 assert.throws(()=>assertHistoryCoversAttempts(a,[{steps:[{name:'Send email',status:'completed',conclusion:'success',started_at:'2026-11-05T00:00:00Z',completed_at:'2026-11-05T00:01:00Z'}]}]),/reconciliation/);
});
test('same-run rerun without a fresh state artifact is caught',()=>{
 const a=artifact(1,'2026-11-04T01:00:00Z');
 assert.throws(()=>assertHistoryCoversAttempts(a,[{steps:[{name:'Send email',status:'in_progress',conclusion:null,started_at:'2026-11-04T02:00:00Z'}]}]),/reconciliation/);
});
test('covered successful send and skipped later send may restore',()=>{
 const a=artifact(1,'2026-11-04T01:00:00Z');
 assert.doesNotThrow(()=>assertHistoryCoversAttempts(a,[{steps:[{name:'Send email',status:'completed',conclusion:'success',started_at:'2026-11-04T00:00:00Z',completed_at:'2026-11-04T00:01:00Z'},{name:'Send email',status:'completed',conclusion:'skipped',started_at:'2026-11-05T00:00:00Z'}]}]));
});
test('per-attempt artifact names are supported',()=>{
 const a=artifact(2,'2026-11-04T01:00:00Z'); a.name='ai-report-delivery-state-123-2';
 assert.equal(selectHistoryArtifact([a],'main').id,2);
});

test('missing or incomplete send-step metadata never proves no SMTP attempt',()=>{
 const a=artifact(1,'2026-11-04T01:00:00Z');
 assert.throws(()=>assertHistoryCoversAttempts(a,[{steps:[]}]),/metadata/);
 assert.throws(()=>assertHistoryCoversAttempts(a,[{steps:[{name:'Checkout',status:'completed',conclusion:'success'}]}]),/metadata/);
});
