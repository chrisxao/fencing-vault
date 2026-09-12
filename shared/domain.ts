import { z } from 'zod';

export const sideSchema = z.enum(['left', 'right']);
export const actorSchema = z.enum(['left', 'right', 'both', 'referee', 'apparatus']);
export const prioritySchema = z.enum(['left', 'right', 'simultaneous', 'none', 'unclear']);
export const phraseStartReasonSchema = z.enum([
  'play-command',
  'restart',
  'visible-movement',
  'broadcast-return',
  'unknown',
]);
export const phraseEndReasonSchema = z.enum([
  'touch-registered',
  'referee-halt-no-touch',
  'rule-violation',
  'off-piste',
  'corps-a-corps',
  'dangerous-or-confused',
  'equipment',
  'injury',
  'period-ended',
  'broadcast-cut',
  'other',
]);
export const awardSchema = z.enum(['left', 'right', 'none', 'unknown']);
export const reviewStateSchema = z.enum(['draft', 'reviewed', 'adjudicated']);

export const actionCategorySchema = z.enum([
  'preparation',
  'footwork',
  'blade',
  'attack',
  'defense',
  'priority',
  'hit',
  'referee',
  'violation',
]);

export const actionDefinitionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  category: actionCategorySchema,
  description: z.string().max(1_000).default(''),
  active: z.boolean().default(true),
  system: z.boolean().default(false),
});

export const phraseEventInputSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  frameNumber: z.number().int().nonnegative().nullable().default(null),
  kind: actionCategorySchema,
  actor: actorSchema,
  actionId: z.string().uuid().nullable().default(null),
  actionLabel: z.string().min(1).max(120),
  priorityBefore: prioritySchema.default('unclear'),
  priorityAfter: prioritySchema.default('unclear'),
  evidence: z.string().max(2_000).default(''),
  ruleRefs: z.array(z.string().regex(/^(t|m|o)\.\d+(?:\.\d+)*(?:[-–](?:t|m|o)?\.?\d+(?:\.\d+)*)?$/)).max(30).default([]),
  confidence: z.number().min(0).max(1).nullable().default(null),
  source: z.enum(['human', 'model', 'imported']).default('human'),
});

export const phraseInputSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    startFrame: z.number().int().nonnegative().nullable().default(null),
    endFrame: z.number().int().nonnegative().nullable().default(null),
    startReason: phraseStartReasonSchema,
    endReason: phraseEndReasonSchema,
    haltReason: z.string().max(2_000).default(''),
    award: awardSchema.default('unknown'),
    callStatus: z.enum(['not-called', 'observed-referee', 'analyst-call', 'model-proposal']).default('not-called'),
    callExplanation: z.string().max(4_000).default(''),
    ruleRefs: z.array(z.string()).max(40).default([]),
    reviewState: reviewStateSchema.default('draft'),
    scoreBefore: z.object({ left: z.number().int().nonnegative(), right: z.number().int().nonnegative() }),
    scoreAfter: z.object({ left: z.number().int().nonnegative(), right: z.number().int().nonnegative() }),
  })
  .superRefine((value, context) => {
    if (value.endMs <= value.startMs) {
      context.addIssue({ code: 'custom', path: ['endMs'], message: 'Phrase end must be after phrase start' });
    }
    if (value.startFrame !== null && value.endFrame !== null && value.endFrame < value.startFrame) {
      context.addIssue({ code: 'custom', path: ['endFrame'], message: 'End frame cannot precede start frame' });
    }
    if (value.reviewState !== 'draft' && (!value.callExplanation.trim() || value.ruleRefs.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['callExplanation'],
        message: 'Reviewed phrases require an explanation and at least one rule reference',
      });
    }
    if (value.reviewState !== 'draft' && value.award === 'unknown') {
      context.addIssue({ code: 'custom', path: ['award'], message: 'Reviewed phrases must resolve the award or explicitly use no touch' });
    }
    const leftDelta = value.scoreAfter.left - value.scoreBefore.left;
    const rightDelta = value.scoreAfter.right - value.scoreBefore.right;
    if (leftDelta < 0 || rightDelta < 0 || leftDelta > 1 || rightDelta > 1) {
      context.addIssue({ code: 'custom', path: ['scoreAfter'], message: 'A phrase may add at most one point and cannot reduce the score' });
    }
    if (value.award === 'left' && leftDelta !== 1) {
      context.addIssue({ code: 'custom', path: ['scoreAfter', 'left'], message: 'A left award must increment the left score' });
    }
    if (value.award === 'right' && rightDelta !== 1) {
      context.addIssue({ code: 'custom', path: ['scoreAfter', 'right'], message: 'A right award must increment the right score' });
    }
    if (value.award === 'none' && (leftDelta !== 0 || rightDelta !== 0)) {
      context.addIssue({ code: 'custom', path: ['scoreAfter'], message: 'No-touch phrases cannot increment the score' });
    }
  });

export const keypointSchema = z.object({
  name: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  visible: z.boolean(),
  confidence: z.number().min(0).max(1).nullable().default(null),
});

export const poseKeyframeInputSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  frameNumber: z.number().int().nonnegative().nullable().default(null),
  side: sideSchema,
  trackId: z.string().min(1).max(120),
  keypoints: z.array(keypointSchema).max(40),
  weapon: z.object({
    guard: keypointSchema.nullable().default(null),
    bladeMid: keypointSchema.nullable().default(null),
    tip: keypointSchema.nullable().default(null),
  }),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().default(null),
  frontFootMeters: z.number().nullable().default(null),
  rearFootMeters: z.number().nullable().default(null),
  opponentDistanceMeters: z.number().nonnegative().nullable().default(null),
  occluded: z.boolean().default(false),
  source: z.enum(['human', 'model', 'corrected-model']).default('human'),
});

export const createFencerSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  countryCode: z.string().trim().toUpperCase().max(3).default(''),
  dominantHand: z.enum(['left', 'right', 'unknown']).default('unknown'),
  fieId: z.string().trim().max(80).default(''),
  usaFencingId: z.string().trim().max(80).default(''),
  notes: z.string().max(2_000).default(''),
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(160),
  countryCode: z.string().trim().toUpperCase().max(3).default(''),
  kind: z.enum(['national', 'club', 'school', 'other']).default('national'),
  notes: z.string().max(2_000).default(''),
});

export const createBoutSchema = z.object({
  title: z.string().trim().min(1).max(240),
  tournamentName: z.string().trim().max(240).default(''),
  tournamentDate: z.string().date().nullable().default(null),
  round: z.string().trim().max(80).default(''),
  leftFencerId: z.string().uuid().nullable().default(null),
  rightFencerId: z.string().uuid().nullable().default(null),
  sourceProvider: z.enum(['upload', 'fencingtv', 'youtube', 'screen-recording', 'other']).default('upload'),
  sourceUrl: z.string().url().nullable().default(null),
  status: z.enum(['queued', 'ready', 'labeling', 'reviewed']).default('queued'),
});

export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;
export type PhraseEventInput = z.infer<typeof phraseEventInputSchema>;
export type PhraseInput = z.infer<typeof phraseInputSchema>;
export type PoseKeyframeInput = z.infer<typeof poseKeyframeInputSchema>;
export type CreateFencerInput = z.infer<typeof createFencerSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type CreateBoutInput = z.infer<typeof createBoutSchema>;
