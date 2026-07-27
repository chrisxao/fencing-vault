import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { id, type User, type InstaQLEntity } from '@instantdb/react';
import type { AppSchema } from '../../instant.schema';
import { db } from '../lib/db';
import { getPlaybackUrl } from '../lib/upload';
import { categoryById, resultById, weaponName } from '../lib/labels';
import { isScored, isReceived } from '../lib/stats';
import { formatTime, formatDate } from '../lib/format';
import SegmentEditor, { type SegmentDraft } from '../components/SegmentEditor';

const FRAME = 1 / 30;

export default function VideoPage({ user }: { user: User }) {
  const { videoId } = useParams<{ videoId: string }>();
  const { isLoading, error, data } = db.useQuery(
    videoId
      ? {
          videos: {
            $: { where: { id: videoId, 'owner.id': user.id } },
            segments: { labels: {}, comments: {} },
            comments: {},
          },
          labels: { $: { where: { 'owner.id': user.id } } },
        }
      : null,
  );

  if (isLoading) return <div className="fullscreen-note">Loading bout…</div>;
  if (error) return <div className="fullscreen-note">Error: {error.message}</div>;
  const video = data?.videos[0];
  if (!video) return <div className="fullscreen-note">Video not found.</div>;

  return <BoutAnalyzer key={video.id} video={video} labels={data!.labels} user={user} />;
}

type VideoWithRefs = InstaQLEntity<
  AppSchema,
  'videos',
  { segments: { labels: object; comments: object }; comments: object }
>;
type Segment = VideoWithRefs['segments'][number];
type Comment = VideoWithRefs['comments'][number];
type Label = InstaQLEntity<AppSchema, 'labels'>;

