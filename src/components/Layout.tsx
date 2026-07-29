import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { db } from '../lib/db';
import { useTheme } from '../lib/theme';
import BrandMark from './BrandMark';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="icon-btn"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle color theme"
    >
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.4 14.2A8.3 8.3 0 0 1 9.8 3.6a8.3 8.3 0 1 0 10.6 10.6Z" />
        </svg>
      )}
    </button>
  );
}

export default function Layout({ email, children }: { email: string; children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <BrandMark size={20} />
          </span>
          <span>Fencing Vault</span>
        </NavLink>
        <nav className="topnav">
          <NavLink to="/" end>
            Videos
          </NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="topbar-right">
          <ThemeToggle />
          <NavLink to="/settings" className="user-email">
            {email}
          </NavLink>
          <button className="btn btn-ghost" onClick={() => db.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
