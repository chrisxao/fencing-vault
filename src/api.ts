import type { BoutDetail, DashboardData, FencerStats, IngestionJobRecord, TeamStats } from '../shared/api.ts';
import type { ActionDefinition, PhraseEventInput, PhraseInput, PoseKeyframeInput } from '../shared/domain.ts';
import type { RuleCard, RuleSource } from '../shared/rules.ts';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    let payload: { error?: string; details?: unknown } = {};
    try { payload = await response.json(); } catch { /* response had no JSON body */ }
    throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status, payload.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  session: () => request<{ enabled: boolean; authenticated: boolean }>('/api/auth/session'),
  login: (password: string) => request<{ authenticated: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' }),
  config: () => request<{
    demoMode: boolean;
    storageConfigured: boolean;
    fencingTvDiscoveryEnabled: boolean;
    fencingTvCaptureEnabled: boolean;
    maxUploadBytes: number;
    rulesetId: string;
  }>('/api/config'),
  dashboard: () => request<DashboardData>('/api/dashboard'),
  bout: (id: string) => request<BoutDetail>(`/api/bouts/${id}`),
  ingestion: (id: string) => request<IngestionJobRecord | null>(`/api/bouts/${id}/ingestion`),
  createBout: (input: unknown) => request<BoutDetail>('/api/bouts', { method: 'POST', body: JSON.stringify(input) }),
  createFencer: (input: unknown) => request('/api/fencers', { method: 'POST', body: JSON.stringify(input) }),
  createTeam: (input: unknown) => request('/api/teams', { method: 'POST', body: JSON.stringify(input) }),
  fencerStats: (id: string) => request<FencerStats>(`/api/fencers/${id}/stats`),
  teamStats: (id: string) => request<TeamStats>(`/api/teams/${id}/stats`),
  addTeamMember: (teamId: string, fencerId: string) => request<void>(`/api/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ fencerId }) }),
  createPhrase: (boutId: string, input: PhraseInput) => request(`/api/bouts/${boutId}/phrases`, { method: 'POST', body: JSON.stringify(input) }),
  updatePhrase: (id: string, input: PhraseInput) => request(`/api/phrases/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deletePhrase: (id: string) => request<void>(`/api/phrases/${id}`, { method: 'DELETE' }),
  createEvent: (phraseId: string, input: PhraseEventInput) => request(`/api/phrases/${phraseId}/events`, { method: 'POST', body: JSON.stringify(input) }),
  updateEvent: (id: string, input: PhraseEventInput) => request(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteEvent: (id: string) => request<void>(`/api/events/${id}`, { method: 'DELETE' }),
  savePose: (boutId: string, input: PoseKeyframeInput) => request(`/api/bouts/${boutId}/poses`, { method: 'PUT', body: JSON.stringify(input) }),
  createAction: (input: unknown) => request<ActionDefinition>('/api/actions', { method: 'POST', body: JSON.stringify(input) }),
  updateAction: (id: string, input: unknown) => request<ActionDefinition>(`/api/actions/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  importFencingTv: (input: unknown) => request<{ bout: BoutDetail; jobId: string; deduplicated: boolean }>('/api/fencingtv/import', { method: 'POST', body: JSON.stringify(input) }),
  discoverFencingTv: (query = '', kind: 'all' | 'competition' | 'video' = 'all') => request<{
    available: boolean;
    items: Array<{ kind: 'competition' | 'video'; title: string; url: string; slug: string }>;
    message: string;
  }>(`/api/fencingtv/discover?${new URLSearchParams({ q: query, kind })}`),
  rules: (query: string, refs: string[] = []) => request<{
    rulesetId: string;
    sources: RuleSource[];
    cards: RuleCard[];
    guardrails: string[];
  }>(`/api/rules?${new URLSearchParams({ q: query, refs: refs.join(',') })}`),
  presignUpload: (boutId: string, input: { filename: string; contentType: string; sizeBytes: number }) =>
    request<{ objectKey: string; uploadUrl: string; expiresInSeconds: number }>(`/api/bouts/${boutId}/uploads/presign`, { method: 'POST', body: JSON.stringify(input) }),
  attachMedia: (boutId: string, input: unknown) => request(`/api/bouts/${boutId}/media`, { method: 'POST', body: JSON.stringify(input) }),
};

export function formatTime(ms: number, precise = true) {
  const totalSeconds = Math.max(0, ms) / 1_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const fraction = precise ? `.${Math.floor((totalSeconds % 1) * 10)}` : '';
  return `${minutes}:${seconds.toString().padStart(2, '0')}${fraction}`;
}

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
