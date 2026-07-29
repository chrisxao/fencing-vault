import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { User } from '@instantdb/react-native';
import { db } from '../lib/db';
import {
  CATEGORIES,
  WEAPONS,
  isReceived,
  isScored,
  type Weapon,
} from '../lib/fencing';
import { useTheme } from '../lib/theme';
import { ChoiceRow, Loading, Message, PageTitle, Panel, Pill, Screen } from '../components/ui';

export function StatsScreen({ user }: { user: User }) {
  const { colors } = useTheme();
  const [weapon, setWeapon] = useState<Weapon | 'all'>('all');
  const query = db.useQuery({
    videos: {
      $: { where: { 'owner.id': user.id } },
      segments: { labels: {} },
    },
  });

  const summary = useMemo(() => {
    const videos = query.data?.videos.filter((video) => weapon === 'all' || video.weapon === weapon) ?? [];
    const segments = videos.flatMap((video) => video.segments);
    const scored = segments.filter((segment) => isScored(segment.result)).length;
    const received = segments.filter((segment) => isReceived(segment.result)).length;
    const categories = CATEGORIES.map((category) => {
      const selected = segments.filter((segment) => segment.category === category.id);
      const won = selected.filter((segment) => isScored(segment.result)).length;
      const lost = selected.filter((segment) => isReceived(segment.result)).length;
      return {
        ...category,
        total: selected.length,
        scored: won,
        received: lost,
        success: won + lost ? won / (won + lost) : 0,
      };
    }).filter((category) => category.total > 0);
    const labels = new Map<string, { total: number; scored: number; received: number }>();
    for (const segment of segments) {
      for (const label of segment.labels) {
        const row = labels.get(label.name) ?? { total: 0, scored: 0, received: 0 };
        row.total += 1;
        row.scored += isScored(segment.result) ? 1 : 0;
        row.received += isReceived(segment.result) ? 1 : 0;
        labels.set(label.name, row);
      }
    }
    return {
      videoCount: videos.length,
      touchCount: segments.length,
      scored,
      received,
      categories,
      labels: [...labels.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8),
    };
  }, [query.data, weapon]);

  if (query.isLoading) return <Loading label="Calculating stats…" />;
  if (query.error) {
    return (
      <Screen>
        <Message error>{query.error.message}</Message>
      </Screen>
    );
  }

  const decided = summary.scored + summary.received;
  const success = decided ? Math.round((summary.scored / decided) * 100) : 0;
  const maxCategory = Math.max(1, ...summary.categories.map((category) => category.total));

  return (
    <Screen>
      <PageTitle subtitle="A clear view of the touches you have analyzed">Stats</PageTitle>
      <ChoiceRow>
        <Pill selected={weapon === 'all'} onPress={() => setWeapon('all')}>
          All
        </Pill>
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

      <View style={styles.metricGrid}>
        <Metric label="Bouts" value={summary.videoCount} />
        <Metric label="Touches" value={summary.touchCount} />
        <Metric label="Scored" value={summary.scored} color={colors.success} />
        <Metric label="Received" value={summary.received} color={colors.danger} />
      </View>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Touch success</Text>
        <Text style={[styles.heroMetric, { color: colors.text }]}>{success}%</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {summary.scored} scored · {summary.received} received
        </Text>
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>General categories</Text>
        {summary.categories.length ? (
          summary.categories.map((category) => (
            <View key={category.id} style={styles.breakdown}>
              <View style={styles.breakdownTop}>
                <Text style={[styles.rowName, { color: colors.text }]}>{category.name}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {Math.round(category.success * 100)}% · {category.total}
                </Text>
              </View>
              <View style={[styles.track, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.bar,
                    {
                      backgroundColor: category.color,
                      width: `${(category.total / maxCategory) * 100}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))
        ) : (
          <Text style={[styles.meta, { color: colors.muted }]}>
            Add categories to touches to see your tactical breakdown.
          </Text>
        )}
      </Panel>

      {summary.labels.length ? (
        <Panel>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Frequent actions</Text>
          {summary.labels.map(([name, row]) => (
            <View key={name} style={[styles.labelRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.rowName, { color: colors.text }]}>{name}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {row.total} uses · {row.scored}–{row.received}
              </Text>
            </View>
          ))}
        </Panel>
      ) : null}
    </Screen>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <Panel style={styles.metric}>
      <Text style={[styles.metricValue, { color: color ?? colors.text }]}>{value}</Text>
      <Text style={[styles.meta, { color: colors.muted }]}>{label}</Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexBasis: '46%', flexGrow: 1, gap: 2 },
  metricValue: { fontSize: 27, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heroMetric: { fontSize: 44, fontWeight: '700', letterSpacing: -1 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 19 },
  breakdown: { gap: 7 },
  breakdownTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  rowName: { fontSize: 14, fontWeight: '600', flex: 1 },
  track: { height: 7, borderRadius: 8, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 8 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
