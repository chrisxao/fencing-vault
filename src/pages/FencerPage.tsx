import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FencerStats } from '../../shared/api.ts';
import { api } from '../api.ts';
import { ErrorNotice, Spinner } from '../components/Feedback.tsx';
import { PageHeader } from '../components/Layout.tsx';

export function FencerPage() {
  const { fencerId = '' } = useParams(); const [stats, setStats] = useState<FencerStats | null>(null); const [error, setError] = useState<unknown>();
  useEffect(() => { api.fencerStats(fencerId).then(setStats).catch(setError); }, [fencerId]);
  if (error) return <div className="page"><ErrorNotice error={error} /></div>;
  if (!stats) return <Spinner label="Calculating fencer statistics" />;
  const t = stats.totals;
  return <div className="page">
    <PageHeader eyebrow={`${stats.fencer.countryCode || 'UNAFFILIATED'} · ${stats.fencer.dominantHand.toUpperCase()} HAND`} title={stats.fencer.fullName}><p>Performance across every labeled bout and reviewed phrase.</p></PageHeader>
    <section className="metric-grid stats-metrics">
      <article className="metric-card accent"><div><span>TOUCHES SCORED</span><strong>{t.touchesScored}</strong></div><p>{t.scoringRate === null ? 'No decisive phrases' : `${Math.round(t.scoringRate * 100)}% of decisive phrases`}</p></article>
      <article className="metric-card"><div><span>TOUCHES RECEIVED</span><strong>{t.touchesReceived}</strong></div><p>Across {t.bouts} bout{t.bouts === 1 ? '' : 's'}</p></article>
      <article className="metric-card"><div><span>ATTACK SCORES</span><strong>{t.attackScores}</strong></div><p>{t.attackAttempts} labeled attempts</p></article>
      <article className="metric-card"><div><span>DEFENSE SCORES</span><strong>{t.defenseScores}</strong></div><p>{t.priorityGained} priority gains</p></article>
    </section>
    <div className="two-column stats-columns">
      <section className="section-block compact"><div className="section-heading"><div><p className="eyebrow">TACTICAL PROFILE</p><h2>Most frequent actions</h2></div></div>
        <div className="bar-list">{stats.actions.length ? stats.actions.slice(0, 12).map((action) => <div key={action.label}><span>{action.label}</span><div><i style={{ width: `${(action.count / stats.actions[0].count) * 100}%` }} /></div><b>{action.count}</b></div>) : <p className="muted">Label actions to build this profile.</p>}</div>
      </section>
      <section className="section-block compact"><div className="section-heading"><div><p className="eyebrow">BOUT HISTORY</p><h2>Results in the library</h2></div></div>
        <div className="bout-stat-list">{stats.bouts.map((bout) => <Link to={`/bouts/${bout.boutId}`} key={bout.boutId}><div><strong>{bout.title}</strong><small>{bout.noTouch} no-touch phrase{bout.noTouch === 1 ? '' : 's'}</small></div><span>{bout.scored}<em>–</em>{bout.received}</span></Link>)}</div>
      </section>
    </div>
  </div>;
}
