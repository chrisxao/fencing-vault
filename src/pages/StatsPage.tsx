import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { User } from '@instantdb/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { db } from '../lib/db';
import { WEAPONS } from '../lib/labels';
import {
  PERIODS,
  categoryBreakdown,
  filterTouches,
  flattenTouches,
  labelBreakdown,
  monthlyTrend,
  strengthsAndWeaknesses,
  type Period,
} from '../lib/stats';

type ChartType = 'bar' | 'pie' | 'radar' | 'trend';

const CHART_TYPES: { id: ChartType; name: string }[] = [
  { id: 'bar', name: 'Bar' },
  { id: 'pie', name: 'Pie' },
  { id: 'radar', name: 'Radar' },
  { id: 'trend', name: 'Trend' },
];

const TOOLTIP_STYLE = {
  backgroundColor: '#1c1c22',
  border: '1px solid #33333d',
  borderRadius: 8,
  color: '#e7e7ee',
};

export default function StatsPage({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const [weapon, setWeapon] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [chart, setChart] = useState<ChartType>('bar');
  const videoId = params.get('video') ?? '';

  const { isLoading, error, data } = db.useQuery({
    videos: {
      $: { where: { 'owner.id': user.id } },
      segments: { labels: {} },
    },
  });

  const touches = useMemo(() => (data ? flattenTouches(data.videos) : []), [data]);
  const filtered = useMemo(
    () => filterTouches(touches, { videoId: videoId || undefined, weapon: weapon || undefined, period }),
    [touches, videoId, weapon, period],
  );
  const byCategory = useMemo(() => categoryBreakdown(filtered), [filtered]);
  const byLabel = useMemo(() => labelBreakdown(filtered), [filtered]);
  const trend = useMemo(() => monthlyTrend(filtered), [filtered]);
  const sw = useMemo(() => strengthsAndWeaknesses(byCategory), [byCategory]);

  if (isLoading) return <div className="fullscreen-note">Loading stats…</div>;
  if (error) return <div className="fullscreen-note">Error: {error.message}</div>;

  const videos = data.videos;
  const scored = filtered.filter((t) => t.result === 'scored' || t.result === 'double').length;
  const received = filtered.filter((t) => t.result === 'received' || t.result === 'double').length;
  const withCategory = byCategory.filter((c) => c.total > 0);

  return (
    <div className="stats-page">
      <div className="page-head">
        <div>
          <h1>Stats</h1>
          <p className="muted">
            {filtered.length} touches · {scored} scored · {received} received
            {scored + received > 0 && ` · ${Math.round((scored / (scored + received)) * 100)}% success`}
          </p>
        </div>
      </div>

      <div className="filters">
        <label className="filter">
          <span>Video</span>
          <select
            value={videoId}
            onChange={(e) => {
              const v = e.target.value;
              setParams(v ? { video: v } : {}, { replace: true });
            }}
          >
            <option value="">All videos</option>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>Weapon</span>
          <select value={weapon} onChange={(e) => setWeapon(e.target.value)}>
            <option value="">All weapons</option>
            {WEAPONS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>Period</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="filter">
          <span>Chart</span>
          <div className="option-row">
            {CHART_TYPES.map((c) => (
              <button
                key={c.id}
                className={`option-pill ${chart === c.id ? 'selected' : ''}`}
                onClick={() => setChart(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <h2>No touch data for this selection</h2>
          <p className="muted">
            Mark touches on your videos (with categories and results) and they will show up here.
          </p>
        </div>
      ) : (
        <>
          {sw && (
            <div className="sw-row">
              <div className="sw-card strength">
                <span className="sw-tag">Strength</span>
                <strong>{sw.strength.name}</strong>
                <span className="muted">
                  {Math.round(sw.strength.successRate * 100)}% success ({sw.strength.scored} scored /{' '}
                  {sw.strength.received} received)
                </span>
              </div>
              <div className="sw-card weakness">
                <span className="sw-tag">Work on</span>
                <strong>{sw.weakness.name}</strong>
                <span className="muted">
                  {Math.round(sw.weakness.successRate * 100)}% success ({sw.weakness.scored} scored /{' '}
                  {sw.weakness.received} received)
                </span>
              </div>
            </div>
          )}

          <div className="chart-card">
            <h2>
              {chart === 'trend'
                ? 'Scored vs received over time'
                : 'Touches by general category'}
            </h2>
            <div className="chart-holder">
              <ResponsiveContainer width="100%" height={340}>
                {chart === 'bar' ? (
                  <BarChart data={withCategory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a33" />
                    <XAxis dataKey="short" stroke="#8b8b98" />
                    <YAxis allowDecimals={false} stroke="#8b8b98" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#ffffff10' }} />
                    <Legend />
                    <Bar dataKey="scored" name="Scored" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="received" name="Received" fill="#f87171" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : chart === 'pie' ? (
                  <PieChart>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Pie
                      data={withCategory}
                      dataKey="total"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={120}
                      paddingAngle={3}
                    >
                      {withCategory.map((c) => (
                        <Cell key={c.id} fill={c.color} />
                      ))}
                    </Pie>
                  </PieChart>
                ) : chart === 'radar' ? (
                  <RadarChart data={withCategory}>
                    <PolarGrid stroke="#2a2a33" />
                    <PolarAngleAxis dataKey="short" stroke="#8b8b98" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Radar name="Scored" dataKey="scored" stroke="#34d399" fill="#34d399" fillOpacity={0.35} />
                    <Radar name="Received" dataKey="received" stroke="#f87171" fill="#f87171" fillOpacity={0.25} />
                  </RadarChart>
                ) : (
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a33" />
                    <XAxis dataKey="month" stroke="#8b8b98" />
                    <YAxis allowDecimals={false} stroke="#8b8b98" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Line type="monotone" dataKey="scored" name="Scored" stroke="#34d399" strokeWidth={2} />
                    <Line type="monotone" dataKey="received" name="Received" stroke="#f87171" strokeWidth={2} />
                    <Line
                      type="monotone"
                      dataKey="successRate"
                      name="Success %"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {byLabel.length > 0 && (
            <div className="chart-card">
              <h2>Specific actions</h2>
              <table className="label-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Uses</th>
                    <th>Scored</th>
                    <th>Received</th>
                    <th>Success</th>
                  </tr>
                </thead>
                <tbody>
                  {byLabel.map((l) => (
                    <tr key={l.name}>
                      <td>
                        <span className="label-dot" style={{ background: l.color }} />
                        {l.name}
                      </td>
                      <td className="mono">{l.total}</td>
                      <td className="mono">{l.scored}</td>
                      <td className="mono">{l.received}</td>
                      <td className="mono">
                        {Number.isNaN(l.successRate) ? '—' : `${Math.round(l.successRate * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
