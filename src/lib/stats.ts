import { CATEGORIES, categoryById } from './labels';

/** One analyzed touch, flattened for aggregation. */
export interface TouchDatum {
  videoId: string;
  videoTitle: string;
  weapon: string;
  /** ms timestamp — bout date if set, otherwise upload date. */
  date: number;
  category?: string;
  result: string;
  labels: string[];
}

interface VideoWithSegments {
  id: string;
  title: string;
  weapon: string;
  boutDate?: number | null;
  createdAt: number;
  segments: {
    category?: string | null;
    result: string;
    labels: { name: string }[];
  }[];
}

export function flattenTouches(videos: VideoWithSegments[]): TouchDatum[] {
  return videos.flatMap((v) =>
    v.segments.map((s) => ({
      videoId: v.id,
      videoTitle: v.title,
      weapon: v.weapon,
      date: v.boutDate ?? v.createdAt,
      category: s.category ?? undefined,
      result: s.result,
      labels: s.labels.map((l) => l.name),
    })),
  );
}

export type Period = 'all' | '30d' | '90d' | '365d';

export const PERIODS: { id: Period; name: string }[] = [
  { id: 'all', name: 'All time' },
  { id: '30d', name: 'Last month' },
  { id: '90d', name: 'Last 3 months' },
  { id: '365d', name: 'Last year' },
];

export function filterTouches(
  data: TouchDatum[],
  opts: { videoId?: string; weapon?: string; period: Period },
): TouchDatum[] {
  const cutoff =
    opts.period === 'all'
      ? 0
      : Date.now() - { '30d': 30, '90d': 90, '365d': 365 }[opts.period] * 24 * 60 * 60 * 1000;
  return data.filter(
    (t) =>
      (!opts.videoId || t.videoId === opts.videoId) &&
      (!opts.weapon || t.weapon === opts.weapon) &&
      t.date >= cutoff,
  );
}

/** 'double' counts as both scored and received (épée). */
export function isScored(result: string): boolean {
  return result === 'scored' || result === 'double';
}
export function isReceived(result: string): boolean {
  return result === 'received' || result === 'double';
}

export interface CategoryStats {
  id: string;
  name: string;
  short: string;
  color: string;
  scored: number;
  received: number;
  total: number;
  /** scored / (scored + received); NaN when no decisive touches. */
  successRate: number;
}

export function categoryBreakdown(data: TouchDatum[]): CategoryStats[] {
  return CATEGORIES.map((c) => {
    const touches = data.filter((t) => t.category === c.id);
    const scored = touches.filter((t) => isScored(t.result)).length;
    const received = touches.filter((t) => isReceived(t.result)).length;
    return {
      id: c.id,
      name: c.name,
      short: c.short,
      color: c.color,
      scored,
      received,
      total: touches.length,
      successRate: scored + received > 0 ? scored / (scored + received) : NaN,
    };
  });
}

export interface LabelStats {
  name: string;
  category?: string;
  color: string;
  scored: number;
  received: number;
  total: number;
  successRate: number;
}

export function labelBreakdown(data: TouchDatum[]): LabelStats[] {
  const byLabel = new Map<string, { scored: number; received: number; total: number; category?: string }>();
  for (const t of data) {
    for (const name of t.labels) {
      const entry = byLabel.get(name) ?? { scored: 0, received: 0, total: 0, category: t.category };
      entry.total += 1;
      if (isScored(t.result)) entry.scored += 1;
      if (isReceived(t.result)) entry.received += 1;
      if (!entry.category && t.category) entry.category = t.category;
      byLabel.set(name, entry);
    }
  }
  return [...byLabel.entries()]
    .map(([name, e]) => ({
      name,
      category: e.category,
      color: categoryById(e.category)?.color ?? '#a3a3a3',
      scored: e.scored,
      received: e.received,
      total: e.total,
      successRate: e.scored + e.received > 0 ? e.scored / (e.scored + e.received) : NaN,
    }))
    .sort((a, b) => b.total - a.total);
}

export interface TrendPoint {
  month: string; // "Mar 2026"
  scored: number;
  received: number;
  successRate: number; // percentage 0-100
}

export function monthlyTrend(data: TouchDatum[]): TrendPoint[] {
  const byMonth = new Map<string, { scored: number; received: number; ts: number }>();
  for (const t of data) {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = byMonth.get(key) ?? {
      scored: 0,
      received: 0,
      ts: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    };
    if (isScored(t.result)) entry.scored += 1;
    if (isReceived(t.result)) entry.received += 1;
    byMonth.set(key, entry);
  }
  return [...byMonth.values()]
    .sort((a, b) => a.ts - b.ts)
    .map((e) => ({
      month: new Date(e.ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
      scored: e.scored,
      received: e.received,
      successRate:
        e.scored + e.received > 0 ? Math.round((e.scored / (e.scored + e.received)) * 100) : 0,
    }));
}

/** Highest/lowest success-rate categories with at least `minSample` decisive touches. */
export function strengthsAndWeaknesses(stats: CategoryStats[], minSample = 3) {
  const eligible = stats.filter((s) => s.scored + s.received >= minSample);
  if (eligible.length < 2) return null;
  const sorted = [...eligible].sort((a, b) => b.successRate - a.successRate);
  return { strength: sorted[0], weakness: sorted[sorted.length - 1] };
}
