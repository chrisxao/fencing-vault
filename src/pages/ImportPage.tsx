import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardData } from '../../shared/api.ts';
import { api } from '../api.ts';
import { ErrorNotice, Spinner } from '../components/Feedback.tsx';
import { PageHeader } from '../components/Layout.tsx';

type Config = Awaited<ReturnType<typeof api.config>>;
type SourceMode = 'fencingtv' | 'upload' | 'recording';

export function ImportPage() {
  const [config, setConfig] = useState<Config | null>(null); const [dashboard, setDashboard] = useState<DashboardData | null>(null); const [mode, setMode] = useState<SourceMode>('fencingtv'); const [error, setError] = useState<unknown>();
  useEffect(() => { Promise.all([api.config(), api.dashboard()]).then(([nextConfig, data]) => { setConfig(nextConfig); setDashboard(data); }).catch(setError); }, []);
  if (error) return <div className="page"><ErrorNotice error={error} /></div>; if (!config || !dashboard) return <Spinner label="Preparing video import" />;
  return <div className="page import-page">
    <PageHeader eyebrow="VIDEO INTAKE" title="Add footage"><p>Bring one bout into a stable, frame-addressable workspace before labeling.</p></PageHeader>
    <div className="source-tabs"><button className={mode === 'fencingtv' ? 'active' : ''} onClick={() => setMode('fencingtv')}><span>F</span><div><strong>FencingTV</strong><small>Link or private capture</small></div></button><button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}><span>↑</span><div><strong>Video upload</strong><small>MP4, MOV, or WebM</small></div></button><button className={mode === 'recording' ? 'active' : ''} onClick={() => setMode('recording')}><span>◉</span><div><strong>Screen recording</strong><small>Upload a personal capture</small></div></button></div>
    {mode === 'fencingtv' ? <FencingTvForm dashboard={dashboard} config={config} /> : <UploadForm dashboard={dashboard} config={config} recording={mode === 'recording'} />}
    <section className="intake-principles"><article><span>01</span><div><strong>Preserve the source</strong><p>The original video stays immutable. Labels point to exact milliseconds and frames.</p></div></article><article><span>02</span><div><strong>Normalize once</strong><p>The worker records frame rate, resolution, timestamps, and a proxy for fast seeking.</p></div></article><article><span>03</span><div><strong>Keep provenance</strong><p>Source URL, capture method, checksum, and every human revision travel with the dataset.</p></div></article></section>
  </div>;
}

function PersonSelects({ data }: { data: DashboardData }) {
  return <div className="form-row"><label>Left fencer<select name="leftFencerId"><option value="">Unassigned</option>{data.fencers.map((fencer) => <option value={fencer.id} key={fencer.id}>{fencer.fullName}</option>)}</select></label><label>Right fencer<select name="rightFencerId"><option value="">Unassigned</option>{data.fencers.map((fencer) => <option value={fencer.id} key={fencer.id}>{fencer.fullName}</option>)}</select></label></div>;
}

function metadata(form: FormData) {
  const nullable = (name: string) => String(form.get(name) || '') || null;
  return { title: String(form.get('title') || ''), tournamentName: String(form.get('tournamentName') || ''), tournamentDate: nullable('tournamentDate'), round: String(form.get('round') || ''), leftFencerId: nullable('leftFencerId'), rightFencerId: nullable('rightFencerId') };
}

function captureTimestamp(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error('Use MM:SS or HH:MM:SS for the bout timestamps');
  }
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (minutes >= 60 || seconds >= 60) throw new Error('Minutes and seconds must be below 60');
  return Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1_000);
}

