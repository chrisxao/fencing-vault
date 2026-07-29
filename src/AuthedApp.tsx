import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { id, type User } from '@instantdb/react';
import { db } from './lib/db';
import { DEFAULT_LABELS, RETIRED_LABELS } from './lib/labels';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import VideoPage from './pages/VideoPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import Layout from './components/Layout';

/**
 * Ensures every signed-in user has a profile row (name + preferences).
 */
function ProfileSeeder({ user }: { user: User }) {
  const { isLoading, data } = db.useQuery({
    profiles: { $: { where: { '$user.id': user.id } } },
  });
  const seeded = useRef(false);

  useEffect(() => {
    if (isLoading || !data || seeded.current) return;
    if (data.profiles.length > 0) {
      seeded.current = true;
      return;
    }
    seeded.current = true;
    const now = Date.now();
    db.transact(
      db.tx.profiles[id()]
        .update({
          name: user.email?.split('@')[0] || 'Fencer',
          createdAt: now,
          updatedAt: now,
        })
        .link({ $user: user.id }),
    );
  }, [isLoading, data, user.id, user.email]);

  return null;
}

/**
 * Keeps the user's default label taxonomy in sync with DEFAULT_LABELS:
 * creates missing seed labels, fixes categories that moved, and migrates
 * retired labels (re-linking their touches to a replacement when one exists).
 * Custom labels are never touched.
 */
function LabelSeeder({ user }: { user: User }) {
  const { isLoading, data } = db.useQuery({
    labels: { $: { where: { 'owner.id': user.id } }, segments: {} },
  });
  const synced = useRef(false);

  useEffect(() => {
    if (isLoading || !data || synced.current) return;
    synced.current = true;

    const defaults = data.labels.filter((l) => !l.isCustom);
    const byName = new Map(defaults.map((l) => [l.name.toLowerCase(), l]));
    const txs = [];

    for (const def of DEFAULT_LABELS) {
      const existing = byName.get(def.name.toLowerCase());
      if (!existing) {
        txs.push(
          db.tx.labels[id()]
            .update({ name: def.name, category: def.category, isCustom: false })
            .link({ owner: user.id }),
        );
      } else if (existing.category !== def.category) {
        txs.push(db.tx.labels[existing.id].update({ category: def.category }));
      }
    }

    for (const retired of RETIRED_LABELS) {
      const existing = byName.get(retired.name.toLowerCase());
      if (!existing) continue;
      const replacement = retired.replacedBy
        ? byName.get(retired.replacedBy.toLowerCase())
        : undefined;
      if (replacement && existing.segments.length > 0) {
        txs.push(
          db.tx.labels[replacement.id].link({
            segments: existing.segments.map((s) => s.id),
          }),
        );
      }
      txs.push(db.tx.labels[existing.id].delete());
    }

    if (txs.length > 0) db.transact(txs);
  }, [isLoading, data, user.id]);

  return null;
}

export default function AuthedApp() {
  const { isLoading, user, error } = db.useAuth();

  if (isLoading) return <div className="fullscreen-note">Loading…</div>;
  if (error) return <div className="fullscreen-note">Auth error: {error.message}</div>;
  if (!user) return <AuthPage />;

  return (
    <BrowserRouter>
      <LabelSeeder user={user} />
      <ProfileSeeder user={user} />
      <Layout email={user.email ?? ''}>
        <Routes>
          <Route path="/" element={<DashboardPage user={user} />} />
          <Route path="/video/:videoId" element={<VideoPage user={user} />} />
          <Route path="/stats" element={<StatsPage user={user} />} />
          <Route path="/settings" element={<SettingsPage user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
