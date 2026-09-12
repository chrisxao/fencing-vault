import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const nav = [
  { to: '/', label: 'Overview', icon: '⌂' },
  { to: '/import', label: 'Import', icon: '↗' },
  { to: '/rules', label: 'Rules desk', icon: '§' },
  { to: '/taxonomy', label: 'Action library', icon: '⌘' },
  { to: '/roadmap', label: 'Model roadmap', icon: '◇' },
];

export function Layout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const location = useLocation();
  const labeler = location.pathname.startsWith('/bouts/');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = window.localStorage.getItem('sabre-sidebar-collapsed');
    return saved === null ? window.innerWidth < 1100 : saved === 'true';
  });

  useEffect(() => {
    window.localStorage.setItem('sabre-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  return (
    <div className={`${labeler ? 'app-shell labeler-shell' : 'app-shell'}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
        </button>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} title={sidebarCollapsed ? item.label : undefined}>
              <span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="status-dot"><i /> Private workspace</div>
          <button className="text-button" onClick={onLogout}>Lock studio</button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <div className="header-copy">{children}</div>}</div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><span>◇</span><h3>{title}</h3><p>{children}</p></div>;
}
