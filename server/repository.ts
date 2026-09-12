import crypto from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  BoutDetail,
  BoutSummary,
  DashboardData,
  FencerRecord,
  FencerStats,
  IngestionJobRecord,
  MediaRecord,
  PhraseEventRecord,
  PhraseRecord,
  PoseKeyframeRecord,
  TeamRecord,
  TeamStats,
} from '../shared/api.ts';
import type {
  ActionDefinition,
  CreateBoutInput,
  CreateFencerInput,
  CreateTeamInput,
  PhraseEventInput,
  PhraseInput,
  PoseKeyframeInput,
} from '../shared/domain.ts';
import type { z } from 'zod';
import { fencingTvDedupKey, fencingTvImportSchema, parseFencingTvUrl } from '../shared/fencingtv.ts';
import { buildRuleContext, RULE_CARDS, RULE_SOURCES, RULESET_ID, type RuleCard } from '../shared/rules.ts';
import { aggregateFencerStats, type StatPhrase } from '../shared/stats.ts';
import { DEFAULT_ACTIONS } from '../shared/taxonomy.ts';
import { config } from './config.ts';
import { demoBout, demoFencers, demoTeams } from './demo-data.ts';
import { createPool, runMigrations } from './migrate.ts';

export type FencingTvImportInput = z.infer<typeof fencingTvImportSchema>;

export interface CreateActionInput {
  key: string;
  label: string;
  category: ActionDefinition['category'];
  description: string;
  active: boolean;
}

export interface AttachMediaInput {
  kind: MediaRecord['kind'];
  objectKey: string | null;
  externalUrl: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  durationMs?: number | null;
  fps?: number | null;
  width?: number | null;
  height?: number | null;
  status?: MediaRecord['status'];
}

export interface DatasetManifest {
  schemaVersion: 1;
  exportedAt: string;
  rulesetId: string;
  bouts: BoutDetail[];
  actions: ActionDefinition[];
}

export interface Repository {
  readonly demoMode: boolean;
  init(): Promise<void>;
  close(): Promise<void>;
  dashboard(): Promise<DashboardData>;
  getBout(id: string): Promise<BoutDetail | null>;
  createBout(input: CreateBoutInput): Promise<BoutDetail>;
  createFencer(input: CreateFencerInput): Promise<FencerRecord>;
  createTeam(input: CreateTeamInput): Promise<TeamRecord>;
  createAction(input: CreateActionInput): Promise<ActionDefinition>;
  updateAction(id: string, input: Partial<CreateActionInput>): Promise<ActionDefinition | null>;
  createPhrase(boutId: string, input: PhraseInput): Promise<PhraseRecord>;
  updatePhrase(id: string, input: PhraseInput): Promise<PhraseRecord | null>;
  deletePhrase(id: string): Promise<boolean>;
  createEvent(phraseId: string, input: PhraseEventInput): Promise<PhraseEventRecord>;
  updateEvent(id: string, input: PhraseEventInput): Promise<PhraseEventRecord | null>;
  deleteEvent(id: string): Promise<boolean>;
  upsertPose(boutId: string, input: PoseKeyframeInput): Promise<PoseKeyframeRecord>;
  importFencingTv(input: FencingTvImportInput): Promise<{ bout: BoutDetail; jobId: string; deduplicated: boolean }>;
  getIngestionJob(boutId: string): Promise<IngestionJobRecord | null>;
  attachMedia(boutId: string, input: AttachMediaInput): Promise<MediaRecord>;
  fencerStats(id: string): Promise<FencerStats | null>;
  teamStats(id: string): Promise<TeamStats | null>;
  addTeamMember(teamId: string, fencerId: string): Promise<void>;
  datasetManifest(): Promise<DatasetManifest>;
  ruleContext(query: string, refs: string[]): Promise<ReturnType<typeof buildRuleContext>>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function fencerFromRow(row: QueryResultRow | null | undefined, prefix = ''): FencerRecord | null {
  if (!row || !row[`${prefix}id`]) return null;
  return {
    id: String(row[`${prefix}id`]),
    fullName: String(row[`${prefix}full_name`] ?? ''),
    countryCode: String(row[`${prefix}country_code`] ?? ''),
    dominantHand: row[`${prefix}dominant_hand`] as FencerRecord['dominantHand'],
    fieId: String(row[`${prefix}fie_id`] ?? ''),
    usaFencingId: String(row[`${prefix}usa_fencing_id`] ?? ''),
    notes: String(row[`${prefix}notes`] ?? ''),
  };
}

function mediaFromRow(row: QueryResultRow | null | undefined): MediaRecord | null {
  if (!row?.media_id) return null;
  return {
    id: String(row.media_id),
    kind: row.media_kind as MediaRecord['kind'],
    objectKey: row.object_key ? String(row.object_key) : null,
    externalUrl: row.external_url ? String(row.external_url) : null,
    filename: String(row.filename ?? ''),
    mimeType: String(row.mime_type ?? 'video/mp4'),
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    fps: row.fps === null ? null : Number(row.fps),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    status: row.media_status as MediaRecord['status'],
  };
}

function eventFromRow(row: QueryResultRow): PhraseEventRecord {
  return {
    id: String(row.id),
    phraseId: String(row.phrase_id),
    timestampMs: Number(row.timestamp_ms),
    frameNumber: row.frame_number === null ? null : Number(row.frame_number),
    kind: row.kind,
    actor: row.actor,
    actionId: row.action_id ? String(row.action_id) : null,
    actionLabel: String(row.action_label),
    priorityBefore: row.priority_before,
    priorityAfter: row.priority_after,
    evidence: String(row.evidence ?? ''),
    ruleRefs: (row.rule_refs ?? []) as string[],
    confidence: row.confidence === null ? null : Number(row.confidence),
    source: row.source,
    createdAt: iso(row.created_at),
  };
}

function phraseFromRow(row: QueryResultRow, events: PhraseEventRecord[] = []): PhraseRecord {
  return {
    id: String(row.id),
    boutId: String(row.bout_id),
    ordinal: Number(row.ordinal),
    revision: Number(row.revision),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    startFrame: row.start_frame === null ? null : Number(row.start_frame),
    endFrame: row.end_frame === null ? null : Number(row.end_frame),
    startReason: row.start_reason,
    endReason: row.end_reason,
    haltReason: String(row.halt_reason ?? ''),
    award: row.award,
    callStatus: row.call_status,
    callExplanation: String(row.call_explanation ?? ''),
    ruleRefs: (row.rule_refs ?? []) as string[],
    reviewState: row.review_state,
    scoreBefore: { left: Number(row.left_score_before), right: Number(row.right_score_before) },
    scoreAfter: { left: Number(row.left_score_after), right: Number(row.right_score_after) },
    events,
  };
}

function poseFromRow(row: QueryResultRow): PoseKeyframeRecord {
  return {
    id: String(row.id),
    boutId: String(row.bout_id),
    timestampMs: Number(row.timestamp_ms),
    frameNumber: row.frame_number === null ? null : Number(row.frame_number),
    side: row.side,
    trackId: String(row.track_id),
    keypoints: row.keypoints,
    weapon: row.weapon,
    bbox: row.bbox,
    frontFootMeters: row.front_foot_meters === null ? null : Number(row.front_foot_meters),
    rearFootMeters: row.rear_foot_meters === null ? null : Number(row.rear_foot_meters),
    opponentDistanceMeters: row.opponent_distance_meters === null ? null : Number(row.opponent_distance_meters),
    occluded: Boolean(row.occluded),
    source: row.source,
  };
}

function actionFromRow(row: QueryResultRow): ActionDefinition {
  return {
    id: String(row.id), key: String(row.key), label: String(row.label), category: row.category,
    description: String(row.description ?? ''), active: Boolean(row.active), system: Boolean(row.system),
  };
}

function boutFromRow(row: QueryResultRow): BoutSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    tournamentName: String(row.tournament_name ?? ''),
    tournamentDate: dateString(row.tournament_date),
    round: String(row.round ?? ''),
    status: row.status,
    sourceProvider: row.source_provider,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    leftFencer: fencerFromRow(row, 'left_'),
    rightFencer: fencerFromRow(row, 'right_'),
    leftScore: Number(row.left_score ?? 0),
    rightScore: Number(row.right_score ?? 0),
    phraseCount: Number(row.phrase_count ?? 0),
    reviewedPhraseCount: Number(row.reviewed_phrase_count ?? 0),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    createdAt: iso(row.created_at),
  };
}

