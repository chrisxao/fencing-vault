import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import {
  id,
  type InstaQLEntity,
  type User,
} from '@instantdb/react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AppSchema } from '../lib/schema';
import { db } from '../lib/db';
import {
  cancelVideoAnalysis,
  getPlaybackUrl,
  retryVideoAnalysis,
  reviewAnalysisCandidate,
  startVideoAnalysis,
  type AnalysisReviewResult,
  type CandidateReviewInput,
} from '../lib/api';
import {
  CATEGORIES,
  RESULTS,
  categoriesForWeapon,
  formatTime,
  isReceived,
  isScored,
  resultsForWeapon,
  type TouchResult,
} from '../lib/fencing';
import { useTheme } from '../lib/theme';
import type { RootStackParamList } from '../navigation';
import {
  Button,
  ChoiceRow,
  Field,
  Loading,
  Message,
  PageTitle,
  Panel,
  Pill,
  Screen,
} from '../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'Bout'> & { user: User };
type Video = InstaQLEntity<
  AppSchema,
  'videos',
  {
    segments: { labels: {} };
    analysisJobs: {
      candidates: { feedback: {}; segment: {} };
      feedback: {};
    };
  }
>;
type Segment = Video['segments'][number];
type Label = InstaQLEntity<AppSchema, 'labels'>;
type AnalysisJob = Video['analysisJobs'][number];
type AnalysisCandidate = AnalysisJob['candidates'][number];
type ReviewAction = CandidateReviewInput['action'];

type SegmentDraft = {
  startTime: number;
  endTime: number;
  result: TouchResult;
  category?: string;
  notes: string;
  labelIds: string[];
};

export function BoutScreen({ user, route }: Props) {
  const { videoId } = route.params;
  const query = db.useQuery({
    videos: {
      $: { where: { id: videoId, 'owner.id': user.id } },
      segments: { labels: {} },
      analysisJobs: {
        candidates: { feedback: {}, segment: {} },
        feedback: {},
      },
    },
    labels: { $: { where: { 'owner.id': user.id } } },
  });

  if (query.isLoading) return <Loading label="Loading bout…" />;
  if (query.error) {
    return (
      <Screen>
        <Message error>{query.error.message}</Message>
      </Screen>
    );
  }
  const video = query.data.videos[0];
  if (!video) {
    return (
      <Screen>
        <Message error>This bout no longer exists.</Message>
      </Screen>
    );
  }
  return <BoutAnalyzer key={video.id} video={video} labels={query.data.labels} user={user} />;
}

