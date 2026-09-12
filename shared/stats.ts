export interface StatPhrase {
  boutId: string;
  fencerId: string;
  opponentId: string | null;
  fencerSide: 'left' | 'right';
  award: 'left' | 'right' | 'none' | 'unknown';
  reviewState: 'draft' | 'reviewed' | 'adjudicated';
  actions: Array<{ actor: string; category: string; label: string; priorityBefore: string; priorityAfter: string }>;
}

export interface FencerAggregate {
  fencerId: string;
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
  actionCounts: Record<string, number>;
}

export function aggregateFencerStats(fencerId: string, phrases: StatPhrase[]): FencerAggregate {
  const rows = phrases.filter((phrase) => phrase.fencerId === fencerId);
  const result: FencerAggregate = {
    fencerId,
    phrases: rows.length,
    reviewedPhrases: 0,
    touchesScored: 0,
    touchesReceived: 0,
    noTouch: 0,
    unresolved: 0,
    scoringRate: null,
    attackAttempts: 0,
    attackScores: 0,
    defenseScores: 0,
    priorityGained: 0,
    priorityLost: 0,
    actionCounts: {},
  };

  for (const phrase of rows) {
    const ownSide = phrase.fencerSide;
    const otherSide = ownSide === 'left' ? 'right' : 'left';
    if (phrase.reviewState !== 'draft') result.reviewedPhrases += 1;
    if (phrase.award === ownSide) result.touchesScored += 1;
    else if (phrase.award === otherSide) result.touchesReceived += 1;
    else if (phrase.award === 'none') result.noTouch += 1;
    else result.unresolved += 1;

    for (const action of phrase.actions) {
      if (action.actor !== ownSide && action.actor !== 'both') continue;
      result.actionCounts[action.label] = (result.actionCounts[action.label] ?? 0) + 1;
      if (action.category === 'attack') {
        result.attackAttempts += 1;
        if (phrase.award === ownSide) result.attackScores += 1;
      }
      if (action.category === 'defense' && phrase.award === ownSide) result.defenseScores += 1;
      if (action.priorityBefore !== ownSide && action.priorityAfter === ownSide) result.priorityGained += 1;
      if (action.priorityBefore === ownSide && action.priorityAfter === otherSide) result.priorityLost += 1;
    }
  }
  const decisive = result.touchesScored + result.touchesReceived;
  result.scoringRate = decisive > 0 ? result.touchesScored / decisive : null;
  return result;
}