function sortEvents(events: PhraseEventRecord[]) {
  return events.sort((a, b) => a.timestampMs - b.timestampMs || a.createdAt.localeCompare(b.createdAt));
}

function boutStatsRows(bout: BoutDetail, fencerId: string): StatPhrase[] {
  const side = bout.leftFencer?.id === fencerId ? 'left' : bout.rightFencer?.id === fencerId ? 'right' : null;
  if (!side) return [];
  const opponentId = side === 'left' ? bout.rightFencer?.id ?? null : bout.leftFencer?.id ?? null;
  return bout.phrases.map((phrase) => ({
    boutId: bout.id,
    fencerId,
    opponentId,
    fencerSide: side,
    award: phrase.award,
    reviewState: phrase.reviewState,
    actions: phrase.events.map((event) => ({
      actor: event.actor,
      category: event.kind,
      label: event.actionLabel,
      priorityBefore: event.priorityBefore,
      priorityAfter: event.priorityAfter,
    })),
  }));
}

class MemoryRepository implements Repository {
  readonly demoMode = true;
  private fencers = clone(demoFencers);
  private teams = clone(demoTeams);
  private bouts = new Map<string, BoutDetail>([[demoBout.id, clone(demoBout)]]);
  private actions = clone(DEFAULT_ACTIONS);
  private importJobs = new Map<string, IngestionJobRecord>();
  private memberships = new Map<string, Set<string>>([
    [demoTeams[0].id, new Set([demoFencers[0].id])],
    [demoTeams[1].id, new Set([demoFencers[1].id])],
  ]);

  async init() {}
  async close() {}

