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
import { getPlaybackUrl } from '../lib/api';
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
type Video = InstaQLEntity<AppSchema, 'videos', { segments: { labels: {} } }>;
type Segment = Video['segments'][number];
type Label = InstaQLEntity<AppSchema, 'labels'>;

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
    getPlaybackUrl(video.s3Key)
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
  }, [video.s3Key]);

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
    </Screen>
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
  playerShell: { aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden' },
  player: { width: '100%', height: '100%' },
  playerError: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  timeline: { height: 30, borderRadius: 7, overflow: 'hidden', position: 'relative' },
  timelineSegment: { position: 'absolute', top: 4, bottom: 4, borderRadius: 4 },
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
  touchActions: { flexDirection: 'row', gap: 8 },
  twoColumns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
});
