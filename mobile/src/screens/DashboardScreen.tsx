import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { id, type User } from '@instantdb/react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { db } from '../lib/db';
import { uploadVideo } from '../lib/api';
import {
  WEAPONS,
  formatDate,
  isReceived,
  isScored,
  weaponName,
  type Weapon,
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

export function DashboardScreen({
  user,
  navigation,
}: {
  user: User;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
}) {
  const { colors } = useTheme();
  const [showUpload, setShowUpload] = useState(false);
  const query = db.useQuery({
    videos: {
      $: { where: { 'owner.id': user.id }, order: { createdAt: 'desc' } },
      segments: {},
    },
  });

  if (query.isLoading) return <Loading label="Loading bouts…" />;
  if (query.error) {
    return (
      <Screen>
        <Message error>{query.error.message}</Message>
      </Screen>
    );
  }

  const videos = query.data.videos;
  const segments = videos.flatMap((video) => video.segments);
  const scored = segments.filter((segment) => isScored(segment.result)).length;
  const received = segments.filter((segment) => isReceived(segment.result)).length;

  function deleteVideo(videoId: string, segmentIds: string[]) {
    Alert.alert('Delete bout?', 'The video record and all analyzed touches will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          db.transact([
            ...segmentIds.map((segmentId) => db.tx.segments[segmentId].delete()),
            db.tx.videos[videoId].delete(),
          ]),
      },
    ]);
  }

  return (
    <Screen>
      <View style={styles.headingRow}>
        <PageTitle
          subtitle={`${videos.length} videos · ${segments.length} touches${
            scored + received ? ` · ${Math.round((scored / (scored + received)) * 100)}% scored` : ''
          }`}
        >
          My Bouts
        </PageTitle>
        <Button compact onPress={() => setShowUpload(true)}>
          Upload
        </Button>
      </View>

      {videos.length === 0 ? (
        <Panel style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No bouts yet</Text>
          <Text style={[styles.body, { color: colors.muted }]}>
            Upload your first fencing video to start breaking down touches.
          </Text>
          <Button onPress={() => setShowUpload(true)}>Upload your first video</Button>
        </Panel>
      ) : (
        videos.map((video) => {
          const videoScored = video.segments.filter((segment) => isScored(segment.result)).length;
          const videoReceived = video.segments.filter((segment) =>
            isReceived(segment.result),
          ).length;
          return (
            <Pressable
              key={video.id}
              onPress={() => navigation.navigate('Bout', { videoId: video.id, title: video.title })}
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
            >
              <Panel>
                <View style={styles.cardTop}>
                  <Pill selected>{weaponName(video.weapon)}</Pill>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {formatDate(video.boutDate ?? video.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{video.title}</Text>
                {video.opponent || video.event ? (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {[video.opponent ? `vs ${video.opponent}` : '', video.event]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
                <View style={styles.cardBottom}>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {video.segments.length} touches
                  </Text>
                  {videoScored + videoReceived ? (
                    <Text style={[styles.score, { color: colors.text }]}>
                      {videoScored}–{videoReceived}
                    </Text>
                  ) : null}
                  <Button
                    compact
                    variant="danger"
                    onPress={() =>
                      deleteVideo(
                        video.id,
                        video.segments.map((segment) => segment.id),
                      )
                    }
                  >
                    Delete
                  </Button>
                </View>
              </Panel>
            </Pressable>
          );
        })
      )}
      <UploadSheet user={user} visible={showUpload} onClose={() => setShowUpload(false)} />
    </Screen>
  );
}

function UploadSheet({
  user,
  visible,
  onClose,
}: {
  user: User;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { data } = db.useQuery({
    profiles: { $: { where: { '$user.id': user.id } } },
  });
  const preferred = data?.profiles[0]?.defaultWeapon as Weapon | undefined;
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [weapon, setWeapon] = useState<Weapon>('foil');
  const [opponent, setOpponent] = useState('');
  const [event, setEvent] = useState('');
  const [boutDate, setBoutDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (preferred && WEAPONS.some((option) => option.id === preferred)) setWeapon(preferred);
  }, [preferred]);

  async function pickVideo(eventValue?: GestureResponderEvent) {
    eventValue?.preventDefault();
    const result = await DocumentPicker.getDocumentAsync({
      type: 'video/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const picked = result.assets[0];
    setAsset(picked);
    if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ''));
  }

  async function submit() {
    if (!asset) return;
    setError('');
    setProgress(0);
    try {
      const parsedDate = boutDate.trim() ? new Date(boutDate.trim()).getTime() : undefined;
      if (boutDate.trim() && !Number.isFinite(parsedDate)) {
        throw new Error('Use YYYY-MM-DD for the bout date.');
      }
      const { key } = await uploadVideo(asset, setProgress);
      await db.transact(
        db.tx.videos[id()]
          .update({
            title: title.trim() || asset.name,
            weapon,
            s3Key: key,
            opponent: opponent.trim() || undefined,
            event: event.trim() || undefined,
            boutDate: parsedDate,
            createdAt: Date.now(),
          })
          .link({ owner: user.id }),
      );
      setAsset(null);
      setTitle('');
      setOpponent('');
      setEvent('');
      setBoutDate('');
      setProgress(null);
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Upload failed.');
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen>
        <View style={styles.headingRow}>
          <PageTitle subtitle="MP4, MOV, and other device-supported video files">
            Upload a bout
          </PageTitle>
          <Button compact variant="secondary" onPress={onClose} disabled={busy}>
            Close
          </Button>
        </View>
        <Panel>
          <Button variant="secondary" onPress={pickVideo} disabled={busy}>
            {asset ? asset.name : 'Choose video file'}
          </Button>
          {asset?.size ? (
            <Text style={[styles.meta, { color: colors.muted }]}>
              {(asset.size / 1024 / 1024).toFixed(1)} MB
            </Text>
          ) : null}
          <Field label="Title" value={title} onChangeText={setTitle} editable={!busy} />
          <View style={styles.group}>
            <Text style={[styles.label, { color: colors.muted }]}>WEAPON</Text>
            <ChoiceRow>
              {WEAPONS.map((option) => (
                <Pill
                  key={option.id}
                  selected={weapon === option.id}
                  onPress={() => setWeapon(option.id)}
                >
                  {option.name}
                </Pill>
              ))}
            </ChoiceRow>
          </View>
          <Field
            label="Opponent (optional)"
            value={opponent}
            onChangeText={setOpponent}
            editable={!busy}
            autoCapitalize="words"
          />
          <Field
            label="Event (optional)"
            value={event}
            onChangeText={setEvent}
            editable={!busy}
            autoCapitalize="words"
          />
          <Field
            label="Bout date (optional)"
            value={boutDate}
            onChangeText={setBoutDate}
            placeholder="YYYY-MM-DD"
            editable={!busy}
          />
          {progress !== null ? (
            <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: colors.accent, width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
          ) : null}
          {error ? <Message error>{error}</Message> : null}
          <Button onPress={submit} busy={busy} disabled={!asset || !title.trim()}>
            {progress === null ? 'Upload bout' : `Uploading ${Math.round(progress * 100)}%`}
          </Button>
        </Panel>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 19, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 19 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  score: { marginLeft: 'auto', fontSize: 19, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', paddingVertical: 36 },
  emptyTitle: { fontSize: 21, fontWeight: '700' },
  group: { gap: 8 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
  progressTrack: { height: 7, borderRadius: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8 },
});