  async dashboard(): Promise<DashboardData> {
    const bouts = [...this.bouts.values()].map(({ media: _m, phrases: _p, poses: _k, ...summary }) => clone(summary));
    const phrases = bouts.reduce((sum, bout) => sum + bout.phraseCount, 0);
    const reviewedPhrases = bouts.reduce((sum, bout) => sum + bout.reviewedPhraseCount, 0);
    return {
      bouts: bouts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      fencers: clone(this.fencers).sort((a, b) => a.fullName.localeCompare(b.fullName)),
      teams: clone(this.teams).sort((a, b) => a.name.localeCompare(b.name)),
      actions: clone(this.actions).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label)),
      totals: {
        bouts: bouts.length,
        reviewedBouts: bouts.filter((bout) => bout.status === 'reviewed').length,
        phrases,
        reviewedPhrases,
        labeledPoseFrames: [...this.bouts.values()].reduce((sum, bout) => sum + bout.poses.length, 0),
      },
      demoMode: true,
    };
  }

  async getBout(id: string) {
    const bout = this.bouts.get(id);
    return bout ? clone(bout) : null;
  }

  async createBout(input: CreateBoutInput) {
    const id = crypto.randomUUID();
    const bout: BoutDetail = {
      id,
      title: input.title,
      tournamentName: input.tournamentName,
      tournamentDate: input.tournamentDate,
      round: input.round,
      status: input.status,
      sourceProvider: input.sourceProvider,
      sourceUrl: input.sourceUrl,
      leftFencer: this.fencers.find((item) => item.id === input.leftFencerId) ?? null,
      rightFencer: this.fencers.find((item) => item.id === input.rightFencerId) ?? null,
      leftScore: 0,
      rightScore: 0,
      phraseCount: 0,
      reviewedPhraseCount: 0,
      durationMs: null,
      createdAt: new Date().toISOString(),
      media: null,
      phrases: [],
      poses: [],
    };
    this.bouts.set(id, bout);
    return clone(bout);
  }

  async createFencer(input: CreateFencerInput) {
    const item = { id: crypto.randomUUID(), ...input };
    this.fencers.push(item);
    return clone(item);
  }

  async createTeam(input: CreateTeamInput) {
    const item = { id: crypto.randomUUID(), ...input, memberCount: 0 };
    this.teams.push(item);
    return clone(item);
  }

  async createAction(input: CreateActionInput) {
    if (this.actions.some((item) => item.key === input.key)) throw new Error('An action with that key already exists');
    const item: ActionDefinition = { id: crypto.randomUUID(), ...input, system: false };
    this.actions.push(item);
    return clone(item);
  }

  async updateAction(id: string, input: Partial<CreateActionInput>) {
    const item = this.actions.find((candidate) => candidate.id === id);
    if (!item) return null;
    Object.assign(item, input);
    return clone(item);
  }

  private refreshBout(bout: BoutDetail) {
    bout.phrases.sort((a, b) => a.startMs - b.startMs || a.ordinal - b.ordinal);
    bout.phrases.forEach((phrase, index) => { phrase.ordinal = index + 1; });
    bout.phraseCount = bout.phrases.length;
    bout.reviewedPhraseCount = bout.phrases.filter((phrase) => phrase.reviewState !== 'draft').length;
    bout.leftScore = Math.max(0, ...bout.phrases.map((phrase) => phrase.scoreAfter.left));
    bout.rightScore = Math.max(0, ...bout.phrases.map((phrase) => phrase.scoreAfter.right));
  }

  async createPhrase(boutId: string, input: PhraseInput) {
    const bout = this.bouts.get(boutId);
    if (!bout) throw new Error('Bout not found');
    const phrase: PhraseRecord = { id: crypto.randomUUID(), boutId, ordinal: bout.phrases.length + 1, revision: 1, ...input, events: [] };
    bout.phrases.push(phrase);
    this.refreshBout(bout);
    return clone(phrase);
  }

  async updatePhrase(id: string, input: PhraseInput) {
    for (const bout of this.bouts.values()) {
      const phrase = bout.phrases.find((item) => item.id === id);
      if (!phrase) continue;
      Object.assign(phrase, input, { revision: phrase.revision + 1 });
      this.refreshBout(bout);
      return clone(phrase);
    }
    return null;
  }

  async deletePhrase(id: string) {
    for (const bout of this.bouts.values()) {
      const index = bout.phrases.findIndex((item) => item.id === id);
      if (index < 0) continue;
      bout.phrases.splice(index, 1);
      this.refreshBout(bout);
      return true;
    }
    return false;
  }

  private findPhrase(id: string) {
    for (const bout of this.bouts.values()) {
      const phrase = bout.phrases.find((item) => item.id === id);
      if (phrase) return phrase;
    }
    return null;
  }

  async createEvent(phraseId: string, input: PhraseEventInput) {
    const phrase = this.findPhrase(phraseId);
    if (!phrase) throw new Error('Phrase not found');
    if (input.timestampMs < phrase.startMs || input.timestampMs > phrase.endMs) throw new Error('Event must fall within phrase boundaries');
    const item: PhraseEventRecord = { id: crypto.randomUUID(), phraseId, createdAt: new Date().toISOString(), ...input };
    phrase.events.push(item);
    sortEvents(phrase.events);
    phrase.revision += 1;
    return clone(item);
  }

  async updateEvent(id: string, input: PhraseEventInput) {
    for (const bout of this.bouts.values()) {
      for (const phrase of bout.phrases) {
        const item = phrase.events.find((event) => event.id === id);
        if (!item) continue;
        if (input.timestampMs < phrase.startMs || input.timestampMs > phrase.endMs) throw new Error('Event must fall within phrase boundaries');
        Object.assign(item, input);
        sortEvents(phrase.events);
        phrase.revision += 1;
        return clone(item);
      }
    }
    return null;
  }

  async deleteEvent(id: string) {
    for (const bout of this.bouts.values()) {
      for (const phrase of bout.phrases) {
        const index = phrase.events.findIndex((item) => item.id === id);
        if (index < 0) continue;
        phrase.events.splice(index, 1);
        phrase.revision += 1;
        return true;
      }
    }
    return false;
  }

  async upsertPose(boutId: string, input: PoseKeyframeInput) {
    const bout = this.bouts.get(boutId);
    if (!bout) throw new Error('Bout not found');
    const existing = bout.poses.find((item) => item.frameNumber === input.frameNumber && item.side === input.side && item.trackId === input.trackId);
    if (existing) {
      Object.assign(existing, input);
      return clone(existing);
    }
    const item: PoseKeyframeRecord = { id: crypto.randomUUID(), boutId, ...input };
    bout.poses.push(item);
    bout.poses.sort((a, b) => a.timestampMs - b.timestampMs);
    return clone(item);
  }

  async importFencingTv(input: FencingTvImportInput) {
    const reference = parseFencingTvUrl(input.url);
    const key = fencingTvDedupKey(input.url, input.captureStartMs, input.captureEndMs);
    const existing = this.importJobs.get(key);
    if (existing) {
      const bout = await this.getBout(existing.boutId);
      if (bout) return { bout, jobId: existing.id, deduplicated: true };
    }
    const bout = await this.createBout({
      title: input.title,
      tournamentName: input.tournamentName,
      tournamentDate: input.tournamentDate,
      round: input.round,
      leftFencerId: input.leftFencerId,
      rightFencerId: input.rightFencerId,
      sourceProvider: 'fencingtv',
      sourceUrl: reference.canonicalUrl,
      status: input.captureMode === 'link-only' ? 'ready' : 'queued',
    });
    bout.media = {
      id: crypto.randomUUID(), kind: input.captureMode === 'screen-recording' ? 'screen-recording' : 'external',
      objectKey: null, externalUrl: reference.canonicalUrl, filename: '', mimeType: 'video/mp4', sizeBytes: null,
      durationMs: null, fps: null, width: null, height: null, status: input.captureMode === 'link-only' ? 'ready' : 'pending',
    };
    this.bouts.set(bout.id, clone(bout));
    const jobId = crypto.randomUUID();
    this.importJobs.set(key, {
      id: jobId,
      boutId: bout.id,
      provider: 'fencingtv',
      captureMode: input.captureMode,
      state: input.captureMode === 'link-only' ? 'ready' : 'discovered',
      attempts: 0,
      checkpoint: {},
      error: '',
      updatedAt: new Date().toISOString(),
    });
    return { bout: clone(bout), jobId, deduplicated: false };
  }

  async getIngestionJob(boutId: string) {
    const job = [...this.importJobs.values()].find((item) => item.boutId === boutId);
    return job ? clone(job) : null;
  }

  async attachMedia(boutId: string, input: AttachMediaInput) {
    const bout = this.bouts.get(boutId);
    if (!bout) throw new Error('Bout not found');
    const media: MediaRecord = {
      id: bout.media?.id ?? crypto.randomUUID(),
      kind: input.kind,
      objectKey: input.objectKey,
      externalUrl: input.externalUrl,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs ?? null,
      fps: input.fps ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      status: input.status ?? 'pending',
    };
    bout.media = media;
    bout.durationMs = media.durationMs;
    if (media.status === 'ready' && bout.status === 'queued') bout.status = 'ready';
    return clone(media);
  }

  async fencerStats(id: string): Promise<FencerStats | null> {
    const fencer = this.fencers.find((item) => item.id === id);
    if (!fencer) return null;
    const relevantBouts = [...this.bouts.values()].filter((bout) => bout.leftFencer?.id === id || bout.rightFencer?.id === id);
    const aggregate = aggregateFencerStats(id, relevantBouts.flatMap((bout) => boutStatsRows(bout, id)));
    return {
      fencer: clone(fencer),
      totals: { ...aggregate, bouts: relevantBouts.length },
      actions: Object.entries(aggregate.actionCounts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      bouts: relevantBouts.map((bout) => {
        const side = bout.leftFencer?.id === id ? 'left' : 'right';
        return {
          boutId: bout.id,
          title: bout.title,
          scored: bout.phrases.filter((phrase) => phrase.award === side).length,
          received: bout.phrases.filter((phrase) => phrase.award === (side === 'left' ? 'right' : 'left')).length,
          noTouch: bout.phrases.filter((phrase) => phrase.award === 'none').length,
        };
      }),
    };
  }

  async addTeamMember(teamId: string, fencerId: string) {
    const team = this.teams.find((item) => item.id === teamId);
    if (!team) throw new Error('Team not found');
    if (!this.fencers.some((item) => item.id === fencerId)) throw new Error('Fencer not found');
    const members = this.memberships.get(teamId) ?? new Set<string>();
    members.add(fencerId); this.memberships.set(teamId, members); team.memberCount = members.size;
  }

  async teamStats(id: string): Promise<TeamStats | null> {
    const team = this.teams.find((item) => item.id === id);
    if (!team) return null;
    const memberIds = [...(this.memberships.get(id) ?? [])];
    const memberStats = (await Promise.all(memberIds.map((memberId) => this.fencerStats(memberId)))).filter((item): item is FencerStats => Boolean(item));
    const boutIds = new Set(memberStats.flatMap((item) => item.bouts.map((bout) => bout.boutId)));
    return {
      team: clone(team),
      members: memberStats.map((item) => ({ fencer: item.fencer, totals: item.totals })),
      totals: {
        members: memberStats.length, uniqueBouts: boutIds.size,
        touchesScored: memberStats.reduce((sum, item) => sum + item.totals.touchesScored, 0),
        touchesReceived: memberStats.reduce((sum, item) => sum + item.totals.touchesReceived, 0),
        noTouch: memberStats.reduce((sum, item) => sum + item.totals.noTouch, 0),
        attackScores: memberStats.reduce((sum, item) => sum + item.totals.attackScores, 0),
        defenseScores: memberStats.reduce((sum, item) => sum + item.totals.defenseScores, 0),
      },
    };
  }

  async datasetManifest(): Promise<DatasetManifest> {
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), rulesetId: RULESET_ID, bouts: clone([...this.bouts.values()]), actions: clone(this.actions) };
  }

  async ruleContext(query: string, requestedRefs: string[]) {
    return buildRuleContext(query, requestedRefs);
  }
}

