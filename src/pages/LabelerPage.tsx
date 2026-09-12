import { PoseProvider, PoseOverlay, PosePanel, PoseToolbar } from '../components/pose/PoseWorkspace.tsx';
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BoutDetail, DashboardData, IngestionJobRecord, PhraseRecord } from '../../shared/api.ts';
import type { ActionDefinition, PhraseEventInput, PhraseInput } from '../../shared/domain.ts';
import { api, formatTime } from '../api.ts';
import { ErrorNotice, Spinner, Toast } from '../components/Feedback.tsx';

type InspectorTab = 'call' | 'actions' | 'geometry';

const startReasons: PhraseInput['startReason'][] = ['play-command', 'restart', 'visible-movement', 'broadcast-return', 'unknown'];
const endReasons: PhraseInput['endReason'][] = ['touch-registered', 'referee-halt-no-touch', 'rule-violation', 'off-piste', 'corps-a-corps', 'dangerous-or-confused', 'equipment', 'injury', 'period-ended', 'broadcast-cut', 'other'];
const priorities: PhraseEventInput['priorityBefore'][] = ['left', 'right', 'simultaneous', 'none', 'unclear'];
const actors: PhraseEventInput['actor'][] = ['left', 'right', 'both', 'referee', 'apparatus'];

function label(value: string) { return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function refs(value: string) { return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean); }

