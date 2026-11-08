export function selectHistoryArtifact(artifacts,branch,{initialize=false}={}) {
  const relevant=artifacts.filter(a=>(/^ai-report-delivery-state(?:-\d+-\d+)?$/.test(a.name)) && a.workflow_run?.head_branch===branch).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  if(!relevant.length) {
    if(initialize) return null;
    throw Error('No delivery history found. First rollout: run workflow_dispatch with initialize_history=true and send=false. Missing existing state must be recovered before sending.');
  }
  if(relevant[0].expired) throw Error('Latest delivery history expired; restore an archived copy before sending. Refusing to roll back.');
  return relevant[0];
}


// A runner may die or fail to upload state after SMTP. Never restore older
// history when a later send attempt has no durable checkpoint covering it.
export function assertHistoryCoversAttempts(artifact,jobs) {
  if(!Array.isArray(jobs) || !jobs.length || jobs.some(job=>!Array.isArray(job.steps)) || !jobs.some(job=>job.steps.some(step=>step.name==='Send email'))) {
    throw Error('Send-step metadata unavailable; cannot establish whether SMTP was attempted');
  }
  const checkpoint=Date.parse(artifact.created_at);
  if(!Number.isFinite(checkpoint)) throw Error('Invalid history artifact timestamp');
  for(const job of jobs) {
    for(const step of job.steps || []) {
      if(step.name!=='Send email' || step.conclusion==='skipped' || step.status==='queued') continue;
      const start=Date.parse(step.started_at), end=step.completed_at?Date.parse(step.completed_at):null;
      if(!Number.isFinite(start) || start>=checkpoint || end===null || !Number.isFinite(end) || end>=checkpoint) {
        throw Error('An SMTP attempt is newer than durable history; manual reconciliation required before any resend. Recover the missing state artifact or reconcile the recipient mailbox.');
      }
    }
  }
}