const BOUT_SELECT = `
  SELECT b.*, t.name AS tournament_name,
    lf.id AS left_id, lf.full_name AS left_full_name, lf.country_code AS left_country_code,
    lf.dominant_hand AS left_dominant_hand, lf.fie_id AS left_fie_id,
    lf.usa_fencing_id AS left_usa_fencing_id, lf.notes AS left_notes,
    rf.id AS right_id, rf.full_name AS right_full_name, rf.country_code AS right_country_code,
    rf.dominant_hand AS right_dominant_hand, rf.fie_id AS right_fie_id,
    rf.usa_fencing_id AS right_usa_fencing_id, rf.notes AS right_notes,
    COALESCE(ps.phrase_count, 0) AS phrase_count,
    COALESCE(ps.reviewed_phrase_count, 0) AS reviewed_phrase_count,
    COALESCE(ps.left_score, 0) AS left_score, COALESCE(ps.right_score, 0) AS right_score,
    m.id AS media_id, m.kind AS media_kind, m.object_key, m.external_url, m.filename, m.mime_type,
    m.size_bytes, m.duration_ms, m.fps, m.width, m.height, m.status AS media_status
  FROM bouts b
  LEFT JOIN tournaments t ON t.id = b.tournament_id
  LEFT JOIN fencers lf ON lf.id = b.left_fencer_id
  LEFT JOIN fencers rf ON rf.id = b.right_fencer_id
  LEFT JOIN media_assets m ON m.bout_id = b.id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS phrase_count,
      count(*) FILTER (WHERE review_state <> 'draft')::int AS reviewed_phrase_count,
      max(left_score_after)::int AS left_score, max(right_score_after)::int AS right_score
    FROM phrases WHERE bout_id = b.id
  ) ps ON true`;

class PostgresRepository implements Repository {
  readonly demoMode = false;
  private pool: Pool;

  constructor() {
    this.pool = createPool();
  }

