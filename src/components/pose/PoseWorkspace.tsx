import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { BoutDetail } from '../../../shared/api.ts';
import type { PoseKeyframeInput } from '../../../shared/domain.ts';
import { bodyJoints, weaponJoints, skeletonEdges, containRect, normalizedPoint, posesAt, posePoints, type Joint, type Point, type Side, type TrackingRun, type TrackingInput } from '../../../shared/tracking.ts';
import { api, formatTime } from '../../api.ts';

type Draft = { timestampMs: number; side: Side; points: Joint[]; original: PoseKeyframeInput | null; run: TrackingRun | null; dirty: boolean; occluded: boolean };
type Picking = 'fencers' | 'piste' | null;
interface Context {
  bout: BoutDetail; currentMs: number; videoRef: RefObject<HTMLVideoElement | null>;
  visible: boolean; setVisible: (v: boolean) => void; side: Side; setSide: (v: Side) => void;
  draft: Draft | null; setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  activeJoint: string; setActiveJoint: (v: string) => void; run: TrackingRun | null; runs: TrackingRun[];
  error: string; busy: boolean; available: boolean; begin: () => void; save: () => Promise<void>;
  start: () => Promise<void>; selectRun: (id: string) => Promise<void>; cancelRun: () => Promise<void>;
  seconds: number; setSeconds: (v: number) => void; fps: number; setFps: (v: number) => void;
  picking: Picking; setPicking: (v: Picking) => void; picks: Point[]; setPicks: React.Dispatch<React.SetStateAction<Point[]>>;
  seeds: TrackingInput['seeds']; calibration: TrackingInput['calibration']; pick: (p: Point) => void;
  bounds: [number, number]; setBounds: (v: [number, number]) => void;
  camera: string; metrics: string[]; reviewed: number; nextIssue: () => void;
}
const PoseContext = createContext<Context | null>(null);
function usePose() { const value = useContext(PoseContext); if (!value) throw new Error('Pose workspace missing'); return value; }
const title = (name: string) => name.replaceAll('_', ' ').replace(/\b\w/g, v => v.toUpperCase());
const closeFrame = (a: number, b: number) => Math.abs(a-b) < 2;