export function LabelerPage() {
  const { boutId = '' } = useParams();
  const [bout, setBout] = useState<BoutDetail | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [ingestion, setIngestion] = useState<IngestionJobRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>('call');
  const [currentMs, setCurrentMs] = useState(0);
  const [markStart, setMarkStart] = useState<number | null>(null);
  const [markEnd, setMarkEnd] = useState<number | null>(null);
  const [showNewPhrase, setShowNewPhrase] = useState(false);
  const [error, setError] = useState<unknown>();
  const [toast, setToast] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = async (preserveSelection = true) => {
    try {
      const [nextBout, nextDashboard, nextIngestion] = await Promise.all([api.bout(boutId), api.dashboard(), api.ingestion(boutId)]);
      setBout(nextBout); setDashboard(nextDashboard); setIngestion(nextIngestion);
      if (!preserveSelection || !selectedId || !nextBout.phrases.some((phrase) => phrase.id === selectedId)) setSelectedId(nextBout.phrases[0]?.id ?? null);
    } catch (caught) { setError(caught); }
  };
  useEffect(() => { void load(false); }, [boutId]);
  useEffect(() => {
    if (!ingestion || ingestion.state === 'ready' || ingestion.state === 'failed') return;
    const interval = window.setInterval(() => { void load(); }, 5_000);
    return () => window.clearInterval(interval);
  }, [boutId, ingestion?.state]);
  const selected = bout?.phrases.find((phrase) => phrase.id === selectedId) ?? null;
  const duration = Math.max(bout?.durationMs ?? 0, ...((bout?.phrases ?? []).map((phrase) => phrase.endMs)), 30_000);
  const seek = (ms: number) => { if (videoRef.current?.dataset.poseEditing === 'true') return; const next = Math.max(0, Math.min(duration, ms)); setCurrentMs(next); if (videoRef.current) videoRef.current.currentTime = next / 1_000; };
  const frameStep = (amount: number) => seek(currentMs + (1_000 / (bout?.media?.fps || 60)) * amount);
  const notify = (message: string) => { setToast(message); setTimeout(() => setToast(''), 2400); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(target.tagName) || target.isContentEditable || target.closest('[data-pose-editor]') || videoRef.current?.dataset.poseEditing === 'true') return;
      if (event.key === '[') { setMarkStart(currentMs); notify(`Start marked at ${formatTime(currentMs)}`); }
      if (event.key === ']') { setMarkEnd(currentMs); setShowNewPhrase(true); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); frameStep(event.shiftKey ? -10 : -1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); frameStep(event.shiftKey ? 10 : 1); }
      if (event.key === ' ') { event.preventDefault(); const video = videoRef.current; if (video) void (video.paused ? video.play() : video.pause()); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [currentMs, duration, bout?.media?.fps]);

  if (error) return <div className="page"><ErrorNotice error={error} /></div>;
  if (!bout || !dashboard) return <Spinner label="Opening the labeling room" />;
  return <PoseProvider bout={bout} currentMs={currentMs} videoRef={videoRef} onSeek={seek} onSaved={() => { notify('Pose keyframe saved'); void load(); }}><div className="labeler-page">
    {toast && <Toast message={toast} />}
    <header className="labeler-header"><div><Link to="/">← Library</Link><span>/</span><strong>{bout.title}</strong></div><div className="labeler-score"><span>{bout.leftFencer?.fullName || 'Left'} <b>{bout.leftScore}</b></span><i>:</i><span><b>{bout.rightScore}</b> {bout.rightFencer?.fullName || 'Right'}</span></div><div><span className={`review-chip ${bout.status}`}>{bout.status}</span><a className="quiet-button" href="/api/datasets/export">Export labels</a></div></header>
    <div className="labeler-workspace">
      <section className="video-column">
        <VideoStage bout={bout} ingestion={ingestion} currentMs={currentMs} duration={duration} videoRef={videoRef} onTime={setCurrentMs} onSeek={seek} onFrame={frameStep} />
        <div className="mark-toolbar"><div><button onClick={() => { setMarkStart(currentMs); notify('Phrase start marked'); }}><kbd>[</kbd><span>Mark start<strong>{markStart === null ? 'At playhead' : formatTime(markStart)}</strong></span></button><button onClick={() => { setMarkEnd(currentMs); if (markStart !== null && currentMs > markStart) setShowNewPhrase(true); }}><kbd>]</kbd><span>Mark end<strong>{markEnd === null ? 'At playhead' : formatTime(markEnd)}</strong></span></button></div><button className="primary-button" disabled={markStart === null || markEnd === null || markEnd <= markStart} onClick={() => setShowNewPhrase(true)}>Create phrase</button></div>
        <Timeline bout={bout} duration={duration} currentMs={currentMs} selectedId={selectedId} onSeek={seek} onSelect={setSelectedId} />
        <PhraseRail phrases={bout.phrases} selectedId={selectedId} onSelect={(id, start) => { setSelectedId(id); seek(start); }} onNew={() => setShowNewPhrase(true)} />
      </section>
      <aside className="inspector-column">
        {selected ? <><div className="inspector-title"><div><p className="eyebrow">PHRASE {selected.ordinal} · REV {selected.revision}</p><h2>{formatTime(selected.startMs)} — {formatTime(selected.endMs)}</h2></div><span className={`award-mark ${selected.award}`}>{selected.award === 'none' ? 'NO TOUCH' : selected.award === 'unknown' ? 'UNCALLED' : `${selected.award.toUpperCase()} +1`}</span></div>
          <div className="inspector-tabs"><button className={tab === 'call' ? 'active' : ''} onClick={() => setTab('call')}>Call</button><button className={tab === 'actions' ? 'active' : ''} onClick={() => setTab('actions')}>Actions <span>{selected.events.length}</span></button><button className={tab === 'geometry' ? 'active' : ''} onClick={() => setTab('geometry')}>Geometry <span>{bout.poses.filter((pose) => pose.timestampMs >= selected.startMs && pose.timestampMs <= selected.endMs).length}</span></button></div>
          {tab === 'call' && <PhraseCallForm phrase={selected} onSaved={() => { notify('Call saved'); void load(); }} onDeleted={() => { setSelectedId(null); notify('Phrase deleted'); void load(false); }} />}
          {tab === 'actions' && <EventEditor phrase={selected} actions={dashboard.actions} currentMs={currentMs} onSeek={seek} onSaved={() => { notify('Action timeline updated'); void load(); }} />}
          {tab === 'geometry' && <PosePanel />}
        </> : <PosePanel />}
      </aside>
    </div>
    {showNewPhrase && <NewPhraseModal bout={bout} startMs={markStart ?? currentMs} endMs={markEnd && markEnd > (markStart ?? currentMs) ? markEnd : Math.min(duration, (markStart ?? currentMs) + 2_000)} onClose={() => setShowNewPhrase(false)} onCreated={() => { setShowNewPhrase(false); setMarkStart(null); setMarkEnd(null); notify('Phrase created'); void load(false); }} />}
  </div></PoseProvider>;
}

