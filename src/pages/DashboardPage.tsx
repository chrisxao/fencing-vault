import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@instantdb/react';
import { db } from '../lib/db';
import { weaponName } from '../lib/labels';
import { isScored, isReceived } from '../lib/stats';
import { formatDate } from '../lib/format';
import { deleteVideo as deleteVideoRequest } from '../lib/upload';
import UploadModal from '../components/UploadModal';
import BrandMark from '../components/BrandMark';

export default function DashboardPage({ user }: { user: User }) {
  const [showUpload, setShowUpload] = useState(false);
  const { isLoading, error, data } = db.useQuery({
    videos: {
      $: { where: { 'owner.id': user.id }, order: { createdAt: 'desc' } },
      segments: {},
    },
  });

  if (isLoading) return <div className="fullscreen-note">Loading videos…</div>;
  if (error) return <div className="fullscreen-note">Error: {error.message}</div>;

  const videos = data.videos;
  const allSegments = videos.flatMap((v) => v.segments);
  const scored = allSegments.filter((s) => isScored(s.result)).length;
  const received = allSegments.filter((s) => isReceived(s.result)).length;

  async function deleteVideo(videoId: string) {
    if (!confirm('Delete this video and all its touches and comments?')) return;
    if (!user.refresh_token) {
      alert('Missing session token. Sign in again.');
      return;
    }
    try {
      await deleteVideoRequest(videoId, user.refresh_token);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not delete this video.');
    }
  }

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>My Bouts</h1>
          <p className="muted">
            {videos.length} video{videos.length === 1 ? '' : 's'} · {allSegments.length} touches
            analyzed
            {scored + received > 0 &&
              ` · ${Math.round((scored / (scored + received)) * 100)}% touches scored`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
          + Upload video
        </button>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state">
          <div className="brand-mark large">
            <BrandMark size={40} />
          </div>
          <h2>No bouts yet</h2>
          <p className="muted">Upload your first fencing video to start breaking down touches.</p>
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
            Upload your first video
          </button>
        </div>
      ) : (
        <div className="video-grid">
          {videos.map((v) => {
            const vScored = v.segments.filter((s) => isScored(s.result)).length;
            const vReceived = v.segments.filter((s) => isReceived(s.result)).length;
            return (
              <div key={v.id} className={`video-card weapon-${v.weapon}`}>
                <Link to={`/video/${v.id}`} className="video-card-body">
                  <div className="video-card-top">
                    <span className={`chip weapon-chip weapon-${v.weapon}`}>
                      {weaponName(v.weapon)}
                    </span>
                    <span className="muted small">{formatDate(v.boutDate ?? v.createdAt)}</span>
                  </div>
                  <h3>{v.title}</h3>
                  {(v.opponent || v.event) && (
                    <p className="muted small">
                      {[v.opponent && `vs ${v.opponent}`, v.event].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="video-card-stats">
                    <span>{v.segments.length} touches</span>
                    {vScored + vReceived > 0 && (
                      <span className="score-pill">
                        {vScored}–{vReceived}
                      </span>
                    )}
                  </div>
                </Link>
                <div className="video-card-actions">
                  <Link className="btn btn-ghost small" to={`/stats?video=${v.id}`}>
                    Stats
                  </Link>
                  <button
                    className="btn btn-ghost small danger"
                    onClick={() => deleteVideo(v.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showUpload && <UploadModal user={user} onClose={() => setShowUpload(false)} />}
    </div>
  );
}
