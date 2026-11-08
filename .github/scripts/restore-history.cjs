const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');

module.exports = async ({github,context,core}) => {
  const root=process.cwd();
  const {selectHistoryArtifact,assertHistoryCoversAttempts}=await import(pathToFileURL(path.join(root,'src/lib/history-artifacts.js')));
  const {loadHistory,saveHistory,emptyHistory}=await import(pathToFileURL(path.join(root,'src/lib/history-store.js')));
  const artifacts=await github.paginate(github.rest.actions.listArtifactsForRepo,{...context.repo,per_page:100});
  const artifact=selectHistoryArtifact(artifacts,context.ref.replace(/^refs\/heads\//,''),{initialize:process.env.INITIALIZE_HISTORY==='true'});
  const destination=path.join(root,'data/delivery-history.json');
  if(!artifact) {
    await saveHistory(destination,emptyHistory());
    core.warning('Initialized empty delivery history. Earlier emails are not inferred or marked sent.');
    return;
  }
  if(!artifact.workflow_run?.id) throw Error('History artifact lacks workflow run identity');
  const branch=context.ref.replace(/^refs\/heads\//,'');
  const baseRun=(await github.rest.actions.getWorkflowRun({...context.repo,run_id:artifact.workflow_run.id})).data;
  // Listing by creation time misses old runs re-executed after the checkpoint.
  const runs=await github.paginate(github.rest.actions.listWorkflowRuns,{...context.repo,workflow_id:'weekly-report.yml',branch,per_page:100});
  const checkpoint=Date.parse(artifact.created_at);
  const toAudit=new Map(runs.filter(run=>!Number.isFinite(Date.parse(run.updated_at)) || Date.parse(run.updated_at)>=checkpoint).map(run=>[run.id,run]));
  toAudit.set(baseRun.id,baseRun);
  for(const run of toAudit.values()) {
    if(!Number.isInteger(run.run_attempt) || run.run_attempt<1) throw Error('Workflow attempt metadata unavailable; cannot verify delivery history');
    const last=run.id===context.runId ? run.run_attempt-1 : run.run_attempt;
    for(let attempt=1;attempt<=last;attempt++) {
      const jobs=await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt,{...context.repo,run_id:run.id,attempt_number:attempt,per_page:100});
      if(!jobs.length || jobs.some(job=>!Array.isArray(job.steps))) throw Error('Workflow job metadata unavailable; cannot verify delivery history');
      assertHistoryCoversAttempts(artifact,jobs);
    }
  }
  const download=await github.rest.actions.downloadArtifact({...context.repo,artifact_id:artifact.id,archive_format:'zip'});
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'report-history-'));
  try {
    const zip=path.join(temp,'history.zip');
    await fs.writeFile(zip,Buffer.from(download.data));
    // Extract only the known file to stdout, never arbitrary ZIP paths.
    const content=execFileSync('unzip',['-p',zip,'delivery-history.json'],{maxBuffer:20*1024*1024});
    const restored=path.join(temp,'delivery-history.json');
    await fs.writeFile(restored,content);
    await saveHistory(destination,await loadHistory(restored));
    core.info(`Restored delivery history artifact ${artifact.id}`);
  } finally { await fs.rm(temp,{recursive:true,force:true}); }
};