function BoutAnalyzer({ video, labels, user }: { video: Video; labels: Label[]; user: User }) {
  const { colors } = useTheme();
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.duration ?? 0);
  const [rate, setRate] = useState(1);
  const [markStart, setMarkStart] = useState<number | null>(null);
  const [timelineWidth, setTimelineWidth] = useState(1);
  const [editing, setEditing] = useState<
    { segmentId?: string; draft: SegmentDraft } | undefined
  >();
  const [candidateReview, setCandidateReview] = useState<{
    candidate: AnalysisCandidate;
    action: ReviewAction;
  }>();
  const [pendingCandidateId, setPendingCandidateId] = useState<string>();
  const [analysisAction, setAnalysisAction] = useState<'start' | 'retry' | 'cancel'>();
  const [analysisError, setAnalysisError] = useState('');
  const [analysisNotice, setAnalysisNotice] = useState('');

  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 0.1;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const status = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });

  useEventListener(player, 'timeUpdate', ({ currentTime: value }) => setCurrentTime(value));

  useEffect(() => {
    let active = true;
    if (!user.refresh_token) {
      setSourceError('Missing session token. Sign in again.');
      return () => {
        active = false;
      };
    }
    getPlaybackUrl(video.s3Key, user.refresh_token)
      .then((url) => {
        if (active) setSource(url);
      })
      .catch((value) => {
        if (active) {
          setSourceError(value instanceof Error ? value.message : 'Could not load this video.');
        }
      });
    return () => {
      active = false;
    };
  }, [user.refresh_token, video.s3Key]);

  useEffect(() => {
    if (!source) return;
    player.replaceAsync(source).catch((value) => {
      setSourceError(value instanceof Error ? value.message : 'Could not open this video.');
    });
  }, [player, source]);

  useEffect(() => {
    if (status.status !== 'readyToPlay' || !Number.isFinite(player.duration)) return;
    setDuration(player.duration);
    if (!video.duration && player.duration > 0) {
      db.transact(db.tx.videos[video.id].update({ duration: player.duration }));
    }
  }, [player, status.status, video.duration, video.id]);

  const segments = useMemo(
    () => [...video.segments].sort((left, right) => left.startTime - right.startTime),
    [video.segments],
  );
  const analysisJobs = useMemo(
    () => [...video.analysisJobs].sort((left, right) => right.createdAt - left.createdAt),
    [video.analysisJobs],
  );
  const latestJob = analysisJobs[0];
  const analysisCandidates = useMemo(() => {
    if (!latestJob) return [];
    return latestJob.candidates
      .filter((candidate) => !latestJob.runId || candidate.runId === latestJob.runId)
      .sort((left, right) => left.eventTimestamp - right.eventTimestamp);
  }, [latestJob]);

  useEffect(() => {
    if (!pendingCandidateId) return;
    const candidate = analysisCandidates.find((item) => item.id === pendingCandidateId);
    if (!candidate || candidate.reviewState !== 'unreviewed') {
      setPendingCandidateId(undefined);
    }
  }, [analysisCandidates, pendingCandidateId]);

  useEffect(() => {
    if (candidateReview) player.pause();
  }, [candidateReview, player]);

  const scored = segments.filter((segment) => isScored(segment.result)).length;
  const received = segments.filter((segment) => isReceived(segment.result)).length;

  function seek(value: number) {
    const bounded = Math.max(0, duration ? Math.min(value, duration) : value);
    player.currentTime = bounded;
    setCurrentTime(bounded);
  }

  function finishTouch() {
    if (markStart === null) return;
    const start = Math.min(markStart, currentTime);
    const end = Math.max(markStart, currentTime, start + 0.5);
    setEditing({
      draft: {
        startTime: Number(start.toFixed(1)),
        endTime: Number(end.toFixed(1)),
        result: 'scored',
        notes: '',
        labelIds: [],
      },
    });
    setMarkStart(null);
    player.pause();
  }

  async function saveSegment(draft: SegmentDraft) {
    const fields = {
      startTime: draft.startTime,
      endTime: draft.endTime,
      result: draft.result,
      category: draft.category,
      notes: draft.notes.trim() || undefined,
    };
    if (editing?.segmentId) {
      const previous = segments.find((segment) => segment.id === editing.segmentId);
      const previousIds = previous?.labels.map((label) => label.id) ?? [];
      const added = draft.labelIds.filter((labelId) => !previousIds.includes(labelId));
      const removed = previousIds.filter((labelId) => !draft.labelIds.includes(labelId));
      await db.transact(
        db.tx.segments[editing.segmentId]
          .update(fields)
          .link({ labels: added })
          .unlink({ labels: removed }),
      );
    } else {
      await db.transact(
        db.tx.segments[id()]
          .update({ ...fields, createdAt: Date.now() })
          .link({ video: video.id, labels: draft.labelIds }),
      );
    }
  }

  function removeSegment(segmentId: string) {
    Alert.alert('Delete touch?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => db.transact(db.tx.segments[segmentId].delete()),
      },
    ]);
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
      setAnalysisAction(undefined);
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
      setPendingCandidateId(undefined);
      throw value;
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <PageTitle
          subtitle={[video.opponent ? `vs ${video.opponent}` : '', video.event]
            .filter(Boolean)
            .join(' · ')}
        >
          {video.title}
        </PageTitle>
        <Text style={[styles.score, { color: colors.text }]}>
          {scored}–{received}
        </Text>
      </View>

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

      <View style={[styles.playerShell, { backgroundColor: '#050506' }]}>
        {sourceError ? (
          <View style={styles.playerError}>
            <Message error>{sourceError}</Message>
          </View>
        ) : (
          <VideoView
            player={player}
            style={styles.player}
            contentFit="contain"
            nativeControls={false}
            fullscreenOptions={{ enable: true }}
            allowsPictureInPicture
          />
        )}
      </View>

      <Pressable
        onLayout={(event: LayoutChangeEvent) => setTimelineWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (duration > 0) seek((event.nativeEvent.locationX / timelineWidth) * duration);
        }}
        style={[styles.timeline, { backgroundColor: colors.border }]}
      >
        {analysisCandidates.map((candidate) => (
          <View
            key={candidate.id}
            style={[
              styles.timelineCandidate,
              {
                backgroundColor:
                  candidate.reviewState === 'rejected'
                    ? colors.surface
                    : candidate.reviewState === 'accepted' ||
                        candidate.reviewState === 'corrected'
                      ? colors.success
                      : colors.accent,
                borderColor:
                  candidate.reviewState === 'rejected' ? colors.danger : colors.accent,
                left: `${duration ? (candidate.eventStart / duration) * 100 : 0}%`,
                width: `${duration ? Math.max(1.5, ((candidate.eventEnd - candidate.eventStart) / duration) * 100) : 1.5}%`,
              },
            ]}
          />
        ))}
        {segments.map((segment) => {
          const category = CATEGORIES.find((option) => option.id === segment.category);
          return (
            <View
              key={segment.id}
              style={[
                styles.timelineSegment,
                {
                  backgroundColor: category?.color ?? colors.muted,
                  left: `${duration ? (segment.startTime / duration) * 100 : 0}%`,
                  width: `${duration ? Math.max(1, ((segment.endTime - segment.startTime) / duration) * 100) : 1}%`,
                },
              ]}
            />
          );
        })}
        {markStart !== null ? (
          <View
            style={[
              styles.mark,
              {
                backgroundColor: colors.danger,
                left: `${duration ? (markStart / duration) * 100 : 0}%`,
              },
            ]}
          />
        ) : null}
        <View
          style={[
            styles.playhead,
            {
              backgroundColor: colors.text,
              left: `${duration ? (currentTime / duration) * 100 : 0}%`,
            },
          ]}
        />
      </Pressable>
      {analysisCandidates.length ? (
        <View style={styles.timelineLegend}>
          <View
            style={[
              styles.timelineLegendSwatch,
              { backgroundColor: colors.accent, borderColor: colors.accent },
            ]}
          />
          <Text style={[styles.timelineLegendText, { color: colors.muted }]}>
            AI candidates from the latest analysis run
          </Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Button compact variant="secondary" onPress={() => seek(currentTime - 5)}>
          −5s
        </Button>
        <Button compact variant="secondary" onPress={() => seek(currentTime - 1 / 30)}>
          −fr
        </Button>
        <Button compact onPress={() => (isPlaying ? player.pause() : player.play())}>
          {isPlaying ? 'Pause' : 'Play'}
        </Button>
        <Button compact variant="secondary" onPress={() => seek(currentTime + 1 / 30)}>
          +fr
        </Button>
        <Button compact variant="secondary" onPress={() => seek(currentTime + 5)}>
          +5s
        </Button>
      </View>
      <View style={styles.timeRow}>
        <Text style={[styles.time, { color: colors.muted }]}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </Text>
        <ChoiceRow>
          {[0.25, 0.5, 1, 1.5, 2].map((option) => (
            <Pill
              key={option}
              selected={rate === option}
              onPress={() => {
                setRate(option);
                player.playbackRate = option;
              }}
            >
              {option}×
            </Pill>
          ))}
        </ChoiceRow>
      </View>

      {markStart === null ? (
        <Button
          onPress={() => {
            setMarkStart(currentTime);
            player.pause();
          }}
        >
          Mark touch start at {formatTime(currentTime)}
        </Button>
      ) : (
        <Panel>
          <Text style={[styles.help, { color: colors.muted }]}>
            Started at {formatTime(markStart)}. Seek or play to the end of the touch.
          </Text>
          <Button onPress={finishTouch}>End touch at {formatTime(currentTime)}</Button>
          <Button variant="secondary" onPress={() => setMarkStart(null)}>
            Cancel mark
          </Button>
        </Panel>
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        AI candidate review ({analysisCandidates.length})
      </Text>
      {analysisCandidates.length === 0 ? (
        <Panel>
          <Text style={[styles.help, { color: colors.muted }]}>
            No candidates are available for the latest analysis run. Start analysis or wait for the
            current run to finish.
          </Text>
        </Panel>
      ) : (
        analysisCandidates.map((candidate, index) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            index={index}
            active={
              currentTime >= candidate.eventStart && currentTime <= candidate.eventEnd
            }
            pendingCandidateId={pendingCandidateId}
            onPreview={() => {
              seek(candidate.eventStart);
              player.play();
            }}
            onSeek={() => seek(candidate.eventTimestamp)}
            onReview={(action) => setCandidateReview({ candidate, action })}
          />
        ))
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Touches ({segments.length})</Text>
      {segments.length === 0 ? (
        <Panel>
          <Text style={[styles.help, { color: colors.muted }]}>
            Use the player controls to mark the start and end of each touch.
          </Text>
        </Panel>
      ) : (
        segments.map((segment, index) => {
          const result = RESULTS.find((option) => option.id === segment.result);
          const category = CATEGORIES.find((option) => option.id === segment.category);
          return (
            <Panel key={segment.id}>
              <View style={styles.touchHead}>
                <Text style={[styles.touchNumber, { color: colors.muted }]}>#{index + 1}</Text>
                <Text style={[styles.time, { color: colors.text }]}>
                  {formatTime(segment.startTime)}–{formatTime(segment.endTime)}
                </Text>
                {result ? <Pill color={result.color} selected>{result.name}</Pill> : null}
              </View>
              {category ? (
                <Text style={[styles.help, { color: category.color }]}>{category.name}</Text>
              ) : null}
              {segment.labels.length ? (
                <ChoiceRow>
                  {segment.labels.map((label) => (
                    <Pill key={label.id}>{label.name}</Pill>
                  ))}
                </ChoiceRow>
              ) : null}
              {segment.notes ? (
                <Text style={[styles.notes, { color: colors.text }]}>{segment.notes}</Text>
              ) : null}
              <View style={styles.touchActions}>
                <Button
                  compact
                  variant="secondary"
                  onPress={() => {
                    seek(segment.startTime);
                    player.play();
                  }}
                >
                  Replay
                </Button>
                <Button
                  compact
                  variant="secondary"
                  onPress={() =>
                    setEditing({
                      segmentId: segment.id,
                      draft: {
                        startTime: segment.startTime,
                        endTime: segment.endTime,
                        result: segment.result as TouchResult,
                        category: segment.category ?? undefined,
                        notes: segment.notes ?? '',
                        labelIds: segment.labels.map((label) => label.id),
                      },
                    })
                  }
                >
                  Edit
                </Button>
                <Button compact variant="danger" onPress={() => removeSegment(segment.id)}>
                  Delete
                </Button>
              </View>
            </Panel>
          );
        })
      )}

      <SegmentEditor
        visible={Boolean(editing)}
        weapon={video.weapon}
        user={user}
        labels={labels}
        initial={editing?.draft}
        onClose={() => setEditing(undefined)}
        onSave={saveSegment}
      />
      <CandidateReviewEditor
        visible={Boolean(candidateReview)}
        candidate={candidateReview?.candidate}
        action={candidateReview?.action}
        weapon={video.weapon}
        duration={duration}
        pending={Boolean(
          candidateReview && pendingCandidateId === candidateReview.candidate.id,
        )}
        onClose={() => setCandidateReview(undefined)}
        onSubmit={(input) => {
          if (!candidateReview) throw new Error('No candidate is selected.');
          return submitCandidateReview(candidateReview.candidate, input);
        }}
      />
    </Screen>
  );
}

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
  action?: 'start' | 'retry' | 'cancel';
  error: string;
  notice: string;
  onStart: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const active = Boolean(job && ACTIVE_ANALYSIS_STATUSES.has(job.status));
  const progress = Math.max(0, Math.min(1, job?.progress ?? 0));
  const statusColor =
    job?.status === 'completed'
      ? colors.success
      : job?.status === 'failed' || job?.status === 'cancelled'
        ? colors.danger
        : colors.accent;

  return (
    <Panel>
      <View style={styles.analysisHeader}>
        <View style={styles.analysisTitleBlock}>
          <Text style={[styles.analysisTitle, { color: colors.text }]}>AI-assisted review</Text>
          <Text style={[styles.help, { color: colors.muted }]}>
            Candidates stay separate from your statistics until you review them.
          </Text>
        </View>
        {job ? <Pill color={statusColor} selected>{formatStage(job.status)}</Pill> : null}
      </View>

      {job ? (
        <>
          <View style={styles.analysisFacts}>
            <View style={[styles.analysisFact, { backgroundColor: colors.elevated }]}>
              <Text style={[styles.factLabel, { color: colors.muted }]}>Stage</Text>
              <Text style={[styles.factValue, { color: colors.text }]}>
                {formatStage(job.stage)}
              </Text>
            </View>
            <View style={[styles.analysisFact, { backgroundColor: colors.elevated }]}>
              <Text style={[styles.factLabel, { color: colors.muted }]}>Progress</Text>
              <Text style={[styles.factValue, { color: colors.text }]}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
            <View style={[styles.analysisFact, { backgroundColor: colors.elevated }]}>
              <Text style={[styles.factLabel, { color: colors.muted }]}>Candidates</Text>
              <Text style={[styles.factValue, { color: colors.text }]}>{candidateCount}</Text>
            </View>
            <View style={[styles.analysisFact, { backgroundColor: colors.elevated }]}>
              <Text style={[styles.factLabel, { color: colors.muted }]}>Cost</Text>
              <Text style={[styles.factValue, { color: colors.text }]}>
                {typeof job.costUsd === 'number' ? `$${job.costUsd.toFixed(4)}` : '—'}
              </Text>
            </View>
          </View>
          <View style={[styles.analysisProgress, { backgroundColor: colors.elevated }]}>
            <View
              style={[
                styles.analysisProgressFill,
                { backgroundColor: colors.accent, width: `${progress * 100}%` },
              ]}
            />
          </View>
          {job.error ? <Message error>{job.error}</Message> : null}
        </>
      ) : (
        <Text style={[styles.help, { color: colors.muted }]}>
          Analyze this video to detect possible phrase endings and awarded points.
        </Text>
      )}

      <View style={styles.analysisButtons}>
        {!job || job.status === 'completed' ? (
          <Button
            compact
            onPress={onStart}
            disabled={Boolean(action)}
            busy={action === 'start'}
          >
            {job?.status === 'completed' ? 'Analyze again' : 'Analyze bout'}
          </Button>
        ) : null}
        {job && active ? (
          <Button
            compact
            variant="danger"
            onPress={onCancel}
            disabled={Boolean(action) || job.cancelRequested}
            busy={action === 'cancel'}
          >
            Cancel analysis
          </Button>
        ) : null}
        {job && (job.status === 'failed' || job.status === 'cancelled') ? (
          <Button
            compact
            onPress={onRetry}
            disabled={Boolean(action)}
            busy={action === 'retry'}
          >
            Retry analysis
          </Button>
        ) : null}
      </View>
      {error ? <Message error>{error}</Message> : null}
      {notice ? <Message>{notice}</Message> : null}
    </Panel>
  );
}

function CandidateCard({
  candidate,
  index,
  active,
  pendingCandidateId,
  onPreview,
  onSeek,
  onReview,
}: {
  candidate: AnalysisCandidate;
  index: number;
  active: boolean;
  pendingCandidateId?: string;
  onPreview: () => void;
  onSeek: () => void;
  onReview: (action: ReviewAction) => void;
}) {
  const { colors } = useTheme();
  const evidence = parseEvidence(candidate.evidenceJson);
  const pending = pendingCandidateId === candidate.id;
  const latestFeedback = [...candidate.feedback].sort(
    (left, right) => right.createdAt - left.createdAt,
  )[0];
  const stateColor =
    candidate.reviewState === 'accepted' || candidate.reviewState === 'corrected'
      ? colors.success
      : candidate.reviewState === 'rejected'
        ? colors.danger
        : colors.accent;

  return (
    <Panel style={active ? { borderColor: colors.accent } : undefined}>
      <View style={styles.candidateHeader}>
        <Pressable onPress={onSeek}>
          <Text style={[styles.candidateTimestamp, { color: colors.accent }]}>
            {formatTime(candidate.eventTimestamp)}
          </Text>
        </Pressable>
        <Pill color={stateColor} selected>{reviewStateLabel(candidate.reviewState)}</Pill>
        <Text style={[styles.candidateIndex, { color: colors.muted }]}>
          Candidate {index + 1}
        </Text>
      </View>

      <View style={styles.candidateFacts}>
        <View style={[styles.candidateFact, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.factLabel, { color: colors.muted }]}>Confidence</Text>
          <Text style={[styles.factValue, { color: colors.text }]}>
            {Math.round(candidate.confidence * 100)}%
          </Text>
        </View>
        <View style={[styles.candidateFact, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.factLabel, { color: colors.muted }]}>Point</Text>
          <Text style={[styles.factValue, { color: colors.text }]}>
            {candidate.pointAwarded === true
              ? 'Awarded'
              : candidate.pointAwarded === false
                ? 'Not awarded'
                : 'Unknown'}
          </Text>
        </View>
        <View style={[styles.candidateFact, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.factLabel, { color: colors.muted }]}>Camera side</Text>
          <Text style={[styles.factValue, { color: colors.text }]}>
            {awardedSideLabel(candidate.awardedSide)}
          </Text>
        </View>
      </View>

      <Text style={[styles.time, { color: colors.muted }]}>
        Window {formatTime(candidate.eventStart)}–{formatTime(candidate.eventEnd)}
      </Text>
      {evidence.length ? (
        <View style={styles.evidenceBlock}>
          <Text style={[styles.label, { color: colors.muted }]}>EVIDENCE</Text>
          {evidence.map((item, evidenceIndex) => (
            <Text
              key={`${candidate.id}:evidence:${evidenceIndex}`}
              style={[styles.evidenceItem, { color: colors.text }]}
            >
              • {item}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={[styles.help, { color: colors.muted }]}>
          No model evidence was recorded.
        </Text>
      )}
      <Text style={[styles.modelText, { color: colors.muted }]}>
        {candidate.model}
        {candidate.provider ? ` · ${candidate.provider}` : ''} · prompt {candidate.promptVersion}
      </Text>

      {candidate.segment ? (
        <View
          style={[
            styles.linkedSegment,
            { backgroundColor: colors.elevated, borderLeftColor: colors.success },
          ]}
        >
          <Text style={[styles.help, { color: colors.text }]}>
            Created touch {formatTime(candidate.segment.startTime)}–
            {formatTime(candidate.segment.endTime)} ·{' '}
            {RESULTS.find((result) => result.id === candidate.segment?.result)?.name ??
              candidate.segment.result}
          </Text>
        </View>
      ) : null}
      {latestFeedback?.reason || latestFeedback?.comment ? (
        <View style={[styles.feedbackBlock, { borderTopColor: colors.border }]}>
          {latestFeedback.reason ? (
            <Text style={[styles.help, { color: colors.muted }]}>
              Notes: {latestFeedback.reason}
            </Text>
          ) : null}
          {latestFeedback.comment ? (
            <Text style={[styles.help, { color: colors.muted }]}>
              Comment: {latestFeedback.comment}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.candidateActions}>
        <Button compact variant="secondary" onPress={onPreview}>
          Preview
        </Button>
        {candidate.reviewState === 'unreviewed' ? (
          <>
            <Button
              compact
              onPress={() => onReview('accept')}
              disabled={Boolean(pendingCandidateId)}
              busy={pending}
            >
              Accept
            </Button>
            <Button
              compact
              variant="secondary"
              onPress={() => onReview('correct')}
              disabled={Boolean(pendingCandidateId)}
            >
              Correct
            </Button>
            <Button
              compact
              variant="danger"
              onPress={() => onReview('reject')}
              disabled={Boolean(pendingCandidateId)}
            >
              Reject
            </Button>
          </>
        ) : null}
      </View>
    </Panel>
  );
}

function CandidateReviewEditor({
  visible,
  candidate,
  action,
  weapon,
  duration,
  pending,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  candidate?: AnalysisCandidate;
  action?: ReviewAction;
  weapon: string;
  duration: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: CandidateReviewInput) => Promise<void>;
}) {
  const { colors } = useTheme();
  const [result, setResult] = useState<AnalysisReviewResult | ''>('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [notes, setNotes] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible || !candidate) return;
    setResult('');
    setStartTime(String(candidate.eventStart));
    setEndTime(String(candidate.eventEnd));
    setTimestamp(String(candidate.eventTimestamp));
    setNotes('');
    setComment('');
    setSaving(false);
    setError('');
  }, [action, candidate?.id, visible]);

  if (!candidate || !action) return null;
  const currentCandidate = candidate;
  const rejecting = action === 'reject';
  const editingTimes = action === 'correct';

  async function saveReview() {
    if (saving || pending) return;
    setError('');
    const normalizedNotes = notes.trim() || undefined;
    const normalizedComment = comment.trim() || undefined;
    let input: CandidateReviewInput;

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
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!saving) onClose();
      }}
    >
      <Screen>
        <View style={styles.header}>
          <PageTitle>{title}</PageTitle>
          <Button compact variant="secondary" onPress={onClose} disabled={saving}>
            Close
          </Button>
        </View>
        <Panel>
          <Text style={[styles.help, { color: colors.muted }]}>
            AI reported {awardedSideLabel(currentCandidate.awardedSide).toLowerCase()} at{' '}
            {formatTime(currentCandidate.eventTimestamp)}. Left and right are camera positions, not
            your side.
          </Text>

          {editingTimes ? (
            <>
              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Field
                    label="Start (seconds)"
                    value={startTime}
                    onChangeText={setStartTime}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.column}>
                  <Field
                    label="End (seconds)"
                    value={endTime}
                    onChangeText={setEndTime}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <Field
                label="Point timestamp"
                value={timestamp}
                onChangeText={setTimestamp}
                keyboardType="decimal-pad"
              />
            </>
          ) : !rejecting ? (
            <View style={[styles.originalWindow, { backgroundColor: colors.elevated }]}>
              <Text style={[styles.time, { color: colors.muted }]}>
                Segment {formatTime(currentCandidate.eventStart)}–
                {formatTime(currentCandidate.eventEnd)} · point at{' '}
                {formatTime(currentCandidate.eventTimestamp)}
              </Text>
            </View>
          ) : null}

          {!rejecting ? (
            <>
              <Text style={[styles.label, { color: colors.muted }]}>RESULT RELATIVE TO YOU</Text>
              <Text style={[styles.help, { color: colors.muted }]}>
                Select this explicitly. The camera-side award is never converted automatically.
              </Text>
              <ChoiceRow>
                {resultsForWeapon(weapon).map((option) => (
                  <Pill
                    key={option.id}
                    color={option.color}
                    selected={result === option.id}
                    onPress={() => setResult(option.id)}
                  >
                    {option.name}
                  </Pill>
                ))}
              </ChoiceRow>
            </>
          ) : null}

          <Field
            label={rejecting ? 'Rejection notes' : 'Touch notes'}
            value={notes}
            onChangeText={setNotes}
            multiline
            autoCapitalize="sentences"
            placeholder={
              rejecting
                ? 'Why is this not a touch?'
                : 'Optional notes saved on the created touch'
            }
          />
          <Field
            label="Reviewer comment"
            value={comment}
            onChangeText={setComment}
            multiline
            autoCapitalize="sentences"
            placeholder="Optional feedback about the model output"
          />
          {error ? <Message error>{error}</Message> : null}
          <Button
            variant={rejecting ? 'danger' : 'primary'}
            onPress={saveReview}
            busy={saving || pending}
            disabled={!rejecting && !result}
          >
            {action === 'accept'
              ? 'Accept and create touch'
              : action === 'correct'
                ? 'Save correction'
                : 'Reject candidate'}
          </Button>
        </Panel>
      </Screen>
    </Modal>
  );
}

function SegmentEditor({
  visible,
  weapon,
  user,
  labels,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  weapon: string;
  user: User;
  labels: Label[];
  initial?: SegmentDraft;
  onClose: () => void;
  onSave: (draft: SegmentDraft) => Promise<void>;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<SegmentDraft | undefined>(initial);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setDraft(initial), [initial]);
  if (!draft) return null;
  const currentDraft = draft;

  function toggleLabel(labelId: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            labelIds: current.labelIds.includes(labelId)
              ? current.labelIds.filter((value) => value !== labelId)
              : [...current.labelIds, labelId],
          }
        : current,
    );
  }

  async function addLabel() {
    const name = newLabel.trim();
    if (!name) return;
    const category = currentDraft.category ?? categoriesForWeapon(weapon)[0]?.id;
    if (!category) return;
    const labelId = id();
    await db.transact(
      db.tx.labels[labelId]
        .update({ name, category, isCustom: true })
        .link({ owner: user.id }),
    );
    setDraft((current) =>
      current ? { ...current, labelIds: [...current.labelIds, labelId] } : current,
    );
    setNewLabel('');
  }

  async function save() {
    setError('');
    setBusy(true);
    try {
      if (currentDraft.endTime <= currentDraft.startTime) {
        throw new Error('End time must be after start time.');
      }
      await onSave(currentDraft);
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not save touch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen>
        <View style={styles.header}>
          <PageTitle>Edit touch</PageTitle>
          <Button compact variant="secondary" onPress={onClose}>
            Close
          </Button>
        </View>
        <Panel>
          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Field
                label="Start (seconds)"
                value={String(draft.startTime)}
                onChangeText={(value) =>
                  setDraft((current) =>
                    current ? { ...current, startTime: Number(value) || 0 } : current,
                  )
                }
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.column}>
              <Field
                label="End (seconds)"
                value={String(draft.endTime)}
                onChangeText={(value) =>
                  setDraft((current) =>
                    current ? { ...current, endTime: Number(value) || 0 } : current,
                  )
                }
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>RESULT</Text>
          <ChoiceRow>
            {resultsForWeapon(weapon).map((result) => (
              <Pill
                key={result.id}
                color={result.color}
                selected={draft.result === result.id}
                onPress={() => setDraft((current) => current && { ...current, result: result.id })}
              >
                {result.name}
              </Pill>
            ))}
          </ChoiceRow>

          <Text style={[styles.label, { color: colors.muted }]}>CATEGORY</Text>
          <ChoiceRow>
            {categoriesForWeapon(weapon).map((category) => (
              <Pill
                key={category.id}
                color={category.color}
                selected={draft.category === category.id}
                onPress={() =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          category: current.category === category.id ? undefined : category.id,
                        }
                      : current,
                  )
                }
              >
                {category.short}
              </Pill>
            ))}
          </ChoiceRow>

          <Text style={[styles.label, { color: colors.muted }]}>ACTION LABELS</Text>
          <ChoiceRow>
            {labels
              .filter((label) => !draft.category || label.category === draft.category)
              .map((label) => (
                <Pill
                  key={label.id}
                  selected={draft.labelIds.includes(label.id)}
                  onPress={() => toggleLabel(label.id)}
                >
                  {label.name}
                </Pill>
              ))}
          </ChoiceRow>
          <Field
            label="New custom label"
            value={newLabel}
            onChangeText={setNewLabel}
            autoCapitalize="sentences"
          />
          <Button variant="secondary" onPress={addLabel} disabled={!newLabel.trim()}>
            Add label
          </Button>

          <Field
            label="Notes"
            value={draft.notes}
            onChangeText={(notes) =>
              setDraft((current) => (current ? { ...current, notes } : current))
            }
            multiline
            autoCapitalize="sentences"
            placeholder="What happened on this touch?"
          />
          {error ? <Message error>{error}</Message> : null}
          <Button onPress={save} busy={busy}>
            Save touch
          </Button>
        </Panel>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  score: { fontSize: 27, fontWeight: '700', fontVariant: ['tabular-nums'] },
  analysisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  analysisTitleBlock: { flex: 1, gap: 4 },
  analysisTitle: { fontSize: 18, fontWeight: '700' },
  analysisFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  analysisFact: { width: '48%', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  analysisButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  analysisProgress: { height: 7, borderRadius: 7, overflow: 'hidden' },
  analysisProgressFill: { height: '100%', borderRadius: 7 },
  factLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  factValue: { fontSize: 14, fontWeight: '600' },
  playerShell: { aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden' },
  player: { width: '100%', height: '100%' },
  playerError: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  timeline: { height: 40, borderRadius: 7, overflow: 'hidden', position: 'relative' },
  timelineSegment: { position: 'absolute', top: 14, bottom: 4, borderRadius: 4 },
  timelineCandidate: {
    position: 'absolute',
    top: 3,
    height: 7,
    minWidth: 5,
    borderWidth: 1,
    borderRadius: 2,
    zIndex: 2,
  },
  timelineLegend: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -10 },
  timelineLegendSwatch: { width: 18, height: 6, borderWidth: 1, borderRadius: 2 },
  timelineLegendText: { fontSize: 12 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 3 },
  controls: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  timeRow: { gap: 10 },
  time: { fontSize: 13, fontVariant: ['tabular-nums'] },
  help: { fontSize: 14, lineHeight: 20 },
  sectionTitle: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  touchHead: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  touchNumber: { fontSize: 13, fontWeight: '700' },
  notes: { fontSize: 14, lineHeight: 20 },
  touchActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  candidateHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  candidateTimestamp: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  candidateIndex: { marginLeft: 'auto', fontSize: 12 },
  candidateFacts: { flexDirection: 'row', gap: 7 },
  candidateFact: { flex: 1, minWidth: 82, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 8, gap: 2 },
  evidenceBlock: { gap: 4 },
  evidenceItem: { fontSize: 14, lineHeight: 20 },
  modelText: { fontSize: 12, lineHeight: 17 },
  linkedSegment: { borderLeftWidth: 3, borderRadius: 8, padding: 10 },
  feedbackBlock: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 4 },
  candidateActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  originalWindow: { borderRadius: 9, padding: 11 },
  twoColumns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
});
