import { lazy, Suspense } from 'react';
import SetupGuide from './components/SetupGuide';

const appId = (import.meta.env.VITE_INSTANT_APP_ID as string | undefined)?.trim();

// Lazy so nothing tries to connect to InstantDB until an app ID is configured.
const AuthedApp = lazy(() => import('./AuthedApp'));

export default function App() {
  if (!appId) return <SetupGuide />;
  return (
    <Suspense fallback={<div className="fullscreen-note">Loading…</div>}>
      <AuthedApp />
    </Suspense>
  );
}
