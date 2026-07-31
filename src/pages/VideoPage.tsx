import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { id, type User, type InstaQLEntity } from '@instantdb/react';
import type { AppSchema } from '../../instant.schema';
import { db } from '../lib/db';
import { getPlaybackUrl } from '../lib/upload';
import { categoryById, resultById, resultsForWeapon, weaponName } from '../lib/labels';
import { isScored, isReceived } from '../lib/stats';
import { formatTime, formatDate } from '../lib/format';
import {
  cancelVideoAnalysis,
  retryVideoAnalysis,
  reviewAnalysisCandidate,
  startVideoAnalysis,
  type AnalysisReviewResult,
  type CandidateReviewInput,
} from '../lib/api';
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
            analysisJobs: {
              candidates: { feedback: {}, segment: {} },
              feedback: {},
            },
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
  {
    segments: { labels: object; comments: object };
    comments: object;
    analysisJobs: {
      candidates: { feedback: object; segment: object };
      feedback: object;
    };
  }
>;
type Segment = VideoWithRefs['segments'][number];
type Comment = VideoWithRefs['comments'][number];
type Label = InstaQLEntity<AppSchema, 'labels'>;
type AnalysisJob = VideoWithRefs['analysisJobs'][number];
type AnalysisCandidate = AnalysisJob['candidates'][number];
type ReviewAction = CandidateReviewInput['action'];

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
  const [candidateReview, setCandidateReview] = useState<{
    candidate: AnalysisCandidate;
    action: ReviewAction;
  } | null>(null);
  const [pendingCandidateId, setPendingCandidateId] = useState<string | null>(null);
  const [analysisAction, setAnalysisAction] = useState<'start' | 'retry' | 'cancel' | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [tab, setTab] = useState<'touches' | 'ai' | 'frames'>('touches');
  const playUntil = useRef<number | null>(null);

  useEffect(() => {
    if (!user.refresh_token) {
      setSrcError('Missing session token. Sign in again.');
      return;
    }
    getPlaybackUrl(video.s3Key, user.refresh_token)
      .then(setSrc)
      .catch(() =>
        setSrcError('Could not load the video file. Is the API server running (npm run dev)?'),
      );
  }, [user.refresh_token, video.s3Key]);

  // Pause playback whenever an editor is open.
  useEffect(() => {
    if (editing || candidateReview) {
      playUntil.current = null;
      videoRef.current?.pause();
    }
  }, [candidateReview, editing]);

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
  const analysisJobs = useMemo(
    () => [...video.analysisJobs].sort((a, b) => b.createdAt - a.createdAt),
    [video.analysisJobs],
  );
  const latestJob = analysisJobs[0];
  const analysisCandidates = useMemo(() => {
    if (!latestJob) return [];
    return latestJob.candidates
      .filter((candidate) => !latestJob.runId || candidate.runId === latestJob.runId)
      .sort((a, b) => a.eventTimestamp - b.eventTimestamp);
  }, [latestJob]);

  useEffect(() => {
    if (!pendingCandidateId) return;
    const candidate = analysisCandidates.find((item) => item.id === pendingCandidateId);
    if (!candidate || candidate.reviewState !== 'unreviewed') {
      setPendingCandidateId(null);
    }
  }, [analysisCandidates, pendingCandidateId]);

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

  function sessionToken() {
    if (!user.refresh_token) {
      throw new Error('Missing session token. Sign in again.');
    }
    return user.refresh_token;
  }

  async function runAnalysisAction(action: 'start' | 'retry' | 'cancel') {
    if (analysisAction) return;
    setAnalysisAction(action);
    setAnalysisError('');
    setAnalysisNotice('');
    try {
      const token = sessionToken();
      if (action === 'start') {
        const response = await startVideoAnalysis(video.id, token);
        if (response.idempotent) {
          setAnalysisNotice('This video is already using the current analysis.');
        }
      } else {
        if (!latestJob) throw new Error('No analysis job is available.');
        if (action === 'retry') await retryVideoAnalysis(latestJob.id, token);
        else await cancelVideoAnalysis(latestJob.id, token);
      }
    } catch (value) {
      setAnalysisError(value instanceof Error ? value.message : 'Could not update video analysis.');
    } finally {
      setAnalysisAction(null);
    }
  }

  async function submitCandidateReview(
    candidate: AnalysisCandidate,
    input: CandidateReviewInput,
  ) {
    if (pendingCandidateId) throw new Error('Another review is still being saved.');
    setPendingCandidateId(candidate.id);
    try {
      await reviewAnalysisCandidate(candidate.id, input, sessionToken());
    } catch (value) {
      setPendingCandidateId(null);
      throw value;
    }
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

      <AnalysisStatusPanel
        job={latestJob}
        candidateCount={analysisCandidates.length}
        action={analysisAction}
        error={analysisError}
        notice={analysisNotice}
        onStart={() => runAnalysisAction('start')}
        onRetry={() => runAnalysisAction('retry')}
        onCancel={() => runAnalysisAction('cancel')}
      />

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
            analysisCandidates={analysisCandidates}
            markStart={markStart}
            onSeek={seek}
          />
          {analysisCandidates.length > 0 && (
            <div className="timeline-legend muted small">
              <span className="timeline-legend-swatch" />
              AI candidates from the latest analysis run
            </div>
          )}

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
                Mark touch start at {formatTime(currentTime)}
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
              className={`tab ${tab === 'ai' ? 'active' : ''}`}
              onClick={() => setTab('ai')}
            >
              AI review ({analysisCandidates.length})
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
          ) : tab === 'ai' ? (
            <CandidateReviewList
              candidates={analysisCandidates}
              currentTime={currentTime}
              pendingCandidateId={pendingCandidateId}
              onPreview={playSegment}
              onSeek={seek}
              onReview={(candidate, action) => setCandidateReview({ candidate, action })}
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
      {candidateReview && (
        <CandidateReviewModal
          key={`${candidateReview.candidate.id}:${candidateReview.action}`}
          candidate={candidateReview.candidate}
          action={candidateReview.action}
          weapon={video.weapon}
          duration={duration}
          pending={pendingCandidateId === candidateReview.candidate.id}
          onSubmit={(input) => submitCandidateReview(candidateReview.candidate, input)}
          onClose={() => setCandidateReview(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------- Video analysis

const ACTIVE_ANALYSIS_STATUSES = new Set(['queued', 'processing', 'retrying']);

function reviewStateLabel(state: string) {
  switch (state) {
    case 'accepted':
      return 'Accepted';
    case 'corrected':
      return 'Corrected';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Needs review';
  }
}

function formatStage(stage: string) {
  const label = stage.replaceAll('_', ' ').trim();
  return label ? label[0].toUpperCase() + label.slice(1) : 'Queued';
}

function awardedSideLabel(side?: string) {
  if (!side) return 'Unknown';
  return side[0].toUpperCase() + side.slice(1);
}

function parseEvidence(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function AnalysisStatusPanel({
  job,
  candidateCount,
  action,
  error,
  notice,
  onStart,
  onRetry,
  onCancel,
}: {
  job?: AnalysisJob;
  candidateCount: number;
  action: 'start' | 'retry' | 'cancel' | null;
  error: string;
  notice: string;
  onStart: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const active = Boolean(job && ACTIVE_ANALYSIS_STATUSES.has(job.status));
  const progress = Math.max(0, Math.min(1, job?.progress ?? 0));
  const status = job ? formatStage(job.status) : '';

  return (
    <section className="analysis-panel" aria-label="Video analysis">
      <div className="analysis-panel-head">
        <div>
          <h2>AI-assisted review</h2>
          <p className="muted small">
            Detected touches stay separate from your statistics until you review them.
          </p>
        </div>
        <div className="analysis-actions">
          {!job || job.status === 'completed' ? (
            <button
              className="btn btn-primary"
              disabled={Boolean(action)}
              onClick={onStart}
            >
              {action === 'start'
                ? 'Starting…'
                : job?.status === 'completed'
                  ? 'Analyze bout again'
                  : 'Analyze bout'}
            </button>
          ) : null}
          {job && active ? (
            <button
              className="btn btn-ghost danger"
              disabled={Boolean(action) || job.cancelRequested}
              onClick={onCancel}
            >
              {action === 'cancel' ? 'Cancelling…' : 'Cancel analysis'}
            </button>
          ) : null}
          {job && (job.status === 'failed' || job.status === 'cancelled') ? (
            <button
              className="btn btn-primary"
              disabled={Boolean(action)}
              onClick={onRetry}
            >
              {action === 'retry' ? 'Retrying…' : 'Retry analysis'}
            </button>
          ) : null}
        </div>
      </div>

      {job ? (
        <>
          <div className="analysis-meta">
            <span className={`analysis-status state-${job.status}`}>{status}</span>
            <span>
              Stage <strong>{formatStage(job.stage)}</strong>
            </span>
            <span>
              Progress <strong>{Math.round(progress * 100)}%</strong>
            </span>
            <span>
              Candidates <strong>{candidateCount}</strong>
            </span>
            {typeof job.costUsd === 'number' ? (
              <span>
                Cost <strong>${job.costUsd.toFixed(4)}</strong>
              </span>
            ) : null}
          </div>
          <div
            className="analysis-progress-track"
            role="progressbar"
            aria-label="Analysis progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="analysis-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          {job.error ? <p className="analysis-error">{job.error}</p> : null}
        </>
      ) : (
        <p className="muted small">
          Run the video pipeline to detect possible phrase endings and awarded points.
        </p>
      )}
      {error ? <p className="analysis-error">{error}</p> : null}
      {notice ? <p className="analysis-notice">{notice}</p> : null}
    </section>
  );
}

function CandidateReviewList({
  candidates,
  currentTime,
  pendingCandidateId,
  onPreview,
  onSeek,
  onReview,
}: {
  candidates: AnalysisCandidate[];
  currentTime: number;
  pendingCandidateId: string | null;
  onPreview: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  onReview: (candidate: AnalysisCandidate, action: ReviewAction) => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="side-empty">
        <p className="muted">
          No candidates are available for the latest analysis run. Start analysis or wait for the
          current run to finish.
        </p>
      </div>
    );
  }

  return (
    <div className="candidate-list">
      {candidates.map((candidate, index) => {
        const evidence = parseEvidence(candidate.evidenceJson);
        const active =
          currentTime >= candidate.eventStart && currentTime <= candidate.eventEnd;
        const pending = pendingCandidateId === candidate.id;
        const latestFeedback = [...candidate.feedback].sort(
          (a, b) => b.createdAt - a.createdAt,
        )[0];
        return (
          <article
            key={candidate.id}
            className={`candidate-card ${active ? 'active' : ''}`}
          >
            <div className="candidate-card-head">
              <button
                className="time-badge mono"
                onClick={() => onSeek(candidate.eventTimestamp)}
              >
                {formatTime(candidate.eventTimestamp)}
              </button>
              <span className={`review-state state-${candidate.reviewState}`}>
                {reviewStateLabel(candidate.reviewState)}
              </span>
              <span className="candidate-index muted">Candidate {index + 1}</span>
            </div>
            <div className="candidate-facts">
              <span>
                Confidence <strong>{Math.round(candidate.confidence * 100)}%</strong>
              </span>
              <span>
                Point <strong>{candidate.pointAwarded === true ? 'Awarded' : candidate.pointAwarded === false ? 'Not awarded' : 'Unknown'}</strong>
              </span>
              <span>
                Side <strong>{awardedSideLabel(candidate.awardedSide)}</strong>
              </span>
            </div>
            <p className="candidate-window mono muted">
              Window {formatTime(candidate.eventStart)}–{formatTime(candidate.eventEnd)}
            </p>
            {evidence.length > 0 ? (
              <div className="candidate-evidence">
                <span className="candidate-label">Evidence</span>
                <ul>
                  {evidence.map((item, itemIndex) => (
                    <li key={`${candidate.id}:evidence:${itemIndex}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="muted small">No model evidence was recorded.</p>
            )}
            <p className="candidate-model muted small">
              {candidate.model}
              {candidate.provider ? ` · ${candidate.provider}` : ''} · prompt{' '}
              {candidate.promptVersion}
            </p>
            {candidate.segment ? (
              <div className="candidate-linked-segment">
                Created touch: {formatTime(candidate.segment.startTime)}–
                {formatTime(candidate.segment.endTime)} ·{' '}
                {resultById(candidate.segment.result)?.name ?? candidate.segment.result}
              </div>
            ) : null}
            {latestFeedback?.reason || latestFeedback?.comment ? (
              <div className="candidate-feedback">
                {latestFeedback.reason ? <p>Notes: {latestFeedback.reason}</p> : null}
                {latestFeedback.comment ? <p>Comment: {latestFeedback.comment}</p> : null}
              </div>
            ) : null}
            <div className="candidate-actions">
              <button
                className="btn btn-ghost small"
                onClick={() => onPreview(candidate.eventStart, candidate.eventEnd)}
              >
                Preview
              </button>
              {candidate.reviewState === 'unreviewed' ? (
                <>
                  <button
                    className="btn btn-primary small"
                    disabled={Boolean(pendingCandidateId)}
                    onClick={() => onReview(candidate, 'accept')}
                  >
                    {pending ? 'Saving…' : 'Accept'}
                  </button>
                  <button
                    className="btn btn-ghost small"
                    disabled={Boolean(pendingCandidateId)}
                    onClick={() => onReview(candidate, 'correct')}
                  >
                    Correct
                  </button>
                  <button
                    className="btn btn-ghost small danger"
                    disabled={Boolean(pendingCandidateId)}
                    onClick={() => onReview(candidate, 'reject')}
                  >
                    Reject
                  </button>
                </>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CandidateReviewModal({
  candidate,
  action,
  weapon,
  duration,
  pending,
  onSubmit,
  onClose,
}: {
  candidate: AnalysisCandidate;
  action: ReviewAction;
  weapon: string;
  duration: number;
  pending: boolean;
  onSubmit: (input: CandidateReviewInput) => Promise<void>;
  onClose: () => void;
}) {
  const [result, setResult] = useState<AnalysisReviewResult | ''>('');
  const [startTime, setStartTime] = useState(String(candidate.eventStart));
  const [endTime, setEndTime] = useState(String(candidate.eventEnd));
  const [timestamp, setTimestamp] = useState(String(candidate.eventTimestamp));
  const [notes, setNotes] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const resultOptions = resultsForWeapon(weapon);
  const editingTimes = action === 'correct';
  const rejecting = action === 'reject';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || pending) return;
    setError('');
    let input: CandidateReviewInput;
    const normalizedNotes = notes.trim() || undefined;
    const normalizedComment = comment.trim() || undefined;

    if (rejecting) {
      input = {
        action: 'reject',
        notes: normalizedNotes,
        comment: normalizedComment,
      };
    } else {
      if (!result) {
        setError('Choose the fencing result relative to you.');
        return;
      }
      if (editingTimes) {
        const start = Number(startTime);
        const end = Number(endTime);
        const eventTime = Number(timestamp);
        if (![start, end, eventTime].every(Number.isFinite) || start < 0) {
          setError('Enter valid non-negative timestamps.');
          return;
        }
        if (end <= start) {
          setError('End time must be after start time.');
          return;
        }
        if (eventTime < start || eventTime > end) {
          setError('Point timestamp must fall inside the event window.');
          return;
        }
        if (duration > 0 && end > duration) {
          setError('Event timestamps cannot exceed the video duration.');
          return;
        }
        input = {
          action: 'correct',
          startTime: start,
          endTime: end,
          timestamp: eventTime,
          result,
          notes: normalizedNotes,
          comment: normalizedComment,
        };
      } else {
        input = {
          action: 'accept',
          result,
          notes: normalizedNotes,
          comment: normalizedComment,
        };
      }
    }

    setSaving(true);
    try {
      await onSubmit(input);
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not save this review.');
      setSaving(false);
    }
  }

  const title =
    action === 'accept'
      ? 'Accept AI candidate'
      : action === 'correct'
        ? 'Correct AI candidate'
        : 'Reject AI candidate';

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="modal wide candidate-review-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted small">
          AI reported {awardedSideLabel(candidate.awardedSide).toLowerCase()} at{' '}
          {formatTime(candidate.eventTimestamp)}. Left and right are camera positions, not your side.
        </p>
        <form onSubmit={submit}>
          {editingTimes ? (
            <div className="field-row candidate-time-fields">
              <label className="field">
                <span>Start (seconds)</span>
                <input
                  type="number"
                  min="0"
                  max={duration || undefined}
                  step="0.1"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
              <label className="field">
                <span>End (seconds)</span>
                <input
                  type="number"
                  min="0"
                  max={duration || undefined}
                  step="0.1"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Point timestamp</span>
                <input
                  type="number"
                  min="0"
                  max={duration || undefined}
                  step="0.1"
                  value={timestamp}
                  onChange={(event) => setTimestamp(event.target.value)}
                />
              </label>
            </div>
          ) : !rejecting ? (
            <div className="candidate-original-window">
              Segment {formatTime(candidate.eventStart)}–{formatTime(candidate.eventEnd)} · point at{' '}
              {formatTime(candidate.eventTimestamp)}
            </div>
          ) : null}

          {!rejecting ? (
            <div className="field">
              <span>Result relative to you</span>
              <div className="result-guidance">
                Select this explicitly; the camera-side award is never converted automatically.
              </div>
              <div className="option-row">
                {resultOptions.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option-pill ${result === option.id ? 'selected' : ''}`}
                    style={
                      result === option.id
                        ? { borderColor: option.color, color: option.color }
                        : undefined
                    }
                    onClick={() => setResult(option.id)}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="field">
            <span>{rejecting ? 'Rejection notes' : 'Touch notes'}</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={
                rejecting
                  ? 'Why is this not a touch?'
                  : 'Optional notes saved on the created touch'
              }
            />
          </label>
          <label className="field">
            <span>Reviewer comment</span>
            <textarea
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Optional feedback about the model output"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              className={rejecting ? 'btn btn-ghost danger' : 'btn btn-primary'}
              disabled={saving || pending || (!rejecting && !result)}
            >
              {saving || pending
                ? 'Saving…'
                : action === 'accept'
                  ? 'Accept and create touch'
                  : action === 'correct'
                    ? 'Save correction'
                    : 'Reject candidate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Timeline

function Timeline({
  duration,
  currentTime,
  segments,
  frameComments,
  analysisCandidates,
  markStart,
  onSeek,
}: {
  duration: number;
  currentTime: number;
  segments: Segment[];
  frameComments: Comment[];
  analysisCandidates: AnalysisCandidate[];
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
      {analysisCandidates.map((candidate) => (
        <div
          key={candidate.id}
          className={`timeline-ai-candidate state-${candidate.reviewState}`}
          title={`AI candidate at ${formatTime(candidate.eventTimestamp)} · ${Math.round(
            candidate.confidence * 100,
          )}% confidence · ${reviewStateLabel(candidate.reviewState)}`}
          style={{
            left: `${pct(candidate.eventStart)}%`,
            width: `${Math.max(0.7, pct(candidate.eventEnd) - pct(candidate.eventStart))}%`,
          }}
        />
      ))}
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
                Replay
              </button>
              <button className="btn btn-ghost small" onClick={() => onEdit(s)}>
                Edit
              </button>
              <button
                className="btn btn-ghost small"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              >
                Comments ({s.comments.length})
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
