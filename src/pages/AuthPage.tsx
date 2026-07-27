import { useState, type FormEvent } from 'react';
import { db } from '../lib/db';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await db.auth.sendMagicCode({ email });
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await db.auth.signInWithMagicCode({ email, code });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand-mark large">🤺</div>
        <h1>Fencing Vault</h1>
        <p className="muted">Upload bouts, break down every touch, track your game.</p>

        {!codeSent ? (
          <form onSubmit={sendCode}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                autoFocus
                placeholder="you@club.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="btn btn-primary wide" disabled={busy}>
              {busy ? 'Sending…' : 'Send sign-in code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <p className="muted small">
              We emailed a code to <strong>{email}</strong>.
            </p>
            <label className="field">
              <span>Verification code</span>
              <input
                inputMode="numeric"
                required
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="btn btn-primary wide" disabled={busy}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn btn-ghost wide"
              onClick={() => {
                setCodeSent(false);
                setCode('');
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}
