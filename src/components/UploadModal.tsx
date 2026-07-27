import { useState, type FormEvent } from 'react';
import { id, type User } from '@instantdb/react';
import { db } from '../lib/db';
import { uploadVideo } from '../lib/upload';
import { WEAPONS, type Weapon } from '../lib/labels';
import { formatFileSize } from '../lib/format';

export default function UploadModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [weapon, setWeapon] = useState<Weapon>('foil');
  const [opponent, setOpponent] = useState('');
  const [event, setEvent] = useState('');
  const [boutDate, setBoutDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickFile(f: File | null) {
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const { key } = await uploadVideo(file, setProgress);
      await db.transact(
        db.tx.videos[id()]
          .update({
            title: title.trim() || file.name,
            weapon,
            s3Key: key,
            opponent: opponent.trim() || undefined,
            event: event.trim() || undefined,
            boutDate: boutDate ? new Date(boutDate).getTime() : undefined,
            createdAt: Date.now(),
          })
          .link({ owner: user.id }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <div className="modal-backdrop" onClick={uploading ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Upload a bout video</h2>
        <form onSubmit={submit}>
          <label className={`file-drop ${file ? 'has-file' : ''}`}>
            <input
              type="file"
              accept="video/*"
              disabled={uploading}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <span>
                <strong>{file.name}</strong> · {formatFileSize(file.size)}
              </span>
            ) : (
              <span>Click to choose a video file</span>
            )}
          </label>

          <label className="field">
            <span>Title</span>
            <input
              required
              value={title}
              disabled={uploading}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="NAC Div I — DE round of 16"
            />
          </label>

          <div className="field">
            <span>Weapon</span>
            <div className="weapon-picker">
              {WEAPONS.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  disabled={uploading}
                  className={`weapon-option ${weapon === w.id ? 'selected' : ''}`}
                  onClick={() => setWeapon(w.id)}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Opponent (optional)</span>
              <input
                value={opponent}
                disabled={uploading}
                onChange={(e) => setOpponent(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Event (optional)</span>
              <input value={event} disabled={uploading} onChange={(e) => setEvent(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Bout date (optional — used for stats over time)</span>
            <input
              type="date"
              value={boutDate}
              disabled={uploading}
              onChange={(e) => setBoutDate(e.target.value)}
            />
          </label>

          {uploading && (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              <span className="progress-text">{Math.round(progress * 100)}%</span>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={uploading}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!file || uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
