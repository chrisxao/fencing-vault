import { z } from 'zod';
import { keypointSchema } from './domain.ts';
import type { PoseKeyframeInput } from './domain.ts';

export const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const calibrationSchema = z.object({
  // Image order: left near, left far, right far, right near.
  points: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]),
  leftMeters: z.number().min(0).max(14), rightMeters: z.number().min(0).max(14),
  widthMeters: z.number().positive().max(2),
}).refine(v => v.rightMeters > v.leftMeters, 'Right mark must be further along the strip');
export const trackingInputSchema = z.object({
  startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
  sampleFps: z.number().min(2).max(30).default(10),
  seeds: z.object({ left: pointSchema, right: pointSchema }).nullable().default(null),
  calibration: calibrationSchema.nullable().default(null),
}).refine(v => v.endMs > v.startMs && v.endMs - v.startMs <= 1_200_000, 'Choose a range of up to 20 minutes');
export type TrackingInput = z.infer<typeof trackingInputSchema>;
export type Point = z.infer<typeof pointSchema>;
export type Side = 'left' | 'right';
export type Joint = z.infer<typeof keypointSchema>;
export interface TrackedPose {
  side: Side; trackId: string; keypoints: Joint[]; bbox: [number, number, number, number];
  confidence: number; footMeters: number | null; speedMps: number | null;
}
export interface TrackingFrame {
  timestampMs: number; sourcePts: number; shot: number; poses: TrackedPose[];
  camera: { status: 'anchored' | 'relative' | 'unknown'; inliers: number; transform: number[] | null };
}
export interface TrackingResult {
  schemaVersion: 1; model: string; sourceSha256: string; width: number; height: number;
  sampleFps: number; frames: TrackingFrame[]; warnings: string[];
}
export interface TrackingRun {
  id: string; boutId: string; mediaId: string; state: 'running' | 'ready' | 'failed' | 'cancelled';
  progress: number; error: string; input: TrackingInput; createdAt: string;
  result?: TrackingResult | null;
}

export const bodyJoints = ['head', 'neck', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'hip', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_big_toe', 'right_big_toe', 'left_heel', 'right_heel'];
export const weaponJoints = ['guard', 'blade_mid', 'tip'];
export const skeletonEdges: [string, string][] = [
  ['head', 'neck'], ['neck', 'hip'], ['neck', 'left_shoulder'], ['neck', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'], ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  ['left_ankle', 'left_big_toe'], ['left_ankle', 'left_heel'], ['left_heel', 'left_big_toe'],
  ['right_ankle', 'right_big_toe'], ['right_ankle', 'right_heel'], ['right_heel', 'right_big_toe'],
  ['guard', 'blade_mid'], ['blade_mid', 'tip'],
  // Keep older human labels readable without changing their anatomical meaning.
  ['nose', 'weapon_shoulder'], ['weapon_shoulder', 'weapon_elbow'], ['weapon_elbow', 'weapon_wrist'],
  ['weapon_shoulder', 'front_hip'], ['front_hip', 'rear_hip'], ['front_hip', 'front_knee'],
  ['front_knee', 'front_ankle'], ['rear_hip', 'rear_knee'], ['rear_knee', 'rear_ankle'], ['weapon_wrist', 'guard'],
];

export function containRect(width: number, height: number, videoWidth: number, videoHeight: number) {
  if (!width || !height || !videoWidth || !videoHeight) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const w = videoWidth * scale, h = videoHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
export function normalizedPoint(x: number, y: number, width: number, height: number): Point {
  return { x: Math.max(0, Math.min(1, x / width)), y: Math.max(0, Math.min(1, y / height)) };
}
export function posePoints(pose: PoseKeyframeInput): Joint[] {
  return [...pose.keypoints, ...Object.values(pose.weapon).filter((p): p is Joint => Boolean(p))];
}

// Never bridge cuts, identity changes, missing detections, or long inference gaps.
export function posesAt(frames: TrackingFrame[], ms: number): TrackedPose[] {
  let lo = 0, hi = frames.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (frames[mid].timestampMs < ms) lo = mid + 1; else hi = mid; }
  const after = frames[lo], before = frames[lo - 1];
  if (after && Math.abs(after.timestampMs - ms) < 1) return after.poses;
  if (before && Math.abs(before.timestampMs - ms) < 1) return before.poses;
  if (!before && after && after.timestampMs - ms <= 17) return after.poses;
  if (!after && before && ms - before.timestampMs <= 17) return before.poses;
  if (!before || !after || before.shot !== after.shot || after.timestampMs - before.timestampMs > 220) return [];
  const t = (ms - before.timestampMs) / (after.timestampMs - before.timestampMs);
  return before.poses.flatMap(a => {
    const b = after.poses.find(p => p.trackId === a.trackId && p.side === a.side);
    if (!b) return [];
    return [{ ...a, footMeters: null, speedMps: null, keypoints: a.keypoints.map(p => {
      const q = b.keypoints.find(j => j.name === p.name);
      return q && q.visible && p.visible ? { ...p, x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, confidence: Math.min(p.confidence ?? 0, q.confidence ?? 0) } : { ...p, visible: false };
    }) }];
  });
}
