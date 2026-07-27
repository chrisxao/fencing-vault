import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { id, type User } from '@instantdb/react';
import { db } from './lib/db';
import { DEFAULT_LABELS } from './lib/labels';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import VideoPage from './pages/VideoPage';
import StatsPage from './pages/StatsPage';
import Layout from './components/Layout';

/** Seeds the default label taxonomy for first-time users. */
function LabelSeeder({ user }: { user: User }) {
  const { isLoading, data } = db.useQuery({
    labels: { $: { where: { 'owner.id': user.id } } },
  });
  const seeded = useRef(false);

  useEffect(() => {
    if (isLoading || seeded.current) return;
    if (data && data.labels.length === 0) {
      seeded.current = true;
      db.transact(
        DEFAULT_LABELS.map((l) =>
          db.tx.labels[id()]
            .update({ name: l.name, category: l.category, isCustom: false })
            .link({ owner: user.id }),
        ),
      );
    }
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
      <Layout email={user.email ?? ''}>
        <Routes>
          <Route path="/" element={<DashboardPage user={user} />} />
          <Route path="/video/:videoId" element={<VideoPage user={user} />} />
          <Route path="/stats" element={<StatsPage user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
