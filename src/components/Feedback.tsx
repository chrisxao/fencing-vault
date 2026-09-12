import type { ReactNode } from 'react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="loading-state"><span className="spinner" /><p>{label}</p></div>;
}

export function ErrorNotice({ error, action }: { error: unknown; action?: ReactNode }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return <div className="error-notice"><strong>Couldn’t finish that</strong><p>{message}</p>{action}</div>;
}

export function Toast({ message, tone = 'success' }: { message: string; tone?: 'success' | 'warning' }) {
  return <div className={`toast ${tone}`} role="status"><span>{tone === 'success' ? '✓' : '!'}</span>{message}</div>;
}
