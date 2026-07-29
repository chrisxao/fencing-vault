import { i } from '@instantdb/react-native';

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    profiles: i.entity({
      name: i.string(),
      defaultWeapon: i.string().optional(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    credentials: i.entity({
      email: i.string().unique().indexed(),
      passwordHash: i.string(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    videos: i.entity({
      title: i.string(),
      weapon: i.string(),
      s3Key: i.string(),
      opponent: i.string().optional(),
      event: i.string().optional(),
      boutDate: i.number().optional(),
      duration: i.number().optional(),
      createdAt: i.number().indexed(),
    }),
    segments: i.entity({
      startTime: i.number(),
      endTime: i.number(),
      category: i.string().optional(),
      result: i.string(),
      notes: i.string().optional(),
      createdAt: i.number(),
    }),
    comments: i.entity({
      text: i.string(),
      timestamp: i.number().optional(),
      createdAt: i.number(),
    }),
    labels: i.entity({
      name: i.string(),
      category: i.string(),
      isCustom: i.boolean(),
    }),
  },
  links: {
    profileUser: {
      forward: { on: 'profiles', has: 'one', label: '$user', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'one', label: 'profile' },
    },
    credentialUser: {
      forward: { on: 'credentials', has: 'one', label: '$user', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'one', label: 'credential' },
    },
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
export interface AppSchema extends _AppSchema {}

const schema: AppSchema = _schema;
export default schema;
