import type {
  ActionDefinition,
  PhraseEventInput,
  PhraseInput,
  PoseKeyframeInput,
} from './domain.ts';

export interface FencerRecord {
  id: string;
  fullName: string;
  countryCode: string;
  dominantHand: 'left' | 'right' | 'unknown';
  fieId: string;
  usaFencingId: string;
  notes: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  countryCode: string;
  kind: 'national' | 'club' | 'school' | 'other';
  notes: string;
  memberCount: number;
}

export interface MediaRecord {
  id: string;
  kind: 'uploaded' | 'external' | 'screen-recording';
  objectKey: string | null;
  externalUrl: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  durationMs: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  status: 'pending' | 'ready' | 'failed';
  playbackUrl?: string | null;
}

export interface PhraseEventRecord extends PhraseEventInput {
  id: string;
  phraseId: string;
  createdAt: string;
}

export interface PoseKeyframeRecord extends PoseKeyframeInput {
  id: string;
  boutId: string;
}

export interface PhraseRecord extends PhraseInput {
  id: string;
  boutId: string;
  ordinal: number;
  revision: number;
  events: PhraseEventRecord[];
}

export interface BoutSummary {
  id: string;
  title: string;
  tournamentName: string;
  tournamentDate: string | null;
  round: string;
  status: 'queued' | 'ready' | 'labeling' | 'reviewed';
  sourceProvider: 'upload' | 'fencingtv' | 'youtube' | 'screen-recording' | 'other';
  sourceUrl: string | null;
  leftFencer: FencerRecord | null;
  rightFencer: FencerRecord | null;
  leftScore: number;
  rightScore: number;
  phraseCount: number;
  reviewedPhraseCount: number;
  durationMs: number | null;
  createdAt: string;
}

export interface BoutDetail extends BoutSummary {
  media: MediaRecord | null;
  phrases: PhraseRecord[];
  poses: PoseKeyframeRecord[];
}

export interface IngestionJobRecord {
  id: string;
  boutId: string;
  provider: string;
  captureMode: string;
  state: 'discovered' | 'capturing' | 'uploading' | 'ready' | 'failed';
  attempts: number;
  checkpoint: Record<string, unknown>;
  error: string;
  updatedAt: string;
}

export interface DashboardData {
  bouts: BoutSummary[];
  fencers: FencerRecord[];
  teams: TeamRecord[];
  actions: ActionDefinition[];
  totals: {
    bouts: number;
    reviewedBouts: number;
    phrases: number;
    reviewedPhrases: number;
    labeledPoseFrames: number;
  };
  demoMode: boolean;
}

export interface FencerStats {
  fencer: FencerRecord;
  totals: {
    bouts: number;
    phrases: number;
    reviewedPhrases: number;
    touchesScored: number;
    touchesReceived: number;
    noTouch: number;
    unresolved: number;
    scoringRate: number | null;
    attackAttempts: number;
    attackScores: number;
    defenseScores: number;
    priorityGained: number;
    priorityLost: number;
  };
  actions: Array<{ label: string; count: number }>;
  bouts: Array<{ boutId: string; title: string; scored: number; received: number; noTouch: number }>;
}

export interface TeamStats {
  team: TeamRecord;
  members: Array<{
    fencer: FencerRecord;
    totals: FencerStats['totals'];
  }>;
  totals: {
    members: number;
    uniqueBouts: number;
    touchesScored: number;
    touchesReceived: number;
    noTouch: number;
    attackScores: number;
    defenseScores: number;
  };
}