function VideoStage({ bout, ingestion, currentMs, duration, videoRef, onTime, onSeek, onFrame }: { bout: BoutDetail; ingestion: IngestionJobRecord | null; currentMs: number; duration: number; videoRef: React.RefObject<HTMLVideoElement | null>; onTime: (value: number) => void; onSeek: (value: number) => void; onFrame: (amount: number) => void }) {
  const source = bout.media?.playbackUrl && (bout.media.objectKey || bout.media.playbackUrl.startsWith('/api/')) ? bout.media.playbackUrl : bout.media?.externalUrl?.match(/\.(mp4|webm|mov)(\?|$)/i) ? bout.media.externalUrl : null;
  const [isPlaying, setIsPlaying] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = stageRef.current; if (!element) return;
    const measure = () => element.closest<HTMLElement>('.labeler-page')?.style.setProperty('--video-stage-height', `${element.offsetHeight}px`);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => setIsPlaying(false), [source]);
  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    let handle = 0, disposed = false;
    const tick = (_now: number, meta: VideoFrameCallbackMetadata) => { if (disposed) return; onTime(meta.mediaTime * 1000); handle = video.requestVideoFrameCallback(tick); };
    if ('requestVideoFrameCallback' in video) handle = video.requestVideoFrameCallback(tick);
    return () => { disposed = true; if (handle) video.cancelVideoFrameCallback(handle); };
  }, [source, videoRef, onTime]);
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || video.dataset.poseEditing === 'true') return;
    if (video.paused || video.ended) void video.play();
    else video.pause();
  };
  const stage = typeof ingestion?.checkpoint.stage === 'string' ? ingestion.checkpoint.stage.replaceAll('-', ' ') : '';
  const pendingTitle = ingestion?.state === 'failed'
    ? 'Automatic capture needs attention'
    : ingestion?.state === 'uploading'
      ? 'Uploading the clipped bout'
      : ingestion?.state === 'capturing'
        ? 'Capturing the clipped bout'
        : ingestion?.state === 'discovered'
          ? 'Bout queued for automatic capture'
          : bout.media
            ? 'Source linked — training copy not attached'
            : 'Attach a video to label against footage';
  const pendingDetail = ingestion?.state === 'failed' ? ingestion.error : stage ? `Worker stage: ${stage}` : 'The sample timeline remains fully interactive.';
  return <div className="video-stage" ref={stageRef}>
    <div className="video-viewport">{source ? <video ref={videoRef} src={source} playsInline onPlay={() => { if (videoRef.current?.dataset.poseEditing === 'true') videoRef.current.pause(); else setIsPlaying(true); }} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onTimeUpdate={(event) => { if (event.currentTarget.paused) onTime(event.currentTarget.currentTime * 1_000); }} onSeeked={(event) => onTime(event.currentTarget.currentTime * 1_000)} onLoadedMetadata={(event) => { if (currentMs) event.currentTarget.currentTime = currentMs / 1_000; }} /> : <div className="video-placeholder"><div className="piste"><i /><span className="fencer-silhouette left">◢</span><span className="fencer-silhouette right">◣</span></div><strong>{pendingTitle}</strong><p>{pendingDetail}</p>{bout.sourceUrl && <a href={bout.sourceUrl} target="_blank" rel="noreferrer">Open FencingTV source ↗</a>}</div>}{source && <PoseOverlay />}</div>
    <PoseToolbar />
    <div className="video-controls"><button onClick={() => onFrame(-1)} aria-label="Previous frame">|‹</button><button className="play-button" onClick={togglePlayback} aria-label={isPlaying ? 'Pause video' : 'Play video'} title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button><button onClick={() => onFrame(1)} aria-label="Next frame">›|</button><strong>{formatTime(currentMs)}</strong><input aria-label="Video position" type="range" min={0} max={duration} step={1} value={Math.min(currentMs, duration)} onChange={(event) => onSeek(Number(event.target.value))} /><span>{formatTime(duration)}</span><small>{bout.media?.fps ? `${bout.media.fps.toFixed(2)} FPS` : '60 FPS working grid'}</small></div>
  </div>;
}

