// Instant DB schema for Fencing Vault.
// Push to production with: npx instant-cli@latest push schema
import { i } from '@instantdb/react';

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    // Display name + preferences. One profile per user.
    profiles: i.entity({
      name: i.string(),
      defaultWeapon: i.string().optional(), // 'foil' | 'epee' | 'sabre'
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    // Password hashes — client access denied in instant.perms.ts; only the
    // Express admin SDK reads/writes these.
    credentials: i.entity({
      email: i.string().unique().indexed(),
      passwordHash: i.string(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    videos: i.entity({
      title: i.string(),
      weapon: i.string(), // 'foil' | 'epee' | 'sabre'
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
    analysisJobs: i.entity({
      runId: i.string().optional().indexed(),
      status: i.string().indexed(),
      stage: i.string(),
      progress: i.number(),
      configHash: i.string().indexed(),
      sourceChecksum: i.string().indexed(),
      attempts: i.number(),
      model: i.string().optional(),
      provider: i.string().optional(),
      promptVersion: i.string().optional(),
      usageJson: i.string().optional(),
      costUsd: i.number().optional(),
      error: i.string().optional(),
      cancelRequested: i.boolean(),
      createdAt: i.number().indexed(),
      updatedAt: i.number(),
      startedAt: i.number().optional(),
      completedAt: i.number().optional(),
    }),
    analysisClips: i.entity({
      runId: i.string().optional().indexed(),
      index: i.number(),
      sourceStart: i.number(),
      sourceEnd: i.number(),
      normalizedStart: i.number(),
      normalizedEnd: i.number(),
      overlap: i.number(),
      s3Key: i.string(),
      checksum: i.string().indexed(),
      status: i.string(),
      attempt: i.number(),
      resultJson: i.string().optional(),
      usageJson: i.string().optional(),
      costUsd: i.number().optional(),
      error: i.string().optional(),
      metadataJson: i.string().optional(),
      createdAt: i.number(),
      updatedAt: i.number(),
      startedAt: i.number().optional(),
      completedAt: i.number().optional(),
    }),
    analysisCandidates: i.entity({
      runId: i.string().optional().indexed(),
      eventStart: i.number(),
      eventEnd: i.number(),
      eventTimestamp: i.number(),
      candidatePhraseEnd: i.boolean(),
      pointAwarded: i.boolean().optional(),
      awardedSide: i.string().optional(),
      confidence: i.number(),
      evidenceJson: i.string(),
      rawResponseJson: i.string(),
      model: i.string(),
      provider: i.string(),
      promptVersion: i.string(),
      reviewState: i.string().indexed(),
      reviewedAt: i.number().optional(),
      dedupKey: i.string().indexed(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    analysisFeedback: i.entity({
      action: i.string(),
      reason: i.string().optional(),
      comment: i.string().optional(),
      beforeJson: i.string(),
      afterJson: i.string(),
      createdAt: i.number().indexed(),
    }),
    ingestionSources: i.entity({
      type: i.string().indexed(),
      name: i.string(),
      enabled: i.boolean(),
      dryRun: i.boolean(),
      configJson: i.string(),
      checkpointJson: i.string().optional(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    ingestionJobs: i.entity({
      sourceType: i.string(),
      externalId: i.string().optional(),
      externalUrl: i.string().optional(),
      dedupKey: i.string().indexed(),
      status: i.string().indexed(),
      metadataJson: i.string(),
      checkpointJson: i.string().optional(),
      selected: i.boolean(),
      error: i.string().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number(),
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
    analysisJobOwner: {
      forward: { on: 'analysisJobs', has: 'one', label: 'owner', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'analysisJobs' },
    },
    analysisJobVideo: {
      forward: { on: 'analysisJobs', has: 'one', label: 'video', onDelete: 'cascade' },
      reverse: { on: 'videos', has: 'many', label: 'analysisJobs' },
    },
    analysisClipOwner: {
      forward: { on: 'analysisClips', has: 'one', label: 'owner', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'analysisClips' },
    },
    analysisClipVideo: {
      forward: { on: 'analysisClips', has: 'one', label: 'video', onDelete: 'cascade' },
      reverse: { on: 'videos', has: 'many', label: 'analysisClips' },
    },
    analysisClipJob: {
      forward: { on: 'analysisClips', has: 'one', label: 'job', onDelete: 'cascade' },
      reverse: { on: 'analysisJobs', has: 'many', label: 'clips' },
    },
    analysisCandidateOwner: {
      forward: { on: 'analysisCandidates', has: 'one', label: 'owner', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'analysisCandidates' },
    },
    analysisCandidateVideo: {
      forward: { on: 'analysisCandidates', has: 'one', label: 'video', onDelete: 'cascade' },
      reverse: { on: 'videos', has: 'many', label: 'analysisCandidates' },
    },
    analysisCandidateJob: {
      forward: { on: 'analysisCandidates', has: 'one', label: 'job', onDelete: 'cascade' },
      reverse: { on: 'analysisJobs', has: 'many', label: 'candidates' },
    },
    analysisCandidateClip: {
      forward: { on: 'analysisCandidates', has: 'one', label: 'clip', onDelete: 'cascade' },
      reverse: { on: 'analysisClips', has: 'many', label: 'candidates' },
    },
    analysisCandidateSegment: {
      forward: { on: 'analysisCandidates', has: 'one', label: 'segment' },
      reverse: { on: 'segments', has: 'one', label: 'analysisCandidate' },
    },
    analysisFeedbackOwner: {
      forward: { on: 'analysisFeedback', has: 'one', label: 'owner', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'analysisFeedback' },
    },
    analysisFeedbackVideo: {
      forward: { on: 'analysisFeedback', has: 'one', label: 'video', onDelete: 'cascade' },
      reverse: { on: 'videos', has: 'many', label: 'analysisFeedback' },
    },
    analysisFeedbackJob: {
      forward: { on: 'analysisFeedback', has: 'one', label: 'job', onDelete: 'cascade' },
      reverse: { on: 'analysisJobs', has: 'many', label: 'feedback' },
    },
    analysisFeedbackCandidate: {
      forward: { on: 'analysisFeedback', has: 'one', label: 'candidate', onDelete: 'cascade' },
      reverse: { on: 'analysisCandidates', has: 'many', label: 'feedback' },
    },
    analysisFeedbackReviewer: {
      forward: { on: 'analysisFeedback', has: 'one', label: 'reviewer' },
      reverse: { on: '$users', has: 'many', label: 'submittedAnalysisFeedback' },
    },
    ingestionSourceOwner: {
      forward: { on: 'ingestionSources', has: 'one', label: 'owner', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'ingestionSources' },
    },
    ingestionJobOwner: {
      forward: { on: 'ingestionJobs', has: 'one', label: 'owner', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'ingestionJobs' },
    },
    ingestionJobSource: {
      forward: { on: 'ingestionJobs', has: 'one', label: 'source', onDelete: 'cascade' },
      reverse: { on: 'ingestionSources', has: 'many', label: 'jobs' },
    },
    ingestionJobVideo: {
      forward: { on: 'ingestionJobs', has: 'one', label: 'video' },
      reverse: { on: 'videos', has: 'many', label: 'ingestionJobs' },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
