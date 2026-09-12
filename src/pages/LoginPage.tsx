import { type FormEvent, useState } from 'react';
import { api } from '../api.ts';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await api.login(password); onSuccess(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to unlock studio'); }
    finally { setBusy(false); }
  }
  return (
    <main className="login-page">
      <div className="login-glow" />
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">PRIVATE ANALYSIS WORKSPACE</p>
        <h1>Your bouts.<br />Frame by frame.</h1>
        <p>Unlock the rule-aware labeling and performance studio.</p>
        <label>Workspace password<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter password" /></label>
        {error && <p className="field-error">{error}</p>}
        <button className="primary-button full-button" disabled={busy}>{busy ? 'Unlocking…' : 'Enter studio'} <span>→</span></button>
        <small>Single-owner access · No public accounts</small>
      </form>
    </main>
  );
}