function BoutAnalyzer({
  video,
  labels,
  user,
}: {
  video: VideoWithRefs;
  labels: Label[];
  user: User;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [srcError, setSrcError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.duration ?? 0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [markStart, setMarkStart] = useState<number | null>(null);
  const [editing, setEditing] = useState<
    | { mode: 'create'; draft: SegmentDraft }
    | { mode: 'edit'; segmentId: string; draft: SegmentDraft }
    | null
  >(null);
  const [tab, setTab] = useState<'touches' | 'frames'>('touches');
  const playUntil = useRef<number | null>(null);

  useEffect(() => {
    getPlaybackUrl(video.s3Key)
      .then(setSrc)
      .catch(() =>
        setSrcError('Could not load the video file. Is the API server running (npm run dev)?'),
      );
  }, [video.s3Key]);

  // Smooth playhead updates + auto-pause at the end of a touch being replayed.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = videoRef.current;
      if (el) {
        setCurrentTime(el.currentTime);
        if (playUntil.current !== null && el.currentTime >= playUntil.current) {
          el.pause();
          playUntil.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const segments = useMemo(
    () => [...video.segments].sort((a, b) => a.startTime - b.startTime),
    [video.segments],
  );
  const frameComments = useMemo(
    () =>
      video.comments
        .filter((c) => typeof c.timestamp === 'number')
        .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)),
    [video.comments],
  );

  const scored = segments.filter((s) => isScored(s.result)).length;
  const received = segments.filter((s) => isReceived(s.result)).length;

  const seek = useCallback((t: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, t);
    setCurrentTime(el.currentTime);
  }, []);

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    playUntil.current = null;
    if (el.paused) el.play();
    else el.pause();
  }

  function stepFrame(dir: 1 | -1) {
    videoRef.current?.pause();
    seek(currentTime + dir * FRAME);
  }

  function playSegment(start: number, end: number) {
    const el = videoRef.current;
    if (!el) return;
    seek(start);
    playUntil.current = end;
    el.play();
  }

  function beginTouch() {
    setMarkStart(currentTime);
  }

  function endTouch() {
    if (markStart === null) return;
    const [start, end] = [Math.min(markStart, currentTime), Math.max(markStart, currentTime)];
    setEditing({
      mode: 'create',
      draft: {
        startTime: Number(start.toFixed(1)),
        endTime: Number(Math.max(end, start + 0.5).toFixed(1)),
        category: undefined,
        result: 'scored',
        notes: '',
        labelIds: [],
      },
    });
    setMarkStart(null);
  }

  async function saveSegment(draft: SegmentDraft) {
    if (!editing) return;
    const fields = {
      startTime: draft.startTime,
      endTime: draft.endTime,
      category: draft.category,
      result: draft.result,
      notes: draft.notes.trim() || undefined,
    };
    if (editing.mode === 'create') {
      await db.transact(
        db.tx.segments[id()]
          .update({ ...fields, createdAt: Date.now() })
          .link({ video: video.id, labels: draft.labelIds }),
      );
    } else {
      const prev = segments.find((s) => s.id === editing.segmentId);
      const prevIds = prev?.labels.map((l) => l.id) ?? [];
      const added = draft.labelIds.filter((x) => !prevIds.includes(x));
      const removed = prevIds.filter((x) => !draft.labelIds.includes(x));
      await db.transact(
        db.tx.segments[editing.segmentId]
          .update(fields)
          .link({ labels: added })
          .unlink({ labels: removed }),
      );
    }
  }

  async function deleteSegment(segmentId: string) {
    if (!confirm('Delete this touch?')) return;
    await db.transact(db.tx.segments[segmentId].delete());
  }

  return (
    <div className="video-page">
      <div className="page-head">
        <div>
          <Link to="/" className="muted small">
            ← All bouts
          </Link>
          <h1>{video.title}</h1>
          <p className="muted">
            <span className={`chip weapon-chip weapon-${video.weapon}`}>
              {weaponName(video.weapon)}
            </span>{' '}
            {[video.opponent && `vs ${video.opponent}`, video.event]
              .filter(Boolean)
              .join(' · ')}{' '}
            · {formatDate(video.boutDate ?? video.createdAt)}
          </p>
        </div>
        <div className="head-score">
          <span className="score-big">
            {scored}–{received}
          </span>
          <Link className="btn btn-ghost small" to={`/stats?video=${video.id}`}>
            View stats →
          </Link>
        </div>
      </div>

      <div className="video-layout">
        <div className="player-column">
          {srcError ? (
            <div className="player-error">{srcError}</div>
          ) : (
            <video
              ref={videoRef}
              src={src ?? undefined}
              className="player"
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                setDuration(d);
                if (Number.isFinite(d) && !video.duration) {
                  db.transact(db.tx.videos[video.id].update({ duration: d }));
                }
              }}
            />
          )}

          <Timeline
            duration={duration}
            currentTime={currentTime}
            segments={segments}
            frameComments={frameComments}
            markStart={markStart}
            onSeek={seek}
          />

          <div className="controls">
            <button className="btn btn-ghost" onClick={() => seek(currentTime - 5)} title="Back 5s">
              ‹ 5s
            </button>
            <button className="btn btn-ghost" onClick={() => stepFrame(-1)} title="Previous frame">
              ‹ fr
            </button>
            <button className="btn btn-primary play-btn" onClick={togglePlay}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button className="btn btn-ghost" onClick={() => stepFrame(1)} title="Next frame">
              fr ›
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => seek(currentTime + 5)}
              title="Forward 5s"
            >
              5s ›
            </button>
            <span className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <select
              className="rate-select"
              value={rate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                if (videoRef.current) videoRef.current.playbackRate = r;
              }}
            >
              {[0.25, 0.5, 1, 1.5, 2].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </div>

          <div className="mark-bar">
            {markStart === null ? (
              <button className="btn btn-accent" onClick={beginTouch}>
                ⏱ Mark touch start at {formatTime(currentTime)}
              </button>
            ) : (
              <>
                <span className="marking-note">
                  Touch started at <strong>{formatTime(markStart)}</strong> — play to the end of the
                  point, then:
                </span>
                <button className="btn btn-accent" onClick={endTouch}>
                  End touch at {formatTime(currentTime)}
                </button>
                <button className="btn btn-ghost" onClick={() => setMarkStart(null)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        <div className="side-column">
          <div className="tabs">
            <button
              className={`tab ${tab === 'touches' ? 'active' : ''}`}
              onClick={() => setTab('touches')}
            >
              Touches ({segments.length})
            </button>
            <button
              className={`tab ${tab === 'frames' ? 'active' : ''}`}
              onClick={() => setTab('frames')}
            >
              Frame comments ({frameComments.length})
            </button>
          </div>

          {tab === 'touches' ? (
            <TouchList
              segments={segments}
              currentTime={currentTime}
              videoId={video.id}
              onPlay={playSegment}
              onEdit={(s) =>
                setEditing({
                  mode: 'edit',
                  segmentId: s.id,
                  draft: {
                    startTime: s.startTime,
                    endTime: s.endTime,
                    category: s.category ?? undefined,
                    result: s.result as SegmentDraft['result'],
                    notes: s.notes ?? '',
                    labelIds: s.labels.map((l) => l.id),
                  },
                })
              }
              onDelete={deleteSegment}
            />
          ) : (
            <FrameComments
              comments={frameComments}
              currentTime={currentTime}
              videoId={video.id}
              onSeek={seek}
            />
          )}
        </div>
      </div>

      {editing && (
        <SegmentEditor
          weapon={video.weapon}
          labels={labels}
          ownerId={user.id}
          title={editing.mode === 'create' ? 'New touch' : 'Edit touch'}
          initial={editing.draft}
          onSave={saveSegment}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Timeline

function Timeline({
  duration,
  currentTime,
  segments,
  frameComments,
  markStart,
  onSeek,
}: {
  duration: number;
  currentTime: number;
  segments: Segment[];
  frameComments: Comment[];
  markStart: number | null;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = (t: number) => (duration > 0 ? Math.min(100, (t / duration) * 100) : 0);

  return (
    <div
      ref={ref}
      className="timeline"
      onClick={(e) => {
        const rect = ref.current!.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * duration);
      }}
    >
      {segments.map((s) => {
        const cat = categoryById(s.category ?? undefined);
        const res = resultById(s.result);
        return (
          <div
            key={s.id}
            className="timeline-segment"
            title={`${formatTime(s.startTime)}–${formatTime(s.endTime)} ${res?.name ?? ''}`}
            style={{
              left: `${pct(s.startTime)}%`,
              width: `${Math.max(0.6, pct(s.endTime) - pct(s.startTime))}%`,
              background: cat?.color ?? '#525252',
              borderBottom: `3px solid ${res?.color ?? 'transparent'}`,
            }}
          />
        );
      })}
      {frameComments.map((c) => (
        <div
          key={c.id}
          className="timeline-comment-dot"
          title={c.text}
          style={{ left: `${pct(c.timestamp ?? 0)}%` }}
        />
      ))}
      {markStart !== null && (
        <div className="timeline-mark-start" style={{ left: `${pct(markStart)}%` }} />
      )}
      <div className="timeline-playhead" style={{ left: `${pct(currentTime)}%` }} />
    </div>
  );
}

// --------------------------------------------------------------- TouchList

function TouchList({
  segments,
  currentTime,
  videoId,
  onPlay,
  onEdit,
  onDelete,
}: {
  segments: Segment[];
  currentTime: number;
  videoId: string;
  onPlay: (start: number, end: number) => void;
  onEdit: (s: Segment) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (segments.length === 0) {
    return (
      <div className="side-empty">
        <p className="muted">
          No touches marked yet. Use <strong>Mark touch start</strong> under the player to segment
          the bout point by point.
        </p>
      </div>
    );
  }

  let running = { scored: 0, received: 0 };

  return (
    <div className="touch-list">
      {segments.map((s, i) => {
        const cat = categoryById(s.category ?? undefined);
        const res = resultById(s.result);
        running = {
          scored: running.scored + (isScored(s.result) ? 1 : 0),
          received: running.received + (isReceived(s.result) ? 1 : 0),
        };
        const active = currentTime >= s.startTime && currentTime < s.endTime;
        return (
          <div key={s.id} className={`touch-card ${active ? 'active' : ''}`}>
            <div className="touch-head" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              <span className="touch-num">#{i + 1}</span>
              <span className="touch-time mono">
                {formatTime(s.startTime)}–{formatTime(s.endTime)}
              </span>
              {res && (
                <span className="chip" style={{ color: res.color, borderColor: res.color }}>
                  {res.name}
                </span>
              )}
              {cat && (
                <span className="chip" style={{ color: cat.color, borderColor: cat.color }}>
                  {cat.short}
                </span>
              )}
              <span className="running-score mono muted">
                {running.scored}–{running.received}
              </span>
            </div>
            {s.labels.length > 0 && (
              <div className="touch-labels">
                {s.labels.map((l) => (
                  <span key={l.id} className="chip small">
                    {l.name}
                  </span>
                ))}
              </div>
            )}
            {s.notes && <p className="touch-notes">{s.notes}</p>}
            <div className="touch-actions">
              <button className="btn btn-ghost small" onClick={() => onPlay(s.startTime, s.endTime)}>
                ▶ Replay
              </button>
              <button className="btn btn-ghost small" onClick={() => onEdit(s)}>
                Edit
              </button>
              <button
                className="btn btn-ghost small"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              >
                💬 {s.comments.length}
              </button>
              <button className="btn btn-ghost small danger" onClick={() => onDelete(s.id)}>
                Delete
              </button>
            </div>
            {expanded === s.id && <SegmentComments segment={s} videoId={videoId} />}
          </div>
        );
      })}
    </div>
  );
}

function SegmentComments({ segment, videoId }: { segment: Segment; videoId: string }) {
  const [text, setText] = useState('');

  async function add() {
    const t = text.trim();
    if (!t) return;
    await db.transact(
      db.tx.comments[id()]
        .update({ text: t, createdAt: Date.now() })
        .link({ segment: segment.id, video: videoId }),
    );
    setText('');
  }

  const comments = [...segment.comments].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="comment-thread">
      {comments.map((c) => (
        <div key={c.id} className="comment">
          <p>{c.text}</p>
          <button
            className="comment-delete"
            title="Delete comment"
            onClick={() => db.transact(db.tx.comments[c.id].delete())}
          >
            ×
          </button>
        </div>
      ))}
      <div className="comment-input-row">
        <input
          placeholder="Comment on this touch…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button className="btn btn-ghost small" onClick={add}>
          Post
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- FrameComments

function FrameComments({
  comments,
  currentTime,
  videoId,
  onSeek,
}: {
  comments: Comment[];
  currentTime: number;
  videoId: string;
  onSeek: (t: number) => void;
}) {
  const [text, setText] = useState('');

  async function add() {
    const t = text.trim();
    if (!t) return;
    await db.transact(
      db.tx.comments[id()]
        .update({ text: t, timestamp: Number(currentTime.toFixed(2)), createdAt: Date.now() })
        .link({ video: videoId }),
    );
    setText('');
  }

  return (
    <div className="frame-comments">
      <div className="comment-input-row">
        <input
          placeholder={`Comment at ${formatTime(currentTime)}…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button className="btn btn-primary small" onClick={add}>
          Post
        </button>
      </div>
      {comments.length === 0 ? (
        <p className="muted small side-empty">
          Pause on any frame and post a comment — it gets pinned to that exact timestamp.
        </p>
      ) : (
        comments.map((c) => (
          <div key={c.id} className="comment frame">
            <button className="time-badge mono" onClick={() => onSeek(c.timestamp ?? 0)}>
              {formatTime(c.timestamp ?? 0)}
            </button>
            <p>{c.text}</p>
            <button
              className="comment-delete"
              title="Delete comment"
              onClick={() => db.transact(db.tx.comments[c.id].delete())}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}
