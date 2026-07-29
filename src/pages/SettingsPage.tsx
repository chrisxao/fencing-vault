import { useEffect, useState, type FormEvent } from 'react';
import { id, type User } from '@instantdb/react';
import { db } from '../lib/db';
import { changeEmail, changePassword } from '../lib/auth-api';
import { WEAPONS, type Weapon } from '../lib/labels';
import { useTheme, type Theme } from '../lib/theme';

export default function SettingsPage({ user }: { user: User }) {
  const { theme, toggle } = useTheme();
  const { isLoading, data } = db.useQuery({
    profiles: { $: { where: { '$user.id': user.id } } },
  });

  const profile = data?.profiles[0];
  const [name, setName] = useState('');
  const [defaultWeapon, setDefaultWeapon] = useState<Weapon | ''>('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [email, setEmail] = useState(user.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? '');
    setDefaultWeapon((profile.defaultWeapon as Weapon | undefined) ?? '');
  }, [profile]);

  useEffect(() => {
    setEmail(user.email ?? '');
  }, [user.email]);

  async function ensureProfile() {
    if (profile) return profile.id;
    const profileId = id();
    const now = Date.now();
    await db.transact(
      db.tx.profiles[profileId]
        .update({
          name: name.trim() || user.email?.split('@')[0] || 'Fencer',
          defaultWeapon: defaultWeapon || undefined,
          createdAt: now,
          updatedAt: now,
        })
        .link({ $user: user.id }),
    );
    return profileId;
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileErr(null);
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name is required');
      const profileId = await ensureProfile();
      await db.transact(
        db.tx.profiles[profileId].update({
          name: trimmed,
          defaultWeapon: defaultWeapon || undefined,
          updatedAt: Date.now(),
        }),
      );
      setProfileMsg('Profile saved');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Could not save profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveEmail(e: FormEvent) {
    e.preventDefault();
    setEmailErr(null);
    setEmailMsg(null);
    setSavingEmail(true);
    try {
      if (!user.refresh_token) throw new Error('Missing session token — sign in again');
      const result = await changeEmail(user.refresh_token, {
        email,
        password: emailPassword,
      });
      if (result.token) {
        await db.auth.signInWithToken(result.token);
      }
      setEmailPassword('');
      setEmailMsg('Email updated');
    } catch (err) {
      setEmailErr(err instanceof Error ? err.message : 'Could not change email');
    } finally {
      setSavingEmail(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    setSavingPw(true);
    try {
      if (!user.refresh_token) throw new Error('Missing session token — sign in again');
      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match');
      }
      await changePassword(user.refresh_token, {
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwMsg('Password updated');
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setSavingPw(false);
    }
  }

  function setPreferredTheme(next: Theme) {
    if (theme !== next) toggle();
  }

  if (isLoading) return <div className="fullscreen-note">Loading settings…</div>;

  return (
    <div className="settings-page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Account, preferences, and security.</p>
        </div>
      </div>

      <section className="settings-card">
        <h2>Profile</h2>
        <form onSubmit={saveProfile}>
          <label className="field">
            <span>Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </label>
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
            <p className="muted small">Used as the starting choice when you upload a new bout.</p>
          </div>
          {profileErr && <p className="form-error">{profileErr}</p>}
          {profileMsg && <p className="form-success">{profileMsg}</p>}
          <div className="modal-actions">
            <button className="btn btn-primary" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-card">
        <h2>Appearance</h2>
        <div className="field">
          <span>Theme</span>
          <div className="option-row">
            <button
              type="button"
              className={`option-pill ${theme === 'light' ? 'selected' : ''}`}
              onClick={() => setPreferredTheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={`option-pill ${theme === 'dark' ? 'selected' : ''}`}
              onClick={() => setPreferredTheme('dark')}
            >
              Dark
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <h2>Email</h2>
        <form onSubmit={saveEmail}>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Confirm with password</span>
            <input
              type="password"
              required
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {emailErr && <p className="form-error">{emailErr}</p>}
          {emailMsg && <p className="form-success">{emailMsg}</p>}
          <div className="modal-actions">
            <button className="btn btn-primary" disabled={savingEmail}>
              {savingEmail ? 'Updating…' : 'Update email'}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-card">
        <h2>Password</h2>
        <p className="muted small">
          If you previously signed in with a magic code, leave “Current password” blank to set
          your first password.
        </p>
        <form onSubmit={savePassword}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Required if you already have a password"
            />
          </label>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {pwErr && <p className="form-error">{pwErr}</p>}
          {pwMsg && <p className="form-success">{pwMsg}</p>}
          <div className="modal-actions">
            <button className="btn btn-primary" disabled={savingPw}>
              {savingPw ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