  async init() {
    if (config.autoMigrate) await runMigrations(this.pool);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const action of DEFAULT_ACTIONS) {
        await client.query(
          `INSERT INTO action_definitions (id, key, label, category, description, active, system)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, category=EXCLUDED.category,
             description=EXCLUDED.description, system=true, updated_at=now()`,
          [action.id, action.key, action.label, action.category, action.description, action.active, action.system],
        );
      }
      for (const source of RULE_SOURCES) {
        await client.query(
          `INSERT INTO rule_sources (id, authority, title, edition, published_at, url, checked_at, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,now(),$7)
           ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, edition=EXCLUDED.edition,
             published_at=EXCLUDED.published_at, url=EXCLUDED.url, checked_at=now(), metadata=EXCLUDED.metadata`,
          [source.id, source.authority, source.title, source.edition, source.publishedAt, source.url, { scope: source.scope }],
        );
      }
      for (const card of RULE_CARDS) {
        await client.query(
          `INSERT INTO rule_passages (id, source_id, refs, title, summary, evidence, tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET source_id=EXCLUDED.source_id, refs=EXCLUDED.refs,
             title=EXCLUDED.title, summary=EXCLUDED.summary, evidence=EXCLUDED.evidence, tags=EXCLUDED.tags`,
          [card.id, card.sourceId, card.refs, card.title, card.summary, JSON.stringify(card.evidence), card.tags],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }

  private async listBouts(where = '', params: unknown[] = []) {
    const result = await this.pool.query(`${BOUT_SELECT} ${where} ORDER BY b.tournament_date DESC NULLS LAST, b.created_at DESC`, params);
    return result.rows.map(boutFromRow);
  }

  async dashboard(): Promise<DashboardData> {
    const [bouts, fencersResult, teamsResult, actionsResult, totalsResult] = await Promise.all([
      this.listBouts(),
      this.pool.query('SELECT * FROM fencers ORDER BY lower(full_name)'),
      this.pool.query(`SELECT t.*, count(tm.id) FILTER (WHERE tm.active)::int AS member_count
        FROM teams t LEFT JOIN team_memberships tm ON tm.team_id=t.id GROUP BY t.id ORDER BY lower(t.name)`),
      this.pool.query('SELECT * FROM action_definitions ORDER BY category, label'),
      this.pool.query(`SELECT
        (SELECT count(*)::int FROM bouts) AS bouts,
        (SELECT count(*)::int FROM bouts WHERE status='reviewed') AS reviewed_bouts,
        (SELECT count(*)::int FROM phrases) AS phrases,
        (SELECT count(*)::int FROM phrases WHERE review_state <> 'draft') AS reviewed_phrases,
        (SELECT count(*)::int FROM pose_keyframes) AS labeled_pose_frames`),
    ]);
    const totals = totalsResult.rows[0];
    return {
      bouts,
      fencers: fencersResult.rows.map((row) => fencerFromRow(row) as FencerRecord),
      teams: teamsResult.rows.map((row) => ({
        id: String(row.id), name: String(row.name), countryCode: String(row.country_code), kind: row.kind,
        notes: String(row.notes), memberCount: Number(row.member_count),
      })),
      actions: actionsResult.rows.map(actionFromRow),
      totals: {
        bouts: Number(totals.bouts), reviewedBouts: Number(totals.reviewed_bouts), phrases: Number(totals.phrases),
        reviewedPhrases: Number(totals.reviewed_phrases), labeledPoseFrames: Number(totals.labeled_pose_frames),
      },
      demoMode: false,
    };
  }

  async getBout(id: string): Promise<BoutDetail | null> {
    const result = await this.pool.query(`${BOUT_SELECT} WHERE b.id=$1`, [id]);
    if (!result.rowCount) return null;
    const [phrasesResult, eventsResult, posesResult] = await Promise.all([
      this.pool.query('SELECT * FROM phrases WHERE bout_id=$1 ORDER BY start_ms, ordinal', [id]),
      this.pool.query(`SELECT e.* FROM phrase_events e JOIN phrases p ON p.id=e.phrase_id
        WHERE p.bout_id=$1 ORDER BY e.timestamp_ms, e.created_at`, [id]),
      this.pool.query('SELECT * FROM pose_keyframes WHERE bout_id=$1 ORDER BY timestamp_ms, side', [id]),
    ]);
    const eventsByPhrase = new Map<string, PhraseEventRecord[]>();
    for (const row of eventsResult.rows) {
      const item = eventFromRow(row);
      const events = eventsByPhrase.get(item.phraseId) ?? [];
      events.push(item);
      eventsByPhrase.set(item.phraseId, events);
    }
    const summary = boutFromRow(result.rows[0]);
    return {
      ...summary,
      media: mediaFromRow(result.rows[0]),
      phrases: phrasesResult.rows.map((row) => phraseFromRow(row, eventsByPhrase.get(String(row.id)) ?? [])),
      poses: posesResult.rows.map(poseFromRow),
    };
  }

  async createBout(input: CreateBoutInput): Promise<BoutDetail> {
    const client = await this.pool.connect();
    const id = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      let tournamentId: string | null = null;
      if (input.tournamentName) {
        tournamentId = crypto.randomUUID();
        await client.query(`INSERT INTO tournaments (id,name,starts_on,ends_on,source_provider,source_url,status)
          VALUES ($1,$2,$3,$3,$4,$5,'completed')`,
        [tournamentId, input.tournamentName, input.tournamentDate, input.sourceProvider, input.sourceUrl]);
      }
      await client.query(`INSERT INTO bouts
        (id,tournament_id,title,round,tournament_date,left_fencer_id,right_fencer_id,source_provider,source_url,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, tournamentId, input.title, input.round, input.tournamentDate, input.leftFencerId, input.rightFencerId, input.sourceProvider, input.sourceUrl, input.status]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    return (await this.getBout(id)) as BoutDetail;
  }

  async createFencer(input: CreateFencerInput) {
    const id = crypto.randomUUID();
    const result = await this.pool.query(`INSERT INTO fencers
      (id,full_name,country_code,dominant_hand,fie_id,usa_fencing_id,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, input.fullName, input.countryCode, input.dominantHand, input.fieId, input.usaFencingId, input.notes]);
    return fencerFromRow(result.rows[0]) as FencerRecord;
  }

  async createTeam(input: CreateTeamInput) {
    const id = crypto.randomUUID();
    const result = await this.pool.query(`INSERT INTO teams (id,name,country_code,kind,notes)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [id, input.name, input.countryCode, input.kind, input.notes]);
    const row = result.rows[0];
    return { id: String(row.id), name: String(row.name), countryCode: String(row.country_code), kind: row.kind, notes: String(row.notes), memberCount: 0 };
  }

  async createAction(input: CreateActionInput) {
    const result = await this.pool.query(`INSERT INTO action_definitions (id,key,label,category,description,active,system)
      VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING *`,
    [crypto.randomUUID(), input.key, input.label, input.category, input.description, input.active]);
    return actionFromRow(result.rows[0]);
  }

  async updateAction(id: string, input: Partial<CreateActionInput>) {
    const current = await this.pool.query('SELECT * FROM action_definitions WHERE id=$1', [id]);
    if (!current.rowCount) return null;
    const value = { ...actionFromRow(current.rows[0]), ...input };
    const result = await this.pool.query(`UPDATE action_definitions SET key=$2,label=$3,category=$4,description=$5,active=$6,updated_at=now()
      WHERE id=$1 RETURNING *`, [id, value.key, value.label, value.category, value.description, value.active]);
    return actionFromRow(result.rows[0]);
  }

  private phraseValues(id: string, boutId: string, ordinal: number, input: PhraseInput) {
    return [id, boutId, ordinal, input.startMs, input.endMs, input.startFrame, input.endFrame, input.startReason,
      input.endReason, input.haltReason, input.award, input.callStatus, input.callExplanation, input.ruleRefs,
      input.reviewState, input.scoreBefore.left, input.scoreBefore.right, input.scoreAfter.left, input.scoreAfter.right, RULESET_ID];
  }

  async createPhrase(boutId: string, input: PhraseInput) {
    const ordinalResult = await this.pool.query('SELECT COALESCE(max(ordinal),0)+1 AS ordinal FROM phrases WHERE bout_id=$1', [boutId]);
    const id = crypto.randomUUID();
    const result = await this.pool.query(`INSERT INTO phrases
      (id,bout_id,ordinal,start_ms,end_ms,start_frame,end_frame,start_reason,end_reason,halt_reason,award,call_status,
       call_explanation,rule_refs,review_state,left_score_before,right_score_before,left_score_after,right_score_after,ruleset_id)
      VALUES (${Array.from({ length: 20 }, (_, index) => `$${index + 1}`).join(',')}) RETURNING *`,
    this.phraseValues(id, boutId, Number(ordinalResult.rows[0].ordinal), input));
    return phraseFromRow(result.rows[0]);
  }

  private async snapshot(client: PoolClient, type: 'phrase' | 'event' | 'pose', id: string, revision: number, payload: unknown) {
    await client.query(`INSERT INTO annotation_revisions (id,entity_type,entity_id,revision,payload)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), type, id, revision, payload]);
  }

  async updatePhrase(id: string, input: PhraseInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM phrases WHERE id=$1 FOR UPDATE', [id]);
      if (!current.rowCount) { await client.query('ROLLBACK'); return null; }
      const row = current.rows[0];
      await this.snapshot(client, 'phrase', id, Number(row.revision), row);
      const result = await client.query(`UPDATE phrases SET start_ms=$2,end_ms=$3,start_frame=$4,end_frame=$5,start_reason=$6,
        end_reason=$7,halt_reason=$8,award=$9,call_status=$10,call_explanation=$11,rule_refs=$12,review_state=$13,
        left_score_before=$14,right_score_before=$15,left_score_after=$16,right_score_after=$17,revision=revision+1,updated_at=now()
        WHERE id=$1 RETURNING *`, [id, input.startMs, input.endMs, input.startFrame, input.endFrame, input.startReason,
        input.endReason, input.haltReason, input.award, input.callStatus, input.callExplanation, input.ruleRefs, input.reviewState,
        input.scoreBefore.left, input.scoreBefore.right, input.scoreAfter.left, input.scoreAfter.right]);
      await client.query('COMMIT');
      return phraseFromRow(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async deletePhrase(id: string) {
    const result = await this.pool.query('DELETE FROM phrases WHERE id=$1 RETURNING bout_id', [id]);
    if (!result.rowCount) return false;
    await this.pool.query(`WITH ranked AS (SELECT id,row_number() OVER (ORDER BY start_ms,ordinal) AS next_ordinal
      FROM phrases WHERE bout_id=$1) UPDATE phrases p SET ordinal=r.next_ordinal FROM ranked r WHERE p.id=r.id`, [result.rows[0].bout_id]);
    return true;
  }

  private eventValues(id: string, phraseId: string, input: PhraseEventInput) {
    return [id, phraseId, input.timestampMs, input.frameNumber, input.kind, input.actor, input.actionId, input.actionLabel,
      input.priorityBefore, input.priorityAfter, input.evidence, input.ruleRefs, input.confidence, input.source];
  }

  private async assertEventBoundary(phraseId: string, timestampMs: number, client: Pool | PoolClient = this.pool) {
    const phrase = await client.query('SELECT start_ms,end_ms FROM phrases WHERE id=$1', [phraseId]);
    if (!phrase.rowCount) throw new Error('Phrase not found');
    if (timestampMs < phrase.rows[0].start_ms || timestampMs > phrase.rows[0].end_ms) throw new Error('Event must fall within phrase boundaries');
  }

  async createEvent(phraseId: string, input: PhraseEventInput) {
    await this.assertEventBoundary(phraseId, input.timestampMs);
    const result = await this.pool.query(`INSERT INTO phrase_events
      (id,phrase_id,timestamp_ms,frame_number,kind,actor,action_id,action_label,priority_before,priority_after,evidence,rule_refs,confidence,source)
      VALUES (${Array.from({ length: 14 }, (_, index) => `$${index + 1}`).join(',')}) RETURNING *`,
    this.eventValues(crypto.randomUUID(), phraseId, input));
    await this.pool.query('UPDATE phrases SET revision=revision+1,updated_at=now() WHERE id=$1', [phraseId]);
    return eventFromRow(result.rows[0]);
  }

  async updateEvent(id: string, input: PhraseEventInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM phrase_events WHERE id=$1 FOR UPDATE', [id]);
      if (!current.rowCount) { await client.query('ROLLBACK'); return null; }
      const row = current.rows[0];
      await this.assertEventBoundary(String(row.phrase_id), input.timestampMs, client);
      const nextRevisionResult = await client.query('SELECT revision FROM phrases WHERE id=$1 FOR UPDATE', [row.phrase_id]);
      const nextRevision = Number(nextRevisionResult.rows[0].revision) + 1;
      await this.snapshot(client, 'event', id, nextRevision, row);
      const result = await client.query(`UPDATE phrase_events SET timestamp_ms=$2,frame_number=$3,kind=$4,actor=$5,action_id=$6,
        action_label=$7,priority_before=$8,priority_after=$9,evidence=$10,rule_refs=$11,confidence=$12,source=$13,updated_at=now()
        WHERE id=$1 RETURNING *`, [id, input.timestampMs, input.frameNumber, input.kind, input.actor, input.actionId,
        input.actionLabel, input.priorityBefore, input.priorityAfter, input.evidence, input.ruleRefs, input.confidence, input.source]);
      await client.query('UPDATE phrases SET revision=$2,updated_at=now() WHERE id=$1', [row.phrase_id, nextRevision]);
      await client.query('COMMIT');
      return eventFromRow(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async deleteEvent(id: string) {
    const result = await this.pool.query('DELETE FROM phrase_events WHERE id=$1 RETURNING phrase_id', [id]);
    if (!result.rowCount) return false;
    await this.pool.query('UPDATE phrases SET revision=revision+1,updated_at=now() WHERE id=$1', [result.rows[0].phrase_id]);
    return true;
  }

  async upsertPose(boutId: string, input: PoseKeyframeInput) {
    const id = crypto.randomUUID();
    const result = await this.pool.query(`INSERT INTO pose_keyframes
      (id,bout_id,timestamp_ms,frame_number,side,track_id,keypoints,weapon,bbox,front_foot_meters,rear_foot_meters,opponent_distance_meters,occluded,source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (bout_id,frame_number,side,track_id) DO UPDATE SET timestamp_ms=EXCLUDED.timestamp_ms,
        keypoints=EXCLUDED.keypoints,weapon=EXCLUDED.weapon,bbox=EXCLUDED.bbox,front_foot_meters=EXCLUDED.front_foot_meters,
        rear_foot_meters=EXCLUDED.rear_foot_meters,opponent_distance_meters=EXCLUDED.opponent_distance_meters,
        occluded=EXCLUDED.occluded,source=EXCLUDED.source,updated_at=now() RETURNING *`,
    [id, boutId, input.timestampMs, input.frameNumber, input.side, input.trackId, JSON.stringify(input.keypoints), JSON.stringify(input.weapon), input.bbox ? JSON.stringify(input.bbox) : null,
      input.frontFootMeters, input.rearFootMeters, input.opponentDistanceMeters, input.occluded, input.source]);
    return poseFromRow(result.rows[0]);
  }

  async importFencingTv(input: FencingTvImportInput) {
    const reference = parseFencingTvUrl(input.url);
    const key = fencingTvDedupKey(input.url, input.captureStartMs, input.captureEndMs);
    const existing = await this.pool.query('SELECT id,bout_id FROM ingestion_jobs WHERE provider=$1 AND external_key=$2', ['fencingtv', key]);
    if (existing.rowCount && existing.rows[0].bout_id) {
      const bout = await this.getBout(String(existing.rows[0].bout_id));
      if (bout) return { bout, jobId: String(existing.rows[0].id), deduplicated: true };
    }
    const bout = await this.createBout({
      title: input.title, tournamentName: input.tournamentName, tournamentDate: input.tournamentDate, round: input.round,
      leftFencerId: input.leftFencerId, rightFencerId: input.rightFencerId, sourceProvider: 'fencingtv',
      sourceUrl: reference.canonicalUrl, status: input.captureMode === 'link-only' ? 'ready' : 'queued',
    });
    await this.attachMedia(bout.id, {
      kind: input.captureMode === 'screen-recording' ? 'screen-recording' : 'external', objectKey: null,
      externalUrl: reference.canonicalUrl, filename: '', mimeType: 'video/mp4', sizeBytes: null,
      status: input.captureMode === 'link-only' ? 'ready' : 'pending',
    });
    const jobId = crypto.randomUUID();
    await this.pool.query(`INSERT INTO ingestion_jobs (id,provider,external_key,source_url,capture_mode,state,metadata,bout_id)
      VALUES ($1,'fencingtv',$2,$3,$4,$5,$6,$7)`,
    [jobId, key, reference.canonicalUrl, input.captureMode, input.captureMode === 'link-only' ? 'ready' : 'discovered', {
      reference,
      captureWindow: input.captureStartMs !== null && input.captureEndMs !== null
        ? { startMs: input.captureStartMs, endMs: input.captureEndMs }
        : null,
    }, bout.id]);
    return { bout: (await this.getBout(bout.id)) as BoutDetail, jobId, deduplicated: false };
  }

  async getIngestionJob(boutId: string): Promise<IngestionJobRecord | null> {
    const result = await this.pool.query(`SELECT id,bout_id,provider,capture_mode,state,attempts,checkpoint,error,updated_at
      FROM ingestion_jobs WHERE bout_id=$1 ORDER BY created_at DESC LIMIT 1`, [boutId]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      id: String(row.id),
      boutId: String(row.bout_id),
      provider: String(row.provider),
      captureMode: String(row.capture_mode),
      state: String(row.state) as IngestionJobRecord['state'],
      attempts: Number(row.attempts),
      checkpoint: row.checkpoint ?? {},
      error: String(row.error ?? ''),
      updatedAt: iso(row.updated_at),
    };
  }

  async attachMedia(boutId: string, input: AttachMediaInput) {
    if (!input.objectKey && !input.externalUrl) throw new Error('Media needs an object key or external URL');
    const result = await this.pool.query(`INSERT INTO media_assets
      (id,bout_id,kind,object_key,external_url,filename,mime_type,size_bytes,duration_ms,fps,width,height,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (bout_id) DO UPDATE SET kind=EXCLUDED.kind,object_key=EXCLUDED.object_key,external_url=EXCLUDED.external_url,
        filename=EXCLUDED.filename,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,duration_ms=EXCLUDED.duration_ms,
        fps=EXCLUDED.fps,width=EXCLUDED.width,height=EXCLUDED.height,status=EXCLUDED.status,updated_at=now() RETURNING
        id AS media_id,kind AS media_kind,object_key,external_url,filename,mime_type,size_bytes,duration_ms,fps,width,height,status AS media_status`,
    [crypto.randomUUID(), boutId, input.kind, input.objectKey, input.externalUrl, input.filename, input.mimeType, input.sizeBytes,
      input.durationMs ?? null, input.fps ?? null, input.width ?? null, input.height ?? null, input.status ?? 'pending']);
    if ((input.status ?? 'pending') === 'ready') await this.pool.query(`UPDATE bouts SET status=CASE WHEN status='queued' THEN 'ready' ELSE status END WHERE id=$1`, [boutId]);
    return mediaFromRow(result.rows[0]) as MediaRecord;
  }

  async fencerStats(id: string): Promise<FencerStats | null> {
    const fencerResult = await this.pool.query('SELECT * FROM fencers WHERE id=$1', [id]);
    if (!fencerResult.rowCount) return null;
    const summaries = await this.listBouts('WHERE b.left_fencer_id=$1 OR b.right_fencer_id=$1', [id]);
    const bouts = (await Promise.all(summaries.map((summary) => this.getBout(summary.id)))).filter((bout): bout is BoutDetail => Boolean(bout));
    const aggregate = aggregateFencerStats(id, bouts.flatMap((bout) => boutStatsRows(bout, id)));
    return {
      fencer: fencerFromRow(fencerResult.rows[0]) as FencerRecord,
      totals: { ...aggregate, bouts: bouts.length },
      actions: Object.entries(aggregate.actionCounts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      bouts: bouts.map((bout) => {
        const side = bout.leftFencer?.id === id ? 'left' : 'right';
        return { boutId: bout.id, title: bout.title,
          scored: bout.phrases.filter((phrase) => phrase.award === side).length,
          received: bout.phrases.filter((phrase) => phrase.award === (side === 'left' ? 'right' : 'left')).length,
          noTouch: bout.phrases.filter((phrase) => phrase.award === 'none').length };
      }),
    };
  }

  async addTeamMember(teamId: string, fencerId: string) {
    const [team, fencer, existing] = await Promise.all([
      this.pool.query('SELECT 1 FROM teams WHERE id=$1', [teamId]),
      this.pool.query('SELECT 1 FROM fencers WHERE id=$1', [fencerId]),
      this.pool.query('SELECT id FROM team_memberships WHERE team_id=$1 AND fencer_id=$2 AND active=true LIMIT 1', [teamId, fencerId]),
    ]);
    if (!team.rowCount) throw new Error('Team not found');
    if (!fencer.rowCount) throw new Error('Fencer not found');
    if (!existing.rowCount) await this.pool.query('INSERT INTO team_memberships (id,team_id,fencer_id) VALUES ($1,$2,$3)', [crypto.randomUUID(), teamId, fencerId]);
  }

  async teamStats(id: string): Promise<TeamStats | null> {
    const teamResult = await this.pool.query(`SELECT t.*, count(tm.id) FILTER (WHERE tm.active)::int AS member_count
      FROM teams t LEFT JOIN team_memberships tm ON tm.team_id=t.id WHERE t.id=$1 GROUP BY t.id`, [id]);
    if (!teamResult.rowCount) return null;
    const memberResult = await this.pool.query('SELECT fencer_id FROM team_memberships WHERE team_id=$1 AND active=true', [id]);
    const memberStats = (await Promise.all(memberResult.rows.map((row) => this.fencerStats(String(row.fencer_id))))).filter((item): item is FencerStats => Boolean(item));
    const row = teamResult.rows[0];
    const boutIds = new Set(memberStats.flatMap((item) => item.bouts.map((bout) => bout.boutId)));
    return {
      team: { id: String(row.id), name: String(row.name), countryCode: String(row.country_code), kind: row.kind, notes: String(row.notes), memberCount: Number(row.member_count) },
      members: memberStats.map((item) => ({ fencer: item.fencer, totals: item.totals })),
      totals: {
        members: memberStats.length, uniqueBouts: boutIds.size,
        touchesScored: memberStats.reduce((sum, item) => sum + item.totals.touchesScored, 0),
        touchesReceived: memberStats.reduce((sum, item) => sum + item.totals.touchesReceived, 0),
        noTouch: memberStats.reduce((sum, item) => sum + item.totals.noTouch, 0),
        attackScores: memberStats.reduce((sum, item) => sum + item.totals.attackScores, 0),
        defenseScores: memberStats.reduce((sum, item) => sum + item.totals.defenseScores, 0),
      },
    };
  }

  async datasetManifest(): Promise<DatasetManifest> {
    const dashboard = await this.dashboard();
    const bouts = (await Promise.all(dashboard.bouts.map((bout) => this.getBout(bout.id)))).filter((bout): bout is BoutDetail => Boolean(bout));
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), rulesetId: RULESET_ID, bouts, actions: dashboard.actions };
  }

  async ruleContext(query: string, requestedRefs: string[]) {
    const curated = buildRuleContext(query, requestedRefs);
    if (!query.trim() && requestedRefs.length === 0) return curated;
    const result = await this.pool.query(
      `SELECT rp.*,
        CASE WHEN $1 = '' THEN 0 ELSE ts_rank(rp.search_vector, websearch_to_tsquery('english', $1)) END AS rank
       FROM rule_passages rp
       WHERE ($1 <> '' AND rp.search_vector @@ websearch_to_tsquery('english', $1))
          OR (cardinality($2::text[]) > 0 AND rp.refs && $2::text[])
       ORDER BY rank DESC, rp.id LIMIT 20`,
      [query.trim(), requestedRefs],
    );
    const indexed = result.rows.map((row): RuleCard => ({
      id: String(row.id),
      sourceId: String(row.source_id),
      refs: (row.refs ?? []) as string[],
      title: String(row.title),
      summary: String(row.summary),
      evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : ['Full rulebook passage'],
      tags: (row.tags ?? []) as string[],
    }));
    const cards = [...curated.cards];
    for (const card of indexed) if (!cards.some((item) => item.id === card.id)) cards.push(card);
    return {
      ...curated,
      sources: RULE_SOURCES.filter((source) => cards.some((card) => card.sourceId === source.id)),
      cards: cards.slice(0, 20),
    };
  }
}

export function createRepository(): Repository {
  return config.databaseUrl ? new PostgresRepository() : new MemoryRepository();
}

export const __testing = { MemoryRepository };
