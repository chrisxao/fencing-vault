import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardData } from '../../shared/api.ts';
import { api, formatTime } from '../api.ts';
import { ErrorNotice, Spinner, Toast } from '../components/Feedback.tsx';
import { EmptyState, PageHeader } from '../components/Layout.tsx';

type CreateKind = 'fencer' | 'team' | null;

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<unknown>();
  const [createKind, setCreateKind] = useState<CreateKind>(null);
  const [toast, setToast] = useState('');
  const load = () => api.dashboard().then(setData).catch(setError);
  useEffect(() => { void load(); }, []);
  if (error) return <div className="page"><ErrorNotice error={error} action={<button onClick={load}>Try again</button>} /></div>;
  if (!data) return <Spinner label="Loading bout intelligence" />;
  const phraseProgress = data.totals.phrases ? Math.round((data.totals.reviewedPhrases / data.totals.phrases) * 100) : 0;
  return (
    <div className="page dashboard-page">
      {toast && <Toast message={toast} />}
      <PageHeader eyebrow="SABRE INTELLIGENCE" title="Overview" actions={<Link className="primary-button" to="/import">+ Add video</Link>}>
        <p>Label the phrase, preserve the evidence, then turn it into useful fencing.</p>
      </PageHeader>
      {data.demoMode && <div className="demo-banner"><span>DEMO DATA</span> You’re seeing a fictional sample bout. Add PostgreSQL to persist your own library.</div>}

      <section className="metric-grid">
        <article className="metric-card accent"><div><span>BOUTS</span><strong>{data.totals.bouts}</strong></div><i>↗</i><p>{data.totals.reviewedBouts} fully reviewed</p></article>
        <article className="metric-card"><div><span>PHRASES</span><strong>{data.totals.phrases}</strong></div><i>⌁</i><p>{data.totals.reviewedPhrases} calls confirmed</p></article>
        <article className="metric-card"><div><span>REVIEWED</span><strong>{phraseProgress}%</strong></div><i>✓</i><p>Human-grounded labels</p></article>
        <article className="metric-card"><div><span>POSE FRAMES</span><strong>{data.totals.labeledPoseFrames}</strong></div><i>◇</i><p>Fencer + weapon anchors</p></article>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">RECENT WORK</p><h2>Bout library</h2></div><Link to="/import">Import from FencingTV <span>→</span></Link></div>
        {data.bouts.length ? <div className="bout-grid">{data.bouts.map((bout) => (
          <Link className="bout-card" to={`/bouts/${bout.id}`} key={bout.id}>
            <div className="bout-card-top"><span className={`source-badge ${bout.sourceProvider}`}>{bout.sourceProvider}</span><span>{bout.status}</span></div>
            <p className="bout-event">{bout.tournamentName || 'Independent bout'} · {bout.round || 'Round unlisted'}</p>
            <div className="matchup">
              <div><span className="country">{bout.leftFencer?.countryCode || '—'}</span><strong>{bout.leftFencer?.fullName || 'Left fencer'}</strong></div>
              <div className="score"><b>{bout.leftScore}</b><em>:</em><b>{bout.rightScore}</b></div>
              <div className="right"><span className="country">{bout.rightFencer?.countryCode || '—'}</span><strong>{bout.rightFencer?.fullName || 'Right fencer'}</strong></div>
            </div>
            <div className="bout-progress"><span style={{ width: `${bout.phraseCount ? (bout.reviewedPhraseCount / bout.phraseCount) * 100 : 0}%` }} /></div>
            <footer><span>{bout.reviewedPhraseCount}/{bout.phraseCount} phrases reviewed</span><span>{bout.durationMs ? formatTime(bout.durationMs, false) : 'No video timing'} · Open labeler →</span></footer>
          </Link>
        ))}</div> : <EmptyState title="No bouts yet">Import a FencingTV link or upload your first video to begin.</EmptyState>}
      </section>

      <div className="two-column">
        <section className="section-block compact">
          <div className="section-heading"><div><p className="eyebrow">ATHLETES</p><h2>Fencers</h2></div><button className="quiet-button" onClick={() => setCreateKind('fencer')}>+ Add</button></div>
          <div className="profile-list">{data.fencers.map((fencer) => <Link to={`/fencers/${fencer.id}`} key={fencer.id}>
            <span className="avatar">{fencer.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><div><strong>{fencer.fullName}</strong><small>{fencer.countryCode || 'Country unknown'} · {fencer.dominantHand}-handed</small></div><i>→</i>
          </Link>)}</div>
        </section>
        <section className="section-block compact">
          <div className="section-heading"><div><p className="eyebrow">TEAMS</p><h2>Countries & clubs</h2></div><button className="quiet-button" onClick={() => setCreateKind('team')}>+ Add</button></div>
          <div className="profile-list">{data.teams.map((team) => <Link className="team-row" to={`/teams/${team.id}`} key={team.id}>
            <span className="avatar team-avatar">{team.countryCode || team.name.slice(0, 2).toUpperCase()}</span><div><strong>{team.name}</strong><small>{team.kind} · {team.memberCount} member{team.memberCount === 1 ? '' : 's'}</small></div>
          </Link>)}</div>
        </section>
      </div>
      {createKind && <CreateProfile kind={createKind} onClose={() => setCreateKind(null)} onCreated={() => { setCreateKind(null); setToast(`${createKind === 'fencer' ? 'Fencer' : 'Team'} added`); void load(); setTimeout(() => setToast(''), 2500); }} />}
    </div>
  );
}

function CreateProfile({ kind, onClose, onCreated }: { kind: Exclude<CreateKind, null>; onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (kind === 'fencer') await api.createFencer({ fullName: form.get('name'), countryCode: form.get('country'), dominantHand: form.get('hand'), fieId: '', usaFencingId: '', notes: '' });
      else await api.createTeam({ name: form.get('name'), countryCode: form.get('country'), kind: form.get('kind'), notes: '' });
      onCreated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save'); setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><form className="modal-card" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">NEW {kind.toUpperCase()}</p><h2>Add {kind}</h2>
    <label>{kind === 'fencer' ? 'Full name' : 'Team name'}<input name="name" required autoFocus /></label>
    <label>Country code<input name="country" maxLength={3} placeholder="USA" /></label>
    {kind === 'fencer' ? <label>Dominant hand<select name="hand"><option value="unknown">Unknown</option><option value="right">Right</option><option value="left">Left</option></select></label> : <label>Type<select name="kind"><option value="national">National</option><option value="club">Club</option><option value="school">School</option><option value="other">Other</option></select></label>}
    {error && <p className="field-error">{error}</p>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Saving…' : `Add ${kind}`}</button>
  </form></div>;
}
