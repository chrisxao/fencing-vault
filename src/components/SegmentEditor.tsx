import { useMemo, useState, type FormEvent } from 'react';
import { id } from '@instantdb/react';
import { db } from '../lib/db';
import {
  categoriesForWeapon,
  resultsForWeapon,
  type TouchResult,
} from '../lib/labels';
import { formatTime } from '../lib/format';

export interface LabelOption {
  id: string;
  name: string;
  category: string;
  isCustom: boolean;
}

export interface SegmentDraft {
  startTime: number;
  endTime: number;
  category?: string;
  result: TouchResult;
  notes: string;
  labelIds: string[];
}

interface Props {
  weapon: string;
  labels: LabelOption[];
  ownerId: string;
  title: string;
  initial: SegmentDraft;
  onSave: (draft: SegmentDraft) => Promise<void> | void;
  onClose: () => void;
}

export default function SegmentEditor({
  weapon,
  labels,
  ownerId,
  title,
  initial,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<SegmentDraft>(initial);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const categories = categoriesForWeapon(weapon);
  const results = resultsForWeapon(weapon);

  const labelsByCategory = useMemo(() => {
    const groups = new Map<string, LabelOption[]>();
    for (const l of labels) {
      const list = groups.get(l.category) ?? [];
      list.push(l);
      groups.set(l.category, list);
    }
    return groups;
  }, [labels]);

  function toggleLabel(labelId: string) {
    setDraft((d) => ({
      ...d,
      labelIds: d.labelIds.includes(labelId)
        ? d.labelIds.filter((x) => x !== labelId)
        : [...d.labelIds, labelId],
    }));
  }

  async function addCustomLabel() {
    const name = newLabel.trim();
    if (!name) return;
    const labelId = id();
    await db.transact(
      db.tx.labels[labelId]
        .update({
          name,
          category: draft.category ?? categories[0].id,
          isCustom: true,
        })
        .link({ owner: ownerId }),
    );
    setDraft((d) => ({ ...d, labelIds: [...d.labelIds, labelId] }));
    setNewLabel('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <form onSubmit={submit}>
          <div className="field-row">
            <label className="field">
              <span>Start (seconds)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={draft.startTime}
                onChange={(e) => setDraft((d) => ({ ...d, startTime: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>End (seconds)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={draft.endTime}
                onChange={(e) => setDraft((d) => ({ ...d, endTime: Number(e.target.value) }))}
              />
            </label>
            <div className="field">
              <span>Range</span>
              <div className="time-range-display">
                {formatTime(draft.startTime)} → {formatTime(draft.endTime)}
              </div>
            </div>
          </div>

          <div className="field">
            <span>Result</span>
            <div className="option-row">
              {results.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`option-pill ${draft.result === r.id ? 'selected' : ''}`}
                  style={draft.result === r.id ? { borderColor: r.color, color: r.color } : undefined}
                  onClick={() => setDraft((d) => ({ ...d, result: r.id }))}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>General category</span>
            <div className="option-row">
              {categories.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`option-pill ${draft.category === c.id ? 'selected' : ''}`}
                  style={draft.category === c.id ? { borderColor: c.color, color: c.color } : undefined}
                  onClick={() =>
                    setDraft((d) => ({ ...d, category: d.category === c.id ? undefined : c.id }))
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Action labels</span>
            <div className="label-groups">
              {categories.map((c) => {
                const group = labelsByCategory.get(c.id) ?? [];
                if (group.length === 0) return null;
                return (
                  <div key={c.id} className="label-group">
                    <span className="label-group-name" style={{ color: c.color }}>
                      {c.name}
                    </span>
                    <div className="option-row">
                      {group.map((l) => (
                        <button
                          type="button"
                          key={l.id}
                          className={`option-pill small ${
                            draft.labelIds.includes(l.id) ? 'selected' : ''
                          }`}
                          style={
                            draft.labelIds.includes(l.id)
                              ? { borderColor: c.color, color: c.color }
                              : undefined
                          }
                          onClick={() => toggleLabel(l.id)}
                        >
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="add-label-row">
              <input
                placeholder="Add a custom label…"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomLabel();
                  }
                }}
              />
              <button type="button" className="btn btn-ghost small" onClick={addCustomLabel}>
                Add
              </button>
            </div>
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea
              rows={2}
              placeholder="What happened on this touch?"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            />
          </label>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving || draft.endTime <= draft.startTime}>
              {saving ? 'Saving…' : 'Save touch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
