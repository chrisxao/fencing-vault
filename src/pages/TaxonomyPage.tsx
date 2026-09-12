import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '../../shared/api.ts';
import type { ActionDefinition } from '../../shared/domain.ts';
import { api, slugify } from '../api.ts';
import { ErrorNotice, Spinner, Toast } from '../components/Feedback.tsx';
import { PageHeader } from '../components/Layout.tsx';

const categories: ActionDefinition['category'][] = ['preparation', 'footwork', 'blade', 'attack', 'defense', 'priority', 'hit', 'referee', 'violation'];

export function TaxonomyPage() {
  const [data, setData] = useState<DashboardData | null>(null); const [filter, setFilter] = useState('all'); const [editing, setEditing] = useState<ActionDefinition | 'new' | null>(null); const [error, setError] = useState<unknown>(); const [toast, setToast] = useState('');
  const load = () => api.dashboard().then(setData).catch(setError); useEffect(() => { void load(); }, []);
  const actions = useMemo(() => data?.actions.filter((action) => filter === 'all' || action.category === filter) ?? [], [data, filter]);
  if (error) return <div className="page"><ErrorNotice error={error} /></div>; if (!data) return <Spinner label="Loading the action library" />;
  return <div className="page taxonomy-page">{toast && <Toast message={toast} />}
    <PageHeader eyebrow="EDITABLE LABEL SCHEMA" title="Action library" actions={<button className="primary-button" onClick={() => setEditing('new')}>+ New action</button>}><p>Use stable keys for training and clear labels for humans. You can add to this list at any time.</p></PageHeader>
    <div className="category-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All <span>{data.actions.length}</span></button>{categories.map((category) => <button className={filter === category ? 'active' : ''} onClick={() => setFilter(category)} key={category}>{category} <span>{data.actions.filter((action) => action.category === category).length}</span></button>)}</div>
    <div className="taxonomy-table"><div className="taxonomy-head"><span>ACTION</span><span>CATEGORY</span><span>TRAINING KEY</span><span>STATUS</span><span /></div>{actions.map((action) => <button className="taxonomy-row" key={action.id} onClick={() => setEditing(action)}>
      <span><strong>{action.label}</strong><small>{action.description}</small></span><span className={`category-pill ${action.category}`}>{action.category}</span><code>{action.key}</code><span className={action.active ? 'active-status' : 'inactive-status'}>{action.active ? 'Active' : 'Hidden'}</span><i>⋯</i>
    </button>)}</div>
    {editing && <ActionModal action={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setToast('Action library updated'); void load(); setTimeout(() => setToast(''), 2500); }} />}
  </div>;
}

function ActionModal({ action, onClose, onSaved }: { action: ActionDefinition | 'new'; onClose: () => void; onSaved: () => void }) {
  const current = action === 'new' ? null : action; const [label, setLabel] = useState(current?.label ?? ''); const [key, setKey] = useState(current?.key ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); const input = { label, key: key || slugify(label), category: form.get('category'), description: form.get('description'), active: form.get('active') === 'on' }; try { if (current) await api.updateAction(current.id, input); else await api.createAction(input); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save'); setBusy(false); } }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><form className="modal-card wide" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">{current ? 'EDIT LABEL' : 'NEW LABEL'}</p><h2>{current ? current.label : 'Add an action'}</h2>
    <label>Human label<input value={label} onChange={(event) => { setLabel(event.target.value); if (!current) setKey(slugify(event.target.value)); }} required autoFocus /></label><label>Stable training key<input value={key} onChange={(event) => setKey(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /><small>Lowercase, hyphenated, and never repurposed.</small></label>
    <label>Category<select name="category" defaultValue={current?.category ?? 'preparation'}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Description<textarea name="description" defaultValue={current?.description} rows={3} /></label><label className="check-label"><input type="checkbox" name="active" defaultChecked={current?.active ?? true} /> Show this action to labelers</label>{current?.system && <p className="hint-box">This is a built-in action. You may rename or hide it; its stable ID remains unchanged.</p>}{error && <p className="field-error">{error}</p>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Saving…' : 'Save action'}</button>
  </form></div>;
}