function Timeline({ bout, duration, currentMs, selectedId, onSeek, onSelect }: { bout: BoutDetail; duration: number; currentMs: number; selectedId: string | null; onSeek: (value: number) => void; onSelect: (value: string) => void }) {
  const position = (ms: number) => `${Math.min(100, Math.max(0, (ms / duration) * 100))}%`;
  function click(event: MouseEvent<HTMLDivElement>) {
    const track = event.currentTarget.querySelector<HTMLElement>('.timeline-lane')?.getBoundingClientRect();
    if (!track) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - track.left) / track.width));
    onSeek(ratio * duration);
  }
  return <div className="timeline-wrap"><div className="timeline-ruler">{Array.from({ length: 7 }, (_, index) => <span key={index} style={{ left: `${(index / 6) * 100}%` }}>{formatTime((index / 6) * duration, false)}</span>)}</div><div className="timeline" onClick={click}>
    <div className="timeline-lane phrases-lane"><label>PHRASES</label>{bout.phrases.map((phrase) => <button key={phrase.id} className={`${phrase.id === selectedId ? 'selected' : ''} ${phrase.award}`} style={{ left: position(phrase.startMs), width: `max(5px, ${((phrase.endMs - phrase.startMs) / duration) * 100}%)` }} onClick={(event) => { event.stopPropagation(); onSelect(phrase.id); onSeek(phrase.startMs); }} title={`Phrase ${phrase.ordinal}: ${phrase.award}`}><span>{phrase.ordinal}</span></button>)}</div>
    <div className="timeline-lane event-lane"><label>EVENTS</label>{bout.phrases.flatMap((phrase) => phrase.events).map((event) => <i key={event.id} className={event.kind} style={{ left: position(event.timestampMs) }} title={`${event.actionLabel} · ${formatTime(event.timestampMs)}`} />)}</div>
    <div className="timeline-lane pose-lane"><label>POSE</label>{bout.poses.map((pose) => <i key={pose.id} className={pose.side} style={{ left: position(pose.timestampMs) }} title={`${pose.side} pose · ${formatTime(pose.timestampMs)}`} />)}</div>
    <div className="timeline-playhead-track"><div className="playhead" style={{ left: position(currentMs) }}><span /></div></div>
  </div></div>;
}

function PhraseRail({ phrases, selectedId, onSelect, onNew }: { phrases: PhraseRecord[]; selectedId: string | null; onSelect: (id: string, start: number) => void; onNew: () => void }) {
  return <div className="phrase-rail"><div className="phrase-rail-heading"><div><p className="eyebrow">SEGMENTATION</p><h3>{phrases.length} phrase{phrases.length === 1 ? '' : 's'}</h3></div><button onClick={onNew}>+ Manual phrase</button></div><div className="phrase-strip">{phrases.map((phrase) => <button className={phrase.id === selectedId ? 'active' : ''} key={phrase.id} onClick={() => onSelect(phrase.id, phrase.startMs)}><span>{phrase.ordinal.toString().padStart(2, '0')}</span><div><strong>{formatTime(phrase.startMs)}–{formatTime(phrase.endMs)}</strong><small>{label(phrase.endReason)}</small></div><i className={phrase.reviewState}>{phrase.reviewState === 'draft' ? '○' : '✓'}</i></button>)}</div></div>;
}

