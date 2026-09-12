import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Repository } from '../repository.ts';
import type { BoutDetail } from '../../shared/api.ts';
import type { TrackingInput, TrackingRun, TrackingResult } from '../../shared/tracking.ts';
import { presignPlayback, storageConfigured } from '../storage.ts';
import { probeVideo } from '../capture/media-tools.ts';

const root = path.resolve(process.env.POSE_WORK_DIR || '.local/pose-jobs');
const python = path.resolve(process.env.POSE_PYTHON || '.local/pose-venv/bin/python');
const models = path.resolve(process.env.POSE_MODELS_DIR || '.local/pose-models');
export const demoVideo = process.env.NODE_ENV !== 'production' && process.env.POSE_DEMO_VIDEO ? path.resolve(process.env.POSE_DEMO_VIDEO) : null;
const demoId = 'a3000000-0000-4000-8000-000000000001';
export function poseAvailable() { return fs.existsSync(python) && fs.existsSync(path.join(models, 'pose.onnx')) && fs.existsSync(path.join(models, 'detector.onnx')); }
let demoProbe: ReturnType<typeof probeVideo> | null = null;
export async function withDemoVideo(bout: BoutDetail, demoMode: boolean) {
  if (!demoMode || !demoVideo || bout.id !== demoId) return bout;
  const meta = await (demoProbe ??= probeVideo(demoVideo));
  bout.title = `Tracking test · ${path.basename(demoVideo)}`;
  bout.leftFencer = null; bout.rightFencer = null; bout.leftScore = 0; bout.rightScore = 0;
  bout.phrases = bout.phrases.filter(p => !p.id.startsWith('a4000000'));
  bout.poses = bout.poses.filter(p => Boolean(p.provenance));
  bout.durationMs = meta.durationMs;
  bout.media = { id: 'b3000000-0000-4000-8000-000000000001', kind: 'uploaded', objectKey: null, externalUrl: null, playbackUrl: '/api/pose-demo/video', filename: path.basename(demoVideo), mimeType: 'video/mp4', sizeBytes: null, durationMs: meta.durationMs, fps: meta.fps, width: meta.width, height: meta.height, status: 'ready' };
  return bout;
}
export class PoseManager {
  private repository: Repository;
  private pending: Promise<void> | null = null;
  private active: { run: TrackingRun; abort: AbortController; child: ChildProcess | null } | null = null;
  constructor(repository: Repository) { this.repository = repository; }
  async get(id: string) {
    if (this.active?.run.id === id) return structuredClone(this.active.run);
    const run = await this.repository.getTrackingRun(id);
    if (run?.state === 'running') {
      run.state = 'failed'; run.error = 'Tracking was interrupted by an API restart. Start the range again.';
      await this.repository.putTrackingRun(run);
    }
    return run;
  }
  async start(bout: BoutDetail, input: TrackingInput) {
    if (!poseAvailable()) throw Object.assign(new Error('Install the pose runtime first. See docs/pose-tracking.md.'), { status: 409 });
    if (this.active) throw Object.assign(new Error('Another range is being tracked. Wait for it to finish or cancel it.'), { status: 409 });
    if (!bout.media || bout.media.status !== 'ready') throw Object.assign(new Error('Attach a playable video first.'), { status: 409 });
    const local = this.repository.demoMode && demoVideo && bout.id === demoId ? demoVideo : null;
    if (!local && (!bout.media.objectKey || !storageConfigured())) throw Object.assign(new Error('Tracking needs the uploaded or captured video, not a reference link.'), { status: 409 });
    if (bout.media.durationMs && input.endMs > bout.media.durationMs + 100) throw Object.assign(new Error('The tracking range ends after the video.'), { status: 400 });
    const run: TrackingRun = { id: crypto.randomUUID(), boutId: bout.id, mediaId: bout.media.id, state: 'running', progress: 0, error: '', input, createdAt: new Date().toISOString() };
    const active = { run, abort: new AbortController(), child: null as ChildProcess | null };
    this.active = active;
    try { await this.repository.putTrackingRun(run); }
    catch (error) { this.active = null; throw error; }
    this.pending = this.execute(active, local, bout.media.objectKey).catch(error => { console.error('Could not persist tracking result:', error instanceof Error ? error.message : 'unknown error'); });
    return structuredClone(run);
  }
  async close() {
    if (this.active) { this.active.abort.abort(); this.active.child?.kill('SIGTERM'); }
    await this.pending;
  }
  async cancel(id: string) {
    if (this.active?.run.id !== id) return this.get(id);
    this.active.run.state = 'cancelled';
    this.active.abort.abort(); this.active.child?.kill('SIGTERM');
    await this.repository.putTrackingRun(this.active.run);
    return structuredClone(this.active.run);
  }
  private async execute(active: NonNullable<PoseManager['active']>, local: string | null, key: string | null) {
    const { run, abort } = active, dir = path.join(root, run.id);
    try {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      const source = local || path.join(dir, 'source.mp4');
      if (!local) {
        const response = await fetch(await presignPlayback(key!), { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(600_000)]), redirect: 'error' });
        if (!response.ok || !response.body) throw new Error('Could not download the attached video.');
        let bytes = 0;
        const limit = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > 4_294_967_296 ? new Error('Video exceeds 4 GB tracking limit.') : null, chunk); } });
        await pipeline(Readable.fromWeb(response.body as never), limit, fs.createWriteStream(source), { signal: abort.signal });
      }
      await fsp.writeFile(path.join(dir, 'options.json'), JSON.stringify(run.input));
      await new Promise<void>((resolve, reject) => {
        const child = spawn(python, [path.resolve('ml/pose/track.py'), '--input', source, '--output', path.join(dir, 'result.json'), '--options', path.join(dir, 'options.json'), '--models', models], { signal: abort.signal, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '2' } });
        active.child = child;
        let buffer = '', error = '';
        child.stdout?.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop()!; for (const line of lines) { try { const p = JSON.parse(line).progress; if (typeof p === 'number') run.progress = Math.max(0, Math.min(1, p)); } catch { /* library log */ } } });
        child.stderr?.on('data', chunk => { error = (error + chunk).slice(-2000); });
        const timeout = setTimeout(() => child.kill('SIGTERM'), 4 * 60 * 60 * 1000);
        child.on('error', reject);
        child.on('close', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(error.match(/Tracking failed:.*$/m)?.[0] || 'Pose runtime exited. Check its installation and available memory.')); });
      });
      if (run.state === 'cancelled') return;
      const result = JSON.parse(await fsp.readFile(path.join(dir, 'result.json'), 'utf8')) as TrackingResult;
      if (result.schemaVersion !== 1 || !Array.isArray(result.frames)) throw new Error('Pose runtime returned an invalid result.');
      run.result = result; run.state = 'ready'; run.progress = 1;
    } catch (error) {
      if (run.state !== 'cancelled') { run.state = 'failed'; run.error = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[source]') : 'Tracking failed'; }
    } finally {
      try { await this.repository.putTrackingRun(run); }
      finally { this.active = null; await fsp.rm(dir, { recursive: true, force: true }); }
    }
  }
}
