import assert from 'node:assert/strict';
import test from 'node:test';
import { phraseEventInputSchema, phraseInputSchema } from '../shared/domain.ts';
import { fencingTvDedupKey, parseFencingTvUrl } from '../shared/fencingtv.ts';
import { buildRuleContext, retrieveRuleCards, RULESET_ID } from '../shared/rules.ts';
import { aggregateFencerStats } from '../shared/stats.ts';

const basePhrase = {
  startMs: 1_000,
  endMs: 3_000,
  startFrame: 60,
  endFrame: 180,
  startReason: 'play-command' as const,
  endReason: 'touch-registered' as const,
  haltReason: '',
  award: 'left' as const,
  callStatus: 'observed-referee' as const,
  callExplanation: 'Attack from the left arrives while the right counter-attacks.',
  ruleRefs: ['t.101', 't.106'],
  reviewState: 'reviewed' as const,
  scoreBefore: { left: 3, right: 2 },
  scoreAfter: { left: 4, right: 2 },
};

test('reviewed phrase binds boundary, score, call, and rules', () => {
  assert.equal(phraseInputSchema.parse(basePhrase).award, 'left');
});

test('no-touch halt is a first-class valid phrase', () => {
  const phrase = phraseInputSchema.parse({
    ...basePhrase,
    endReason: 'rule-violation',
    haltReason: 'Right fencer crosses the feet before either hit arrives.',
    award: 'none',
    scoreAfter: basePhrase.scoreBefore,
  });
  assert.equal(phrase.award, 'none');
  assert.equal(phrase.endReason, 'rule-violation');
});

test('review rejects impossible score and uncited call', () => {
  assert.equal(phraseInputSchema.safeParse({ ...basePhrase, scoreAfter: { left: 3, right: 2 } }).success, false);
  assert.equal(phraseInputSchema.safeParse({ ...basePhrase, ruleRefs: [] }).success, false);
});

test('event schema captures priority transition and editable action label', () => {
  const event = phraseEventInputSchema.parse({
    timestampMs: 1_840,
    frameNumber: 110,
    kind: 'blade',
    actor: 'right',
    actionLabel: 'beat on foible',
    priorityBefore: 'left',
    priorityAfter: 'right',
    evidence: 'Visible blade contact followed by deflection.',
    ruleRefs: ['t.104.1'],
  });
  assert.equal(event.priorityAfter, 'right');
});

test('FencingTV parser canonicalizes supported personal-use references', () => {
  assert.deepEqual(parseFencingTvUrl('https://www.fencingtv.com/competitions/orleans-grand-prix-2025?x=1'), {
    kind: 'competition',
    canonicalUrl: 'https://fencingtv.com/competitions/orleans-grand-prix-2025',
    slug: 'orleans-grand-prix-2025',
  });
  assert.equal(
    fencingTvDedupKey('https://fencingtv.com/competitions/orleans-grand-prix-2025'),
    'fencingtv:competition:orleans-grand-prix-2025',
  );
  assert.throws(() => parseFencingTvUrl('https://example.com/videos/one'));
});

test('rule retrieval returns versioned, evidence-bearing context', () => {
  const cards = retrieveRuleCards('beat on forte changes priority', ['t.104']);
  assert.equal(cards[0]?.id, 'beat-attack');
  const context = buildRuleContext('attack on preparation');
  assert.equal(context.rulesetId, RULESET_ID);
  assert.ok(context.cards.length > 0);
  assert.ok(context.cards.every((card) => card.evidence.length > 0));
});

test('fencer aggregates are side-aware and keep no-touch phrases', () => {
  const stats = aggregateFencerStats('fencer-a', [
    {
      boutId: 'bout-a', fencerId: 'fencer-a', opponentId: 'fencer-b', fencerSide: 'left', award: 'left', reviewState: 'reviewed',
      actions: [{ actor: 'left', category: 'attack', label: 'two advances lunge', priorityBefore: 'none', priorityAfter: 'left' }],
    },
    {
      boutId: 'bout-a', fencerId: 'fencer-a', opponentId: 'fencer-b', fencerSide: 'left', award: 'none', reviewState: 'reviewed',
      actions: [{ actor: 'referee', category: 'violation', label: 'crossing feet', priorityBefore: 'none', priorityAfter: 'none' }],
    },
  ]);
  assert.equal(stats.touchesScored, 1);
  assert.equal(stats.noTouch, 1);
  assert.equal(stats.attackAttempts, 1);
  assert.equal(stats.priorityGained, 1);
});