function FencingTvForm({ dashboard, config }: { dashboard: DashboardData; config: Config }) {
  const navigate = useNavigate(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [captureMode, setCaptureMode] = useState('link-only');
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); try { const captureStartMs = captureTimestamp(form.get('captureStart')); const captureEndMs = captureTimestamp(form.get('captureEnd')); const result = await api.importFencingTv({ ...metadata(form), url: form.get('url'), captureMode, captureStartMs, captureEndMs }); navigate(`/bouts/${result.bout.id}`); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Import failed'); setBusy(false); } }
  return <><FencingTvCatalog onChoose={(url, title) => { const urlInput = document.querySelector<HTMLInputElement>('#fencingtv-url'); const titleInput = document.querySelector<HTMLInputElement>('#fencingtv-title'); if (urlInput) urlInput.value = url; if (titleInput && !titleInput.value) titleInput.value = title; }} /><form className="intake-card" onSubmit={submit}><div className="intake-card-heading"><div className="source-logo">F</div><div><p className="eyebrow">PERSONAL-USE WORKFLOW</p><h2>FencingTV reference</h2><p>Paste a bout, competition, or video detail URL. The source stays traceable even if you capture a local training copy later.</p></div></div>
    <label>FencingTV URL<input id="fencingtv-url" name="url" type="url" required placeholder="https://fencingtv.com/competitions/…/bouts/…" /></label><label>Bout title<input id="fencingtv-title" name="title" required placeholder="Fencer A vs Fencer B" /></label><div className="form-row"><label>Tournament<input name="tournamentName" placeholder="Orléans Grand Prix" /></label><label>Date<input name="tournamentDate" type="date" /></label><label>Round<input name="round" placeholder="Table of 16" /></label></div><PersonSelects data={dashboard} />
    <section className="capture-window"><div><strong>Clip this bout from the piste recording</strong><small>Enter the times shown in the full-day FencingTV player. Automatic capture uploads only this window.</small></div><div className="form-row"><label>Bout starts at<input name="captureStart" placeholder="HH:MM:SS" required={captureMode === 'browser-session'} /></label><label>Bout ends at<input name="captureEnd" placeholder="HH:MM:SS" required={captureMode === 'browser-session'} /></label></div></section>
    <fieldset className="capture-options"><legend>How should this enter the studio?</legend><label><input type="radio" name="captureMode" value="link-only" checked={captureMode === 'link-only'} onChange={() => setCaptureMode('link-only')} /><span><strong>Reference now</strong><small>Create the bout and keep the link; attach video later.</small></span></label><label><input type="radio" name="captureMode" value="browser-session" checked={captureMode === 'browser-session'} onChange={() => setCaptureMode('browser-session')} disabled={!config.fencingTvCaptureEnabled} /><span><strong>Automatic private capture</strong><small>{config.fencingTvCaptureEnabled ? 'Queue this time window for the authenticated worker.' : 'Worker setup is incomplete; use a reference or screen recording for now.'}</small></span></label><label><input type="radio" name="captureMode" value="screen-recording" checked={captureMode === 'screen-recording'} onChange={() => setCaptureMode('screen-recording')} /><span><strong>I’ll upload a screen recording</strong><small>Create a pending recording slot and continue.</small></span></label></fieldset>
    {error && <p className="field-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Creating intake job…' : 'Create bout'} <span>→</span></button>
  </form></>;
}

function FencingTvCatalog({ onChoose }: { onChoose: (url: string, title: string) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.discoverFencingTv>> | null>(null); const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !items) api.discoverFencingTv('', 'competition').then(setItems).catch(() => setItems({ available: false, items: [], message: 'Public discovery is unavailable right now.' })); }, [open, items]);
  return <section className="catalog-panel"><div><div><p className="eyebrow">CURRENT & COMPLETED EVENTS</p><h3>Browse the public catalog</h3></div><div><a href="https://fencingtv.com/competitions" target="_blank" rel="noreferrer">Open calendar ↗</a><button onClick={() => setOpen((value) => !value)}>{open ? 'Hide catalog' : 'Load catalog'}</button></div></div>{open && <div className="catalog-items">{!items ? <p>Reading public events…</p> : items.items.length ? items.items.slice(0, 16).map((item) => <button key={item.url} onClick={() => { onChoose(item.url, item.title); setOpen(false); }}><span>{item.kind}</span><strong>{item.title}</strong><i>Use →</i></button>) : <p>{items.message}</p>}</div>}</section>;
}

function UploadForm({ dashboard, config, recording }: { dashboard: DashboardData; config: Config; recording: boolean }) {
  const navigate = useNavigate(); const inputRef = useRef<HTMLInputElement>(null); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [error, setError] = useState('');
  async function uploadToSignedUrl(url: string, video: File) {
    await new Promise<void>((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('PUT', url); xhr.setRequestHeader('Content-Type', video.type || 'video/mp4'); xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100)); }; xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Object storage returned ${xhr.status}`)); xhr.onerror = () => reject(new Error('Upload connection failed')); xhr.send(video); });
  }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!file) { setError('Choose a video file first'); return; } if (!config.storageConfigured) { setError('Object storage is not configured. Add Railway Bucket variables or S3 credentials first.'); return; } setBusy(true); setError(''); try { const form = new FormData(event.currentTarget); const bout = await api.createBout({ ...metadata(form), sourceProvider: recording ? 'screen-recording' : 'upload', sourceUrl: null, status: 'queued' }); const signed = await api.presignUpload(bout.id, { filename: file.name, contentType: file.type || 'video/mp4', sizeBytes: file.size }); await uploadToSignedUrl(signed.uploadUrl, file); await api.attachMedia(bout.id, { kind: recording ? 'screen-recording' : 'uploaded', objectKey: signed.objectKey, externalUrl: null, filename: file.name, mimeType: file.type || 'video/mp4', sizeBytes: file.size, status: 'ready' }); navigate(`/bouts/${bout.id}`); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Upload failed'); setBusy(false); } }
  return <form className="intake-card" onSubmit={submit}><div className="intake-card-heading"><div className="source-logo">{recording ? '◉' : '↑'}</div><div><p className="eyebrow">DIRECT TO OBJECT STORAGE</p><h2>{recording ? 'Screen recording' : 'Video file'}</h2><p>Your browser sends the file directly to the bucket; the web service never buffers the video.</p></div></div>
    <button type="button" className={`drop-zone ${file ? 'has-file' : ''}`} onClick={() => inputRef.current?.click()}><input ref={inputRef} hidden type="file" accept="video/*,.mov,.mkv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />{file ? <><span>✓</span><strong>{file.name}</strong><small>{(file.size / 1_048_576).toFixed(1)} MB · Click to replace</small></> : <><span>↑</span><strong>Choose a video</strong><small>MP4, MOV, MKV, or WebM · up to {(config.maxUploadBytes / 1_073_741_824).toFixed(0)} GB</small></>}</button>
    <label>Bout title<input name="title" required placeholder="Fencer A vs Fencer B" /></label><div className="form-row"><label>Tournament<input name="tournamentName" /></label><label>Date<input name="tournamentDate" type="date" /></label><label>Round<input name="round" /></label></div><PersonSelects data={dashboard} />{busy && <div className="upload-progress"><div><span style={{ width: `${progress}%` }} /></div><strong>{progress}% uploaded</strong></div>}{error && <p className="field-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Uploading…' : 'Upload and open labeler'} <span>→</span></button>
  </form>;
}
