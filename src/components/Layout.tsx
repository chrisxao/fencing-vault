import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { db } from '../lib/db';

export default function Layout({ email, children }: { email: string; children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">🤺</span>
          <span>Fencing Vault</span>
        </NavLink>
        <nav className="topnav">
          <NavLink to="/" end>
            Videos
          </NavLink>
          <NavLink to="/stats">Stats</NavLink>
        </nav>
        <div className="topbar-right">
          <span className="user-email">{email}</span>
          <button className="btn btn-ghost" onClick={() => db.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
