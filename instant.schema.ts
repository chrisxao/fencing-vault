// Instant DB schema for Fencing Vault.
// Push to production with: npx instant-cli@latest push schema
import { i } from '@instantdb/react';

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    videos: i.entity({
      title: i.string(),
      weapon: i.string(), // 'foil' | 'epee' | 'sabre'
      s3Key: i.string(),
      opponent: i.string().optional(),
      event: i.string().optional(),
      boutDate: i.number().optional(), // ms timestamp of when the bout happened
      duration: i.number().optional(), // seconds
      createdAt: i.number().indexed(),
    }),
    // A "segment" is one touch/point of the bout, bounded by timestamps.
    segments: i.entity({
      startTime: i.number(), // seconds into the video
      endTime: i.number(),
      category: i.string().optional(), // general category id, see src/lib/labels.ts
      result: i.string(), // 'scored' | 'received' | 'double' | 'simultaneous' | 'no-touch'
      notes: i.string().optional(),
      createdAt: i.number(),
    }),
    // Comments either belong to a segment (touch discussion) or carry a
    // `timestamp` and belong directly to the video (frame comment).
    comments: i.entity({
      text: i.string(),
      timestamp: i.number().optional(), // seconds; set for frame comments
      createdAt: i.number(),
    }),
    // Specific action labels (parry riposte, counter attack, ...). Seed labels
    // are created per-user on first login; users can add custom ones.
    labels: i.entity({
      name: i.string(),
      category: i.string(), // suggested general category id
      isCustom: i.boolean(),
    }),
  },
  links: {
    videoOwner: {
      forward: { on: 'videos', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'videos' },
    },
    segmentVideo: {
      forward: { on: 'segments', has: 'one', label: 'video', onDelete: 'cascade' },
      reverse: { on: 'videos', has: 'many', label: 'segments' },
    },
    commentVideo: {
      forward: { on: 'comments', has: 'one', label: 'video', onDelete: 'cascade' },
      reverse: { on: 'videos', has: 'many', label: 'comments' },
    },
    commentSegment: {
      forward: { on: 'comments', has: 'one', label: 'segment', onDelete: 'cascade' },
      reverse: { on: 'segments', has: 'many', label: 'comments' },
    },
    segmentLabels: {
      forward: { on: 'segments', has: 'many', label: 'labels' },
      reverse: { on: 'labels', has: 'many', label: 'segments' },
    },
    labelOwner: {
      forward: { on: 'labels', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'labels' },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
