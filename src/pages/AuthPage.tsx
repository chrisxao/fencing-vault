import { useState, type FormEvent } from 'react';
import { db } from '../lib/db';
import { signup, signin } from '../lib/auth-api';
import { WEAPONS, type Weapon } from '../lib/labels';
import BrandMark from '../components/BrandMark';

type Mode = 'signin' | 'signup';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [defaultWeapon, setDefaultWeapon] = useState<Weapon>('foil');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } =
        mode === 'signup'
          ? await signup({
              email,
              password,
              name: name.trim(),
              defaultWeapon,
            })
          : await signin({ email, password });
      await db.auth.signInWithToken(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand-mark large">
          <BrandMark size={40} />
        </div>
        <h1>Fencing Vault</h1>
        <p className="muted">Upload bouts, break down every touch, track your game.</p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
            aria-selected={mode === 'signin'}
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            aria-selected={mode === 'signup'}
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label className="field">
              <span>Name</span>
              <input
                required
                autoFocus
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              autoFocus={mode === 'signin'}
              placeholder="you@club.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              required
              minLength={8}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </label>

          {mode === 'signup' && (
            <div className="field">
              <span>Default weapon</span>
              <div className="weapon-picker">
                {WEAPONS.map((w) => (
                  <button
                    type="button"
                    key={w.id}
                    className={`weapon-option ${defaultWeapon === w.id ? 'selected' : ''}`}
                    onClick={() => setDefaultWeapon(w.id)}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary wide" disabled={busy}>
            {busy
              ? mode === 'signup'
                ? 'Creating account…'
                : 'Signing in…'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}
