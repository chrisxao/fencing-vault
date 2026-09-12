/** Run with DATABASE_URL pointing at a disposable PostgreSQL database. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRepository } from '../server/repository.ts';
import { createPool } from '../server/migrate.ts';
import { createBoutSchema, poseKeyframeInputSchema } from '../shared/domain.ts';
import type { TrackingRun } from '../shared/tracking.ts';

if (!/smoke/.test(new URL(process.env.DATABASE_URL || 'postgresql://localhost/missing').pathname)) throw new Error('DATABASE_URL must name a disposable smoke database.');
const repository = createRepository();
let closed = false;
if (repository.demoMode) throw new Error('Use an isolated PostgreSQL database for this smoke test.');
await repository.init();
const pool = createPool();
let boutId = '';
try {
  const bout = await repository.createBout(createBoutSchema.parse({title:'Disposable pose smoke test'})); boutId = bout.id;
  const media = await repository.attachMedia(boutId, { kind:'external', objectKey:null, externalUrl:'https://example.com/test.mp4', filename:'test.mp4', mimeType:'video/mp4', sizeBytes:null, durationMs:10000, fps:60, width:1920, height:1080, status:'ready' });
  const run: TrackingRun = {id:crypto.randomUUID(),boutId,mediaId:media.id,state:'ready',progress:1,error:'',createdAt:new Date().toISOString(),input:{startMs:0,endMs:1000,sampleFps:10,seeds:null,calibration:null},result:{schemaVersion:1,model:'smoke',sourceSha256:'a'.repeat(64),width:1920,height:1080,sampleFps:10,frames:[],warnings:[]}};
  await repository.putTrackingRun(run);
  const input = poseKeyframeInputSchema.parse({timestampMs:1000,frameNumber:null,side:'left',trackId:'left-1',keypoints:[{name:'head',x:.2,y:.3,visible:true,confidence:1}],weapon:{},source:'corrected-model',provenance:{mediaId:media.id,runId:run.id,model:'smoke',sourceSha256:run.result!.sourceSha256}});
  const original = await repository.upsertPose(boutId,input);
  const second = await repository.upsertPose(boutId,{...input,timestampMs:1100});
  assert.notEqual(second.id,original.id);
  const corrected = await repository.upsertPose(boutId,{...input,keypoints:[{...input.keypoints[0],x:.25}]});
  assert.equal(corrected.id,original.id);
  const history = await pool.query('SELECT payload FROM pose_label_history WHERE pose_id=$1 ORDER BY id',[original.id]);
  assert.ok(history.rows.some(r=>r.payload.keypoints[0].x===.2));
  assert.ok(history.rows.some(r=>r.payload.keypoints[0].x===.25));
  await repository.close(); closed = true;
  const restarted = createRepository(); await restarted.init();
  try {
    assert.equal((await restarted.getTrackingRun(run.id))?.result?.sourceSha256,run.result!.sourceSha256);
    assert.equal((await restarted.getBout(boutId))?.poses.length,2);
    assert.equal((await restarted.listTrackingRuns(boutId))[0].result,undefined);
    const exported = await restarted.datasetManifest();
    assert.equal(exported.bouts.find(b=>b.id===boutId)?.poses.length,2);
    assert.equal(JSON.stringify(exported).includes('pose_tracking_runs'),false);
  } finally { await restarted.close(); }
  console.log('Pose smoke passed: migrations, PTS upserts, correction history, provenance, restart persistence, proposal separation.');
} finally {
  if (boutId) await pool.query('DELETE FROM bouts WHERE id=$1',[boutId]);
  await pool.end(); if (!closed) await repository.close();
}