function scoreDefaults(bout: BoutDetail) {
  const last = bout.phrases.at(-1);
  return last?.scoreAfter ?? { left: 0, right: 0 };
}

function NewPhraseModal({ bout, startMs, endMs, onClose, onCreated }: { bout: BoutDetail; startMs: number; endMs: number; onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const scores = scoreDefaults(bout);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); const start = Math.round(Number(form.get('startMs'))); const end = Math.round(Number(form.get('endMs'))); try { await api.createPhrase(bout.id, { startMs: start, endMs: end, startFrame: Math.round(start * (bout.media?.fps || 60) / 1_000), endFrame: Math.round(end * (bout.media?.fps || 60) / 1_000), startReason: form.get('startReason') as PhraseInput['startReason'], endReason: form.get('endReason') as PhraseInput['endReason'], haltReason: String(form.get('haltReason') || ''), award: 'unknown', callStatus: 'not-called', callExplanation: '', ruleRefs: [], reviewState: 'draft', scoreBefore: scores, scoreAfter: scores }); onCreated(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create phrase'); setBusy(false); } }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><form className="modal-card wide" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">NEW PHRASE</p><h2>Confirm boundaries</h2><div className="form-row"><label>Start (ms)<input name="startMs" type="number" min={0} defaultValue={Math.round(Math.min(startMs, endMs - 1))} required /></label><label>End (ms)<input name="endMs" type="number" min={1} defaultValue={Math.round(Math.max(endMs, startMs + 1))} required /></label></div><div className="form-row"><label>Start reason<select name="startReason" defaultValue="play-command">{startReasons.map((reason) => <option value={reason} key={reason}>{label(reason)}</option>)}</select></label><label>End reason<select name="endReason" defaultValue="touch-registered">{endReasons.map((reason) => <option value={reason} key={reason}>{label(reason)}</option>)}</select></label></div><label>Halt context<textarea name="haltReason" rows={2} placeholder="Required context for violations, equipment, or no-touch halts" /></label><p className="hint-box">The phrase starts as uncalled. Review the evidence and score in the Call tab.</p>{error && <p className="field-error">{error}</p>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Creating…' : 'Create phrase'}</button></form></div>;
}

function PhraseCallForm({ phrase, onSaved, onDeleted }: { phrase: PhraseRecord; onSaved: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [footerDocked, setFooterDocked] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const observer = new IntersectionObserver(([entry]) => setFooterDocked(entry.isIntersecting && entry.intersectionRatio >= .05), { threshold: [.05] });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); const award = form.get('award') as PhraseInput['award']; const before = { left: Number(form.get('leftBefore')), right: Number(form.get('rightBefore')) }; const after = { left: Number(form.get('leftAfter')), right: Number(form.get('rightAfter')) }; const input: PhraseInput = { startMs: Number(form.get('startMs')), endMs: Number(form.get('endMs')), startFrame: phrase.startFrame, endFrame: phrase.endFrame, startReason: form.get('startReason') as PhraseInput['startReason'], endReason: form.get('endReason') as PhraseInput['endReason'], haltReason: String(form.get('haltReason') || ''), award, callStatus: form.get('callStatus') as PhraseInput['callStatus'], callExplanation: String(form.get('callExplanation') || ''), ruleRefs: refs(String(form.get('ruleRefs') || '')), reviewState: form.get('reviewState') as PhraseInput['reviewState'], scoreBefore: before, scoreAfter: after }; try { await api.updatePhrase(phrase.id, input); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save call'); } finally { setBusy(false); } }
  async function remove() { if (!window.confirm(`Delete phrase ${phrase.ordinal} and all of its action labels?`)) return; try { await api.deletePhrase(phrase.id); onDeleted(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete phrase'); } }
  return <form ref={formRef} className={`inspector-form ${footerDocked ? 'footer-docked' : ''}`} onSubmit={submit} key={`${phrase.id}-${phrase.revision}`}><div className="inspector-form-body"><section><h3>Boundaries</h3><div className="form-row"><label>Start ms<input name="startMs" type="number" defaultValue={phrase.startMs} /></label><label>End ms<input name="endMs" type="number" defaultValue={phrase.endMs} /></label></div><div className="form-row"><label>Start reason<select name="startReason" defaultValue={phrase.startReason}>{startReasons.map((reason) => <option key={reason} value={reason}>{label(reason)}</option>)}</select></label><label>End reason<select name="endReason" defaultValue={phrase.endReason}>{endReasons.map((reason) => <option key={reason} value={reason}>{label(reason)}</option>)}</select></label></div><label>Why did fencing halt?<textarea name="haltReason" defaultValue={phrase.haltReason} rows={2} placeholder="Touch, referee Halt, crossing feet, equipment…" /></label></section>
    <section><h3>Outcome</h3><div className="award-options">{(['left', 'right', 'none', 'unknown'] as const).map((award) => <label key={award}><input type="radio" name="award" value={award} defaultChecked={phrase.award === award} /><span>{award === 'none' ? 'No touch' : label(award)}</span></label>)}</div><div className="score-editor"><span>SCORE</span><label>L <input name="leftBefore" type="number" min={0} defaultValue={phrase.scoreBefore.left} /></label><i>→</i><label><input aria-label="Left score after" name="leftAfter" type="number" min={0} defaultValue={phrase.scoreAfter.left} /></label><label>R <input name="rightBefore" type="number" min={0} defaultValue={phrase.scoreBefore.right} /></label><i>→</i><label><input aria-label="Right score after" name="rightAfter" type="number" min={0} defaultValue={phrase.scoreAfter.right} /></label></div></section>
    <section><h3>Referee analysis</h3><label>Call source<select name="callStatus" defaultValue={phrase.callStatus}><option value="not-called">Not called</option><option value="observed-referee">Observed referee</option><option value="analyst-call">My analyst call</option><option value="model-proposal">Model proposal</option></select></label><label>Explain the call<textarea name="callExplanation" rows={5} defaultValue={phrase.callExplanation} placeholder="What happened, in order, and why does that determine priority?" /></label><label>Rule references<input name="ruleRefs" defaultValue={phrase.ruleRefs.join(', ')} placeholder="t.101, t.106" /></label><Link className="inline-link" to={`/rules?q=${encodeURIComponent(phrase.callExplanation)}`}>Open supporting rules →</Link></section>
    <section><h3>Review state</h3><label>Ground-truth status<select name="reviewState" defaultValue={phrase.reviewState}><option value="draft">Draft — excluded from final ground truth</option><option value="reviewed">Reviewed — human confirmed</option><option value="adjudicated">Adjudicated — second opinion resolved</option></select></label><p className="hint-box">Reviewed labels require an explicit award or no-touch outcome, explanation, and at least one rule reference.</p></section>{error && <p className="field-error">{error}</p>}</div><div className="sticky-save"><button type="button" className="danger-button" onClick={remove}>Delete</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save phrase'}</button></div>
  </form>;
}

function EventEditor({ phrase, actions, currentMs, onSeek, onSaved }: { phrase: PhraseRecord; actions: ActionDefinition[]; currentMs: number; onSeek: (value: number) => void; onSaved: () => void }) {
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState('');
  async function remove(id: string) { try { await api.deleteEvent(id); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not remove action'); } }
  return <div className="event-editor"><div className="event-toolbar"><p>Label preparation, footwork, blade actions, priority transitions, lights, and referee events.</p><button className="primary-button" onClick={() => { setEditing(null); setShowForm(true); }}>+ Action at {formatTime(currentMs)}</button></div>{error && <p className="field-error">{error}</p>}
    <div className="event-list">{phrase.events.length ? phrase.events.map((event) => <article key={event.id} className={event.kind}><button className="event-time" onClick={() => onSeek(event.timestampMs)}>{formatTime(event.timestampMs)}</button><div><span className={`actor-chip ${event.actor}`}>{event.actor}</span><strong>{event.actionLabel}</strong><small>{event.evidence || 'No evidence note'}</small>{event.priorityBefore !== event.priorityAfter && <em>{event.priorityBefore} → {event.priorityAfter}</em>}</div><div className="event-actions"><button onClick={() => { setEditing(event.id); setShowForm(true); }}>Edit</button><button onClick={() => void remove(event.id)}>×</button></div></article>) : <div className="empty-mini"><span>⌁</span><p>No actions labeled in this phrase yet.</p></div>}</div>
    {showForm && <EventModal phrase={phrase} actions={actions} currentMs={currentMs} eventId={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); onSaved(); }} />}
  </div>;
}

function EventModal({ phrase, actions, currentMs, eventId, onClose, onSaved }: { phrase: PhraseRecord; actions: ActionDefinition[]; currentMs: number; eventId: string | null; onClose: () => void; onSaved: () => void }) {
  const existing = phrase.events.find((event) => event.id === eventId); const [category, setCategory] = useState(existing?.kind ?? 'preparation'); const [actionId, setActionId] = useState(existing?.actionId ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const filtered = actions.filter((action) => action.active && action.category === category);
  useEffect(() => { if (!existing && !filtered.some((action) => action.id === actionId)) setActionId(filtered[0]?.id ?? ''); }, [category]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); const action = actions.find((item) => item.id === actionId); const input: PhraseEventInput = { timestampMs: Number(form.get('timestampMs')), frameNumber: null, kind: category, actor: form.get('actor') as PhraseEventInput['actor'], actionId: action?.id ?? null, actionLabel: action?.label ?? String(form.get('customLabel') || ''), priorityBefore: form.get('priorityBefore') as PhraseEventInput['priorityBefore'], priorityAfter: form.get('priorityAfter') as PhraseEventInput['priorityAfter'], evidence: String(form.get('evidence') || ''), ruleRefs: refs(String(form.get('ruleRefs') || '')), confidence: null, source: 'human' }; try { if (existing) await api.updateEvent(existing.id, input); else await api.createEvent(phrase.id, input); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save action'); setBusy(false); } }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><form className="modal-card wide" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">{existing ? 'EDIT TIMELINE EVENT' : 'NEW TIMELINE EVENT'}</p><h2>{existing?.actionLabel || 'What happens here?'}</h2><div className="form-row"><label>Timestamp (ms)<input type="number" name="timestampMs" min={phrase.startMs} max={phrase.endMs} defaultValue={existing?.timestampMs ?? Math.max(phrase.startMs, Math.min(phrase.endMs, Math.round(currentMs)))} /></label><label>Actor<select name="actor" defaultValue={existing?.actor ?? 'left'}>{actors.map((actor) => <option key={actor}>{actor}</option>)}</select></label></div><label>Category<select value={category} onChange={(event) => setCategory(event.target.value as ActionDefinition['category'])}>{['preparation', 'footwork', 'blade', 'attack', 'defense', 'priority', 'hit', 'referee', 'violation'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Action<select value={actionId} onChange={(event) => setActionId(event.target.value)}><option value="">Custom label…</option>{filtered.map((action) => <option value={action.id} key={action.id}>{action.label}</option>)}</select></label>{!actionId && <label>Custom action label<input name="customLabel" defaultValue={existing?.actionLabel ?? ''} required /></label>}<div className="form-row"><label>Priority before<select name="priorityBefore" defaultValue={existing?.priorityBefore ?? 'unclear'}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label><label>Priority after<select name="priorityAfter" defaultValue={existing?.priorityAfter ?? 'unclear'}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label></div><label>Visible evidence<textarea name="evidence" rows={3} defaultValue={existing?.evidence ?? ''} placeholder="Describe what is actually visible before interpreting it." /></label><label>Rule references<input name="ruleRefs" defaultValue={existing?.ruleRefs.join(', ') ?? ''} placeholder="t.102.2, t.104" /></label>{error && <p className="field-error">{error}</p>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Saving…' : 'Save timeline event'}</button></form></div>;
}
