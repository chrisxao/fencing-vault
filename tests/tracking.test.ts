import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containRect, normalizedPoint, posesAt, trackingInputSchema, type TrackingFrame, type TrackedPose } from '../shared/tracking.ts';
import { poseKeyframeInputSchema } from '../shared/domain.ts';
import { __testing } from '../server/repository.ts';
const pose = (x: number, trackId = 'left-s0'): TrackedPose => ({ side: 'left', trackId, keypoints: [{ name: 'head', x, y: .4, confidence: .9, visible: true }], bbox: [0,0,1,1], confidence: .9, footMeters: null, speedMps: null });
const frame = (timestampMs: number, poses = [pose(.2)], shot = 0): TrackingFrame => ({ timestampMs, sourcePts: timestampMs, shot, poses, camera: { status: 'unknown', inliers: 0, transform: null } });

test('overlay coordinates match letterboxed and pillarboxed video, and clamp drags', () => {
  assert.deepEqual(containRect(800, 600, 1920, 1080), { x: 0, y: 75, width: 800, height: 450 });
  assert.deepEqual(containRect(800, 450, 600, 600), { x: 175, y: 0, width: 450, height: 450 });
  assert.deepEqual(normalizedPoint(-10, 470, 800, 450), { x: 0, y: 1 });
});
test('interpolates only the same visible joint on a continuous identity', () => {
  const result = posesAt([frame(1000), frame(1100, [pose(.4)])], 1050);
  assert.ok(Math.abs(result[0].keypoints[0].x - .3) < 1e-10);
  const hidden = pose(.4); hidden.keypoints[0].visible = false;
  assert.equal(posesAt([frame(1000), frame(1100, [hidden])], 1050)[0].keypoints[0].visible, false);
});
test('never bridges camera cuts, tracking gaps, identities, or ranges', () => {
  assert.deepEqual(posesAt([frame(1000), frame(1100, [pose(.4)], 1)], 1050), []);
  assert.deepEqual(posesAt([frame(1000), frame(1300)], 1150), []);
  assert.deepEqual(posesAt([frame(1000), frame(1100, [pose(.4, 'different')])], 1050), []);
  assert.deepEqual(posesAt([frame(1000), frame(1100, [])], 1050), []);
  assert.deepEqual(posesAt([frame(1000)], 2000), []);
  assert.equal(posesAt([frame(1000)], 995).length, 1); // a seek between presentation timestamps
});
test('tracking ranges and calibration reject impossible inputs', () => {
  assert.equal(trackingInputSchema.safeParse({ startMs: 4000, endMs: 3000 }).success, false);
  assert.equal(trackingInputSchema.safeParse({ startMs: 0, endMs: 1_200_001 }).success, false);
  assert.equal(trackingInputSchema.safeParse({ startMs: 0, endMs: 1000, sampleFps: 60 }).success, false);
});
test('null frame numbers use timestamps and machine proposals do not change human labels', async () => {
  const repo = new __testing.MemoryRepository();
  const bout = (await repo.dashboard()).bouts[0];
  const input = poseKeyframeInputSchema.parse({ timestampMs: 22000, frameNumber: null, side: 'left', trackId: 'left-1', keypoints: [pose(.2).keypoints[0]], weapon: {}, source: 'human' });
  const a = await repo.upsertPose(bout.id, input);
  const b = await repo.upsertPose(bout.id, { ...input, timestampMs: 23000 });
  assert.notEqual(a.id, b.id);
  const updated = await repo.upsertPose(bout.id, { ...input, keypoints: [pose(.3).keypoints[0]] });
  assert.equal(updated.id, a.id);
  await repo.putTrackingRun({ id: crypto.randomUUID(), boutId: bout.id, mediaId: crypto.randomUUID(), state: 'ready', progress: 1, error: '', input: {startMs:0,endMs:1000,sampleFps:10,seeds:null,calibration:null}, createdAt: new Date().toISOString(), result: {schemaVersion:1,model:'test',sourceSha256:'test',width:800,height:450,sampleFps:10,frames:[frame(1000)],warnings:[]} });
  assert.equal((await repo.getBout(bout.id))!.poses.find(p => p.id === a.id)!.keypoints[0].x, .3);
  assert.equal('result' in (await repo.listTrackingRuns(bout.id))[0], false);
});