export function PoseProvider({ bout, currentMs, videoRef, onSaved, onSeek, children }: { bout: BoutDetail; currentMs: number; videoRef: RefObject<HTMLVideoElement | null>; onSaved: () => void; onSeek: (ms: number) => void; children: ReactNode }) {
  const [visible, setVisible] = useState(() => localStorage.getItem('sabre-skeleton-visible') !== 'false');
  const [side, setSide] = useState<Side>('left');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeJoint, setActiveJoint] = useState('head');
  const [run, setRun] = useState<TrackingRun | null>(null), [runs, setRuns] = useState<TrackingRun[]>([]);
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [seconds, setSeconds] = useState(10), [fps, setFps] = useState(10);
  const [picking, setPicking] = useState<Picking>(null), [picks, setPicks] = useState<Point[]>([]);
  const [seeds, setSeeds] = useState<TrackingInput['seeds']>(null), [calibration, setCalibration] = useState<TrackingInput['calibration']>(null);
  const [anchorMs, setAnchorMs] = useState<number | null>(null), [bounds, setBounds] = useState<[number, number]>([0, 14]);
  const mediaId = bout.media?.id;
  const human = bout.poses.filter(p => p.source !== 'model' && (!p.provenance?.mediaId || p.provenance.mediaId === mediaId));
  const reviewed = human.length;
  useEffect(() => { localStorage.setItem('sabre-skeleton-visible', String(visible)); }, [visible]);
  useEffect(() => {
    let disposed = false;
    setDraft(null); setRun(null); setSeeds(null); setCalibration(null);
    void Promise.all([api.config(), api.trackingRuns(bout.id)]).then(async ([config, values]) => {
      if (disposed) return;
      setAvailable(config.poseTrackingAvailable); setRuns(values.filter(r => r.mediaId === mediaId));
      const latest = values.find(r => r.mediaId === mediaId && (r.state === 'ready' || r.state === 'running'));
      if (latest) { const value = await api.trackingRun(latest.id); if (!disposed) setRun(value); }
    }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [bout.id, mediaId]);
  useEffect(() => {
    if (run?.state !== 'running') return;
    let disposed = false;
    const timer = setInterval(() => { void api.trackingRun(run.id).then(value => { if (!disposed) { setRun(value); if (value.state !== 'running') void api.trackingRuns(bout.id).then(setRuns); } }).catch(e => { if (!disposed) setError(e.message); }); }, 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, [run?.id, run?.state, bout.id]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.dataset.poseEditing = draft || picking ? 'true' : 'false';
    if (draft || picking) video.pause();
    return () => { video.dataset.poseEditing = 'false'; };
  }, [draft, picking, videoRef]);
  useEffect(() => {
    if (anchorMs !== null && !closeFrame(anchorMs, currentMs)) { setSeeds(null); setCalibration(null); setAnchorMs(null); }
  }, [currentMs, anchorMs]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (draft?.dirty) { e.preventDefault(); e.returnValue = ''; } };
    const navigate = (e: MouseEvent) => { if (draft?.dirty && !e.metaKey && !e.ctrlKey && (e.target as Element).closest('a[href]')) { e.preventDefault(); e.stopPropagation(); setError('Save or discard the current pose draft before leaving this bout.'); } };
    window.addEventListener('beforeunload', leave); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', leave); document.removeEventListener('click', navigate, true); };
  }, [draft?.dirty]);
  function begin() {
    videoRef.current?.pause(); setVisible(true); setError('');
    const existing = human.find(p => p.side === side && closeFrame(p.timestampMs, currentMs));
    const model = run?.state === 'ready' ? posesAt(run.result?.frames ?? [], currentMs).find(p => p.side === side) : null;
    setDraft({ timestampMs: Math.round(currentMs), side, points: existing ? posePoints(existing) : model?.keypoints.map(p => ({...p})) ?? [], original: existing ?? null, run: existing ? null : model ? run : null, dirty: false, occluded: existing?.occluded ?? false });
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setError('');
    const find = (name: string) => draft.points.find(p => p.name === name) ?? null;
    const input: PoseKeyframeInput = { timestampMs: draft.timestampMs, frameNumber: draft.original?.frameNumber ?? null, side: draft.side, trackId: draft.original?.trackId ?? `${draft.side}-1`, keypoints: draft.points.filter(p => !weaponJoints.includes(p.name)), weapon: { guard: find('guard'), bladeMid: find('blade_mid'), tip: find('tip') }, bbox: draft.original?.bbox ?? null, frontFootMeters: draft.original?.frontFootMeters ?? null, rearFootMeters: draft.original?.rearFootMeters ?? null, opponentDistanceMeters: draft.original?.opponentDistanceMeters ?? null, occluded: draft.occluded, source: draft.run || draft.original?.source === 'corrected-model' ? 'corrected-model' : 'human', provenance: draft.original?.provenance ?? (mediaId ? { mediaId, runId: draft.run?.id ?? null, model: draft.run?.result?.model ?? null, sourceSha256: draft.run?.result?.sourceSha256 ?? null } : null) };
    try { await api.savePose(bout.id, input); setDraft({ ...draft, original: input, dirty: false }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save pose'); }
    finally { setBusy(false); }
  }
  async function start() {
    setBusy(true); setError('');
    try { const endMs = Math.min(bout.media?.durationMs ?? Infinity, Math.round(currentMs + seconds*1000)); const value = await api.startTracking(bout.id, { startMs: Math.round(currentMs), endMs, sampleFps: fps, seeds, calibration }); setRun(value); setRuns(values => [value, ...values]); setVisible(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start tracking'); }
    finally { setBusy(false); }
  }
  function changePicking(value: Picking) {
    if (value) { videoRef.current?.pause(); setVisible(true); setPicks([]); setAnchorMs(currentMs); }
    setPicking(value);
  }
  function pick(point: Point) {
    const next = [...picks, point]; setPicks(next);
    if (picking === 'fencers' && next.length === 2) { setSeeds({ left: next[0], right: next[1] }); setPicking(null); }
    if (picking === 'piste' && next.length === 4) { setCalibration({ points: next as [Point, Point, Point, Point], leftMeters: bounds[0], rightMeters: bounds[1], widthMeters: 1.5 }); setPicking(null); }
  }
  const frame = useMemo(() => run?.result?.frames.find(f => Math.abs(f.timestampMs-currentMs) <= 100), [run, currentMs]);
  const camera = frame?.camera.status === 'anchored' ? 'Piste anchored · estimates' : frame?.camera.status === 'relative' ? 'Camera motion estimated · metres unknown' : 'Piste position and speed unknown';
  const metrics = frame?.camera.status === 'anchored' ? frame.poses.filter(q => q.footMeters !== null).map(q => `${title(q.side)}: ${q.footMeters!.toFixed(2)} m${q.speedMps !== null ? ` · ${Math.abs(q.speedMps).toFixed(2)} m/s` : ''} · ${q.footMeters! < 2 ? 'left end' : q.footMeters! > 12 ? 'right end' : q.footMeters! >= 6 && q.footMeters! <= 8 ? 'middle' : 'between markings'}`) : [];
  function nextIssue() {
    const frames = run?.result?.frames ?? [];
    const next = frames.find(f => f.timestampMs > currentMs + 150 && (f.poses.length < 2 || f.poses.some(p => p.keypoints.some(k => !k.visible || (k.confidence ?? 0) < .5))));
    if (next) onSeek(next.timestampMs); else setError('No later uncertain sample in this range.');
  }
  return <PoseContext.Provider value={{ bout, currentMs, videoRef, visible, setVisible, side, setSide, draft, setDraft, activeJoint, setActiveJoint, run, runs, error, busy, available, begin, save, start, selectRun: async id => { setRun(await api.trackingRun(id)); }, cancelRun: async () => { if (run) setRun(await api.cancelTracking(run.id)); }, seconds, setSeconds, fps, setFps, picking, setPicking: changePicking, picks, setPicks, seeds, calibration, pick, bounds, setBounds, camera, metrics, reviewed, nextIssue }}>{children}</PoseContext.Provider>;
}

export function PoseToolbar() {
  const p = usePose();
  return <div className="skeleton-toolbar" data-pose-editor><label className="check-label"><input type="checkbox" checked={p.visible} onChange={e => p.setVisible(e.target.checked)} disabled={Boolean(p.draft || p.picking)} /> Skeletons</label><span className="skeleton-legend"><i className="left" /> Left <i className="right" /> Right <i className="uncertain" /> Uncertain</span><span>{p.draft ? `Editing ${p.draft.side} · ${formatTime(p.draft.timestampMs)}` : p.camera}</span></div>;
}

export function PosePanel() {
  const p = usePose();
  const videoReady = Boolean(p.bout.media?.playbackUrl && p.videoRef.current);
  const editing = Boolean(p.draft || p.picking);
  const joints = [...bodyJoints, ...weaponJoints, ...(p.draft?.points.map(j => j.name).filter(n => !bodyJoints.includes(n) && !weaponJoints.includes(n)) ?? [])];
  const uncertain = useMemo(() => p.run?.result?.frames.filter(f => f.poses.length < 2).length ?? 0, [p.run]);
  return <div className="pose-workspace-panel" data-pose-editor>
    <section><p className="eyebrow">VIDEO GEOMETRY</p><h3>Track, inspect, correct</h3><p className="pose-help">Start on a frame with both fencers visible. Body and foot points are proposed automatically; sabre points are labeled on the video.</p>
      {!videoReady && <p className="hint-box">Attach the playable video to start. A FencingTV reference link alone cannot provide video frames.</p>}
      {!p.available && <p className="hint-box">Automatic tracking needs the local pose runtime. Setup: <code>docs/pose-tracking.md</code>. Manual correction is available on attached video.</p>}
      <div className="form-row"><label>Range (seconds)<input aria-label="Tracking range seconds" type="number" min={1} max={1200} value={p.seconds} disabled={editing} onChange={e => p.setSeconds(Number(e.target.value))} /></label><label>Samples / second<select value={p.fps} disabled={editing} onChange={e => p.setFps(Number(e.target.value))}><option value={5}>5 · quick preview</option><option value={10}>10 · standard</option><option value={20}>20 · detailed</option><option value={30}>30 · fast actions</option></select></label></div>
      <p className="pose-help">From {formatTime(p.currentMs)}. Higher sampling captures more detail and takes longer; inspect original frames for blade timing.</p>
      <button className="secondary-button full-button" disabled={!videoReady || editing || p.run?.state === 'running'} onClick={() => p.setPicking('fencers')}>{p.seeds ? '✓ Fencers selected · select again' : 'Select the two fencers on video'}</button>
      <button className="primary-button full-button" disabled={!videoReady || !p.available || editing || p.busy || p.run?.state === 'running' || p.seconds <= 0} onClick={() => void p.start()}>Track from this frame</button>
      {p.picking && <div className="hint-box" role="status">{p.picking === 'fencers' ? `Click inside the ${p.picks.length ? 'right' : 'left'} fencer’s body on the video.` : `Click ${['left mark, near edge', 'left mark, far edge', 'right mark, far edge', 'right mark, near edge'][p.picks.length]} on the video.`}<button onClick={() => p.setPicking(null)}>Cancel selection</button></div>}
      {p.run?.state === 'running' && <div role="status" className="tracking-progress"><progress max={1} value={p.run.progress} /><span>Tracking {Math.round(p.run.progress*100)}% · you can keep reviewing</span><button onClick={() => void p.cancelRun()}>Cancel tracking</button></div>}
      {p.run?.state === 'failed' && <p role="alert" className="field-error">{p.run.error}</p>}
      {p.run?.state === 'cancelled' && <p role="status">Tracking cancelled. Saved corrections remain available.</p>}
      {p.runs.length > 0 && <label>Tracking range<select aria-label="Tracking range" value={p.run?.id ?? ''} disabled={editing || p.run?.state === 'running'} onChange={e => void p.selectRun(e.target.value)}><option value="" disabled>Select a range</option>{p.runs.map(r => <option key={r.id} value={r.id}>{formatTime(r.input.startMs)}–{formatTime(r.input.endMs)} · {r.state}</option>)}</select></label>}
      {p.run?.state === 'ready' && <><p className="pose-help">{p.run.result?.frames.length} sampled frames · {uncertain} missing one or both fencers. These are unreviewed proposals.</p><button disabled={editing} className="secondary-button full-button" onClick={p.nextIssue}>Next uncertain frame →</button><details><summary>Tracking notes</summary>{p.run.result?.warnings.map(w => <p key={w}>{w}</p>)}</details></>}
    </section>
    <section><h3>Correct this frame</h3><div className="side-toggle"><button disabled={editing} className={p.side === 'left' ? 'active' : ''} onClick={() => p.setSide('left')}>Left fencer</button><button disabled={editing} className={p.side === 'right' ? 'active' : ''} onClick={() => p.setSide('right')}>Right fencer</button></div>
      {!p.draft ? <><p className="pose-help">Pause to review or add points. Anatomical left/right limbs refer to the fencer’s own body.</p><button className="primary-button full-button" disabled={!videoReady || Boolean(p.picking)} onClick={p.begin}>Edit {p.side} on video</button></> : <>
        <p className="hint-box">Frame locked at {formatTime(p.draft.timestampMs)}. Drag an existing point, or choose a joint below and click the video. Arrow keys nudge a focused point.</p>
        <div className="pose-joint-grid">{joints.map(name => <button key={name} className={p.activeJoint === name ? 'active' : ''} onClick={() => p.setActiveJoint(name)}>{p.draft?.points.some(j => j.name === name && j.visible) ? '● ' : '○ '}{title(name)}</button>)}</div>
        <label className="check-label"><input type="checkbox" checked={p.draft.occluded} onChange={e => p.setDraft(d => d ? { ...d, occluded: e.target.checked, dirty: true } : d)} /> Fencer or weapon is occluded</label>
        <button className="secondary-button full-button" onClick={() => p.setDraft(d => d ? { ...d, dirty: true, points: d.points.map(j => j.name === p.activeJoint ? { ...j, visible: !j.visible } : j) } : d)}>Toggle selected point visibility</button>
        <div className="pose-save-row"><button disabled={p.busy} onClick={() => p.setDraft(null)}>{p.draft.dirty ? 'Discard draft' : 'Done editing'}</button><button className="primary-button" disabled={p.busy || !p.draft.points.length} onClick={() => void p.save()}>{p.busy ? 'Saving…' : p.draft.original && !p.draft.dirty ? 'Saved ✓' : 'Save correction'}</button></div>
      </>}
      <p className="pose-help">{p.reviewed} saved human keyframes. Saved points take precedence at their labeled timestamp; corrections are not propagated automatically.</p>
    </section>
    <section>{p.metrics.map(value => <p className="hint-box" key={value}>{value} (estimate)</p>)}<details><summary>Camera and strip position</summary><p>Metres require visible, known piste markings. Select the four corners between two markings at this frame. Calibration follows the piste until visual support is lost or the shot cuts.</p><div className="form-row"><label>Left mark (m)<input type="number" min={0} max={14} value={p.bounds[0]} disabled={editing} onChange={e => p.setBounds([Number(e.target.value), p.bounds[1]])} /></label><label>Right mark (m)<input type="number" min={0} max={14} value={p.bounds[1]} disabled={editing} onChange={e => p.setBounds([p.bounds[0], Number(e.target.value)])} /></label></div><p className="pose-help">Use 0–14 only when both ends are visible. Width is assumed 1.5 m; position estimates remain provisional.</p><button className="secondary-button full-button" disabled={!videoReady || editing || p.bounds[1] <= p.bounds[0]} onClick={() => p.setPicking('piste')}>{p.calibration ? '✓ Piste selected · select again' : 'Select piste corners on video'}</button><p className="pose-help">{p.camera}. A moving camera can keep a moving fencer centred. Screen position alone is never treated as strip speed.</p></details></section>
    {p.error && <p role="alert" className="field-error">{p.error}</p>}
  </div>;
}

export function PoseOverlay() {
  const p = usePose(), host = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const drag = useRef<{ name: string; pointer: number } | null>(null);
  useEffect(() => {
    const target = host.current?.parentElement, video = p.videoRef.current;
    if (!target || !video) return;
    const resize = () => setRect(containRect(target.clientWidth, target.clientHeight, video.videoWidth, video.videoHeight));
    const observer = new ResizeObserver(resize); observer.observe(target); video.addEventListener('loadedmetadata', resize); resize();
    return () => { observer.disconnect(); video.removeEventListener('loadedmetadata', resize); };
  }, [p.videoRef, p.bout.media?.id]);
  const models = useMemo(() => p.run?.state === 'ready' ? posesAt(p.run.result?.frames ?? [], p.currentMs) : [], [p.run, p.currentMs]);
  const poses = (['left', 'right'] as Side[]).map(side => {
    if (p.draft?.side === side) return { side, points: p.draft.points, source: 'editing' };
    const saved = p.bout.poses.find(q => q.side === side && q.source !== 'model' && closeFrame(q.timestampMs, p.currentMs) && (!q.provenance?.mediaId || q.provenance.mediaId === p.bout.media?.id));
    if (saved) return { side, points: posePoints(saved), source: 'reviewed' };
    return { side, points: models.find(q => q.side === side)?.keypoints ?? [], source: 'model' };
  });
  function point(event: React.PointerEvent<SVGElement>) {
    const box = event.currentTarget.closest('svg')!.getBoundingClientRect();
    return normalizedPoint(event.clientX-box.left, event.clientY-box.top, box.width, box.height);
  }
  function move(name: string, value: Point) {
    p.setDraft(d => d ? { ...d, dirty: true, points: [...d.points.filter(j => j.name !== name), { name, ...value, visible: true, confidence: 1 }] } : d);
  }
  return <div ref={host} className="pose-overlay-host" aria-hidden={!p.visible} style={{ pointerEvents: 'none' }}>
    {p.visible && rect.width > 0 && <svg className={`video-pose-overlay ${p.draft || p.picking ? 'editing' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, pointerEvents: p.draft || p.picking ? 'auto' : 'none' }} viewBox={`0 0 ${rect.width} ${rect.height}`} role="group" aria-label="Skeleton overlay on video" data-pose-editor
      onPointerDown={e => { if (e.target !== e.currentTarget) return; if (p.picking) p.pick(point(e)); else if (p.draft) move(p.activeJoint, point(e)); }}
      onPointerMove={e => { if (drag.current && p.draft) move(drag.current.name, point(e)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {poses.map(pose => <g className={`skeleton ${pose.side} ${pose.source}`} key={pose.side}>
        {skeletonEdges.map(([a, b]) => { const from = pose.points.find(j => j.name === a && j.visible), to = pose.points.find(j => j.name === b && j.visible); return from && to ? <line key={`${a}-${b}`} x1={from.x*rect.width} y1={from.y*rect.height} x2={to.x*rect.width} y2={to.y*rect.height} className={Math.min(from.confidence ?? 1, to.confidence ?? 1) < .5 ? 'uncertain' : ''} /> : null; })}
        {pose.points.filter(j => j.visible || pose.source === 'editing').map(j => <g key={j.name}><circle cx={j.x*rect.width} cy={j.y*rect.height} r={pose.source === 'editing' ? 7 : 3.5} className={`${(j.confidence ?? 1) < .5 || !j.visible ? 'uncertain' : ''} ${p.activeJoint === j.name && pose.source === 'editing' ? 'selected' : ''}`} tabIndex={pose.source === 'editing' ? 0 : undefined} role={pose.source === 'editing' ? 'button' : undefined} aria-label={`${pose.side} ${title(j.name)}`} onPointerDown={e => { e.stopPropagation(); if (pose.source !== 'editing') return; p.setActiveJoint(j.name); drag.current = { name: j.name, pointer: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); }} onKeyDown={e => { if (pose.source !== 'editing' || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete','Backspace'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); if (e.key === 'Delete' || e.key === 'Backspace') { p.setDraft(d => d ? { ...d, dirty: true, points: d.points.filter(q => q.name !== j.name) } : d); return; } const step = e.shiftKey ? 10 : 1; move(j.name, normalizedPoint(j.x*rect.width + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), j.y*rect.height + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0), rect.width, rect.height)); }}><title>{title(j.name)}{j.visible ? '' : ' · hidden'}</title></circle>{pose.source === 'editing' && p.activeJoint === j.name && <text x={j.x*rect.width+10} y={j.y*rect.height-10}>{title(j.name)}</text>}</g>)}
      </g>)}
      {p.picking && p.picks.map((q, i) => <g key={i} className="calibration-point"><circle cx={q.x*rect.width} cy={q.y*rect.height} r={6} /><text x={q.x*rect.width+10} y={q.y*rect.height}>{i+1}</text></g>)}
    </svg>}
  </div>;
}
