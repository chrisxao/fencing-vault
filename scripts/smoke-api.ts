import assert from 'node:assert/strict';

const base = (process.env.SABRE_API_URL ?? 'http://localhost:8790').replace(/\/$/, '');

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(payload)}`);
  return payload as T;
}

interface Identified { id: string }

async function main() {
  const before = await request<{ totals: { bouts: number; reviewedPhrases: number; labeledPoseFrames: number } }>('/api/dashboard');
  const left = await request<Identified>('/api/fencers', 'POST', { fullName: 'Smoke Left', countryCode: 'CAN', dominantHand: 'right', fieId: '', usaFencingId: '', notes: '' });
  const right = await request<Identified>('/api/fencers', 'POST', { fullName: 'Smoke Right', countryCode: 'USA', dominantHand: 'left', fieId: '', usaFencingId: '', notes: '' });
  const team = await request<Identified>('/api/teams', 'POST', { name: 'Smoke Team', countryCode: 'CAN', kind: 'national', notes: '' });
  await request(`/api/teams/${team.id}/members`, 'POST', { fencerId: left.id });
  const bout = await request<Identified>('/api/bouts', 'POST', { title: 'PostgreSQL smoke bout', tournamentName: 'Disposable test', tournamentDate: '2026-09-08', round: 'Final', leftFencerId: left.id, rightFencerId: right.id, sourceProvider: 'other', sourceUrl: null, status: 'labeling' });
  const phraseBody = { startMs: 1_000, endMs: 3_500, startFrame: 60, endFrame: 210, startReason: 'play-command', endReason: 'touch-registered', haltReason: '', award: 'left', callStatus: 'analyst-call', callExplanation: 'Left establishes a continuous attack; right counterattacks.', ruleRefs: ['t.101', 't.106'], reviewState: 'reviewed', scoreBefore: { left: 0, right: 0 }, scoreAfter: { left: 1, right: 0 } };
  const phrase = await request<Identified & { revision: number }>(`/api/bouts/${bout.id}/phrases`, 'POST', phraseBody);
  await request(`/api/phrases/${phrase.id}/events`, 'POST', { timestampMs: 1_400, frameNumber: 84, kind: 'attack', actor: 'left', actionId: '40000000-0000-4000-8000-000000000001', actionLabel: 'Direct attack', priorityBefore: 'none', priorityAfter: 'left', evidence: 'Weapon arm extends before the lunge.', ruleRefs: ['t.101'], confidence: 1, source: 'human' });
  const revised = await request<Identified & { revision: number }>(`/api/phrases/${phrase.id}`, 'PUT', { ...phraseBody, callExplanation: `${phraseBody.callExplanation} Reviewed in the smoke test.` });
  await request(`/api/bouts/${bout.id}/poses`, 'PUT', { timestampMs: 1_400, frameNumber: 84, side: 'left', trackId: 'left-1', keypoints: [{ name: 'weapon_wrist', x: 0.35, y: 0.42, visible: true, confidence: 1 }], weapon: { guard: null, bladeMid: null, tip: null }, bbox: [0.1, 0.2, 0.4, 0.9], frontFootMeters: 5.2, rearFootMeters: 4.1, opponentDistanceMeters: 3.0, occluded: false, source: 'human' });
  const stats = await request<{ totals: { touchesScored: number; attackScores: number } }>(`/api/fencers/${left.id}/stats`);
  const teamStats = await request<{ totals: { members: number; touchesScored: number } }>(`/api/teams/${team.id}/stats`);
  const dashboard = await request<{ totals: { bouts: number; reviewedPhrases: number; labeledPoseFrames: number }; actions: unknown[] }>('/api/dashboard');
  const rules = await request<{ cards: Array<{ refs: string[] }> }>('/api/rules?q=correct%20sabre%20attack&refs=t.101');
  assert.equal(stats.totals.touchesScored, 1);
  assert.equal(stats.totals.attackScores, 1);
  assert.equal(teamStats.totals.members, 1);
  assert.equal(teamStats.totals.touchesScored, 1);
  assert.equal(phrase.revision, 1);
  assert.equal(revised.revision, 3);
  assert.equal(dashboard.totals.bouts, before.totals.bouts + 1);
  assert.equal(dashboard.totals.reviewedPhrases, before.totals.reviewedPhrases + 1);
  assert.equal(dashboard.totals.labeledPoseFrames, before.totals.labeledPoseFrames + 1);
  assert.ok(dashboard.actions.length >= 50);
  assert.ok(rules.cards.some((card) => card.refs.includes('t.101')));
  console.log('Sabre Studio API smoke test passed: repeatable PostgreSQL CRUD/revisions, pose JSON, rules, fencer stats, and team stats.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
