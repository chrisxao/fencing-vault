import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { Spinner } from './components/Feedback.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { FencerPage } from './pages/FencerPage.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { LabelerPage } from './pages/LabelerPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { RoadmapPage } from './pages/RoadmapPage.tsx';
import { RulesPage } from './pages/RulesPage.tsx';
import { TaxonomyPage } from './pages/TaxonomyPage.tsx';
import { TeamPage } from './pages/TeamPage.tsx';

export default function App() {
  const [session, setSession] = useState<{ enabled: boolean; authenticated: boolean } | null>(null);
  useEffect(() => { api.session().then(setSession).catch(() => setSession({ enabled: false, authenticated: true })); }, []);
  if (!session) return <Spinner label="Opening your studio" />;
  if (!session.authenticated) return <LoginPage onSuccess={() => setSession({ ...session, authenticated: true })} />;
  return (
    <Layout onLogout={async () => { await api.logout(); setSession({ ...session, authenticated: false }); }}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/bouts/:boutId" element={<LabelerPage />} />
        <Route path="/fencers/:fencerId" element={<FencerPage />} />
        <Route path="/teams/:teamId" element={<TeamPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/taxonomy" element={<TaxonomyPage />} />
        <Route path="/roadmap" element={<RoadmapPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
