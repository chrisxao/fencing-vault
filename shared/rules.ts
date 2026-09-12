export interface RuleSource {
  id: string;
  authority: 'FIE' | 'USA Fencing';
  title: string;
  edition: string;
  publishedAt: string;
  url: string;
  scope: string;
}

export interface RuleCard {
  id: string;
  sourceId: string;
  refs: string[];
  title: string;
  summary: string;
  evidence: string[];
  tags: string[];
}

export const RULESET_ID = 'sabre-rules-2026-08-fie__2025-11-usaf' as const;

export const RULE_SOURCES: RuleSource[] = [
  {
    id: 'fie-technical-2026-08',
    authority: 'FIE',
    title: 'Technical Rules',
    edition: 'August 2026',
    publishedAt: '2026-08-03',
    url: 'https://static.fie.org/uploads/40/204138-Technical%20rules%20August%202026%20ang.pdf',
    scope: 'International technical rules, including sabre conventions t.96–t.106 and common rules.',
  },
  {
    id: 'usa-competition-2025-11',
    authority: 'USA Fencing',
    title: 'USA Fencing Rules for Competition',
    edition: 'November 2025',
    publishedAt: '2025-11-05',
    url: 'https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt0f86b976c72458f2/690baa8337acae1b6b5ac0d3/2025-11_USA_Fencing_Rules.pdf',
    scope: 'Domestic sanctioned events and American terminology; tracked separately from the FIE edition.',
  },
  {
    id: 'usa-referee-guidance-current',
    authority: 'USA Fencing',
    title: 'Referee FAQs and Guidelines',
    edition: 'Current web guidance',
    publishedAt: '2026-09-08',
    url: 'https://www.usafencing.org/Referee-faq-and-guidelines',
    scope: 'Domestic interpretation and referee guidance that supplements, but does not replace, the rulebook.',
  },
];

export const RULE_CARDS: RuleCard[] = [
  {
    id: 'fencing-time', sourceId: 'fie-technical-2026-08', refs: ['t.8'], title: 'Fencing time',
    summary: 'One fencing time is the duration needed to perform one simple fencing action. It is a relational timing concept, not a fixed video-frame threshold.',
    evidence: ['ordered action onsets', 'completion timestamps', 'uncertainty intervals'], tags: ['timing', 'priority', 'stop-hit'],
  },
  {
    id: 'attack-definition', sourceId: 'fie-technical-2026-08', refs: ['t.9', 't.10'], title: 'Attack and compound action',
    summary: 'An attack is the initial offensive action that extends the weapon arm and continuously threatens valid target before the lunge or flèche is launched. Compound attacks contain multiple movements or feints.',
    evidence: ['weapon-arm extension onset', 'continuous target threat', 'lunge or step-lunge onset', 'pause or arm withdrawal'], tags: ['attack', 'preparation', 'compound', 'arm'],
  },
  {
    id: 'point-in-line', sourceId: 'fie-technical-2026-08', refs: ['t.15', 't.102'], title: 'Point in line',
    summary: 'Point in line requires a straight weapon arm with the point continuously threatening target. An attacker must genuinely deflect an established line; mere blade contact is not enough, and a failed search gives the right to attack to the opponent.',
    evidence: ['arm geometry', 'tip-to-target direction', 'time line became established', 'blade contact and deflection'], tags: ['line', 'derobement', 'blade-search', 'priority'],
  },
  {
    id: 'play-halt', sourceId: 'fie-technical-2026-08', refs: ['t.22', 't.23'], title: 'Play, Halt, and phrase boundaries',
    summary: 'Actions initiated before Play do not count. Halt stops the bout; only a movement already begun before Halt may remain valid. Dangerous, confused, disarmed, and off-piste situations can end a phrase without a scored touch.',
    evidence: ['referee audio or gesture', 'first movement after Play', 'action onset relative to Halt', 'piste and equipment state'], tags: ['phrase-start', 'phrase-end', 'halt', 'no-touch'],
  },
  {
    id: 'corps-a-corps', sourceId: 'fie-technical-2026-08', refs: ['t.24', 't.25'], title: 'Close quarters and corps-à-corps',
    summary: 'Close-quarters fencing is allowed while weapons can be used correctly and the phrase can be followed. Body contact requires Halt; intentional contact to avoid a hit or jostling is penalized and can annul the offender’s hit.',
    evidence: ['body contact frame', 'movement causing contact', 'referee Halt', 'card or annulment'], tags: ['halt', 'corps-a-corps', 'violation'],
  },
  {
    id: 'passing-turning', sourceId: 'fie-technical-2026-08', refs: ['t.27', 't.28'], title: 'Turning and passing',
    summary: 'Turning the back is forbidden. Once a fencer completely passes the opponent the referee halts; immediate hits around the passing action are treated differently from later hits.',
    evidence: ['torso orientation', 'relative track ordering', 'crossing timestamp', 'hit timing'], tags: ['passing', 'turning', 'halt', 'violation'],
  },
  {
    id: 'target-covering', sourceId: 'fie-technical-2026-08', refs: ['t.29', 't.30', 't.97'], title: 'Target covering and non-sword hand',
    summary: 'Using the non-sword hand offensively or defensively, or covering/substituting valid target, is forbidden. The violation and any resulting annulment must be labeled independently from the tactical phrase.',
    evidence: ['non-sword hand position', 'target region occlusion', 'contact', 'card and score consequence'], tags: ['covering', 'violation', 'annulment'],
  },
  {
    id: 'piste-boundaries', sourceId: 'fie-technical-2026-08', refs: ['t.33', 't.34', 't.35', 't.36'], title: 'Leaving the piste',
    summary: 'Lateral and rear boundary events can stop fencing, change replacement position, or award a technical hit. Track feet and piste geometry separately from the weapon action.',
    evidence: ['both foot polygons', 'calibrated piste boundaries', 'first crossing frame', 'replacement and score'], tags: ['piste', 'distance', 'off-piste', 'halt'],
  },
  {
    id: 'referee-analysis', sourceId: 'fie-technical-2026-08', refs: ['t.53', 't.58', 't.59', 't.63'], title: 'Materiality, analysis, and referee signal',
    summary: 'The referee determines materiality, then analyzes the ordered phrase and applies the weapon conventions. Apparatus lights and referee gestures are evidence, but neither alone reconstructs the action sequence.',
    evidence: ['lights and audio', 'referee gesture sequence', 'ordered actions', 'observed award'], tags: ['referee', 'lights', 'call', 'evidence'],
  },
  {
    id: 'sabre-hit-method', sourceId: 'fie-technical-2026-08', refs: ['t.96'], title: 'How a sabre hit is made',
    summary: 'Point, cutting edge, flat, and back-of-blade contacts may score. Guard hits are forbidden and annulled; clear target contact through the opponent’s blade can remain valid.',
    evidence: ['weapon part contacting', 'target contact', 'guard contact', 'apparatus signal'], tags: ['hit', 'weapon', 'guard', 'target'],
  },
  {
    id: 'sabre-target', sourceId: 'fie-technical-2026-08', refs: ['t.97', 't.98'], title: 'Valid target and off-target contact',
    summary: 'Sabre target is above the horizontal line through the top of the hip bones. Ordinary non-valid contact does not stop the phrase, while a hit after a fencing fault or after both feet cross a lateral boundary does stop it and invalidates later hits.',
    evidence: ['contact point on body model', 'hip-line estimate', 'piste state', 'subsequent action timing'], tags: ['target', 'off-target', 'halt'],
  },
  {
    id: 'materiality-annulment', sourceId: 'fie-technical-2026-08', refs: ['t.99'], title: 'Electrical faults and annulment',
    summary: 'Equipment tests can require a just-awarded hit to be annulled. Store the original light/call, test evidence, and final score as separate observations rather than rewriting history.',
    evidence: ['apparatus light', 'equipment test', 'referee decision', 'score before and after'], tags: ['annulment', 'equipment', 'lights'],
  },
  {
    id: 'correct-sabre-attack', sourceId: 'fie-technical-2026-08', refs: ['t.100', 't.101'], title: 'Correct sabre attack',
    summary: 'The referee alone applies sabre priority. A correct attack continuously threatens target, with arm straightening before the lunge; the rule specifies completion timing for simple and compound lunge and step-forward-lunge attacks. Rear-foot passing in forward movement is forbidden.',
    evidence: ['arm-extension onset', 'threat continuity', 'front/rear foot events', 'target-contact time'], tags: ['attack', 'lunge', 'step-lunge', 'crossing-feet', 'priority'],
  },
  {
    id: 'feints-stop-hit', sourceId: 'fie-technical-2026-08', refs: ['t.102', 't.103'], title: 'Feints, blade searches, and stop hits',
    summary: 'A valid feint continuously threatens target. Finding the blade during a compound attack gives a right to riposte; a stop hit must precede the attacker’s final movement by one fencing time.',
    evidence: ['feint geometry', 'blade contact', 'final movement onset', 'stop-hit contact'], tags: ['feint', 'stop-hit', 'blade-search', 'priority-change'],
  },
  {
    id: 'beat-attack', sourceId: 'fie-technical-2026-08', refs: ['t.104'], title: 'Beat attack',
    summary: 'A beat on the opponent blade’s foible retains attack priority. A beat on the forte is badly executed and gives the opponent the right to an immediate riposte.',
    evidence: ['blade contact frame', 'contact location relative to guard', 'deflection', 'immediate response'], tags: ['beat', 'foible', 'forte', 'priority-change'],
  },
  {
    id: 'parry-riposte', sourceId: 'fie-technical-2026-08', refs: ['t.105'], title: 'Parry and immediate riposte',
    summary: 'A correctly executed parry prevents the attack arriving in its finishing line and grants the right to an immediate riposte. Flexible blade contact after a proper parry does not undo the parry.',
    evidence: ['attack finishing line', 'blade contact and deflection', 'target contact', 'riposte latency'], tags: ['parry', 'riposte', 'priority-change'],
  },
  {
    id: 'judging-double-actions', sourceId: 'fie-technical-2026-08', refs: ['t.106'], title: 'Simultaneous action and faulty double hit',
    summary: 'Truly simultaneous conception and execution annuls both hits. Otherwise the call follows the ordered fault: stop hit into a correct attack, failed avoidance, delayed riposte, failed blade search, interrupted compound attack, and related cases.',
    evidence: ['action-onset confidence intervals', 'priority transition graph', 'contact times', 'fault classification'], tags: ['simultaneous', 'double-light', 'call', 'priority'],
  },
  {
    id: 'penalty-consequences', sourceId: 'fie-technical-2026-08', refs: ['t.158', 't.159', 't.160', 't.161', 't.162', 't.165', 't.170'], title: 'Cards, penalty hits, and annulment',
    summary: 'Warnings, penalty hits, exclusions, and hit annulments have different consequences. Record violation, card, technical point, annulled touch, and final score as separate events.',
    evidence: ['referee card', 'offender side', 'score change', 'annulled hit', 'prior penalties'], tags: ['penalty', 'card', 'technical-point', 'annulment'],
  },
  {
    id: 'usa-domestic-authority', sourceId: 'usa-competition-2025-11', refs: ['t.100', 't.101', 't.106'], title: 'USA domestic ruleset',
    summary: 'USA Fencing’s rulebook governs sanctioned domestic events and uses American terminology. Keep its edition attached to every domestic label because it can lag or differ from the current international edition.',
    evidence: ['competition authority', 'competition date', 'ruleset edition'], tags: ['usa', 'domestic', 'ruleset'],
  },
  {
    id: 'usa-referee-guidance', sourceId: 'usa-referee-guidance-current', refs: ['t.121', 't.170'], title: 'USA referee guidance',
    summary: 'Published referee guidance supplies domestic interpretation examples, including irregular or dangerous guard contact. Treat guidance as a dated secondary layer and retain the controlling rulebook citation.',
    evidence: ['observed contact', 'danger or violence', 'referee card', 'guidance publication date'], tags: ['usa', 'guidance', 'guard-contact', 'violation'],
  },
];

function tokens(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9.]+/g) ?? []);
}

export function retrieveRuleCards(query: string, requestedRefs: string[] = [], limit = 8) {
  const queryTokens = tokens(query);
  const refs = new Set(requestedRefs.map((item) => item.toLowerCase()));
  return RULE_CARDS.map((card) => {
    const searchable = tokens([card.title, card.summary, ...card.tags, ...card.refs].join(' '));
    let score = 0;
    for (const token of queryTokens) if (searchable.has(token)) score += token.includes('.') ? 5 : 1;
    for (const ref of card.refs) if (refs.has(ref.toLowerCase())) score += 8;
    return { card, score };
  })
    .filter(({ score }) => score > 0 || (!query.trim() && refs.size === 0))
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id))
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(({ card }) => card);
}

export function buildRuleContext(query: string, requestedRefs: string[] = []) {
  const cards = retrieveRuleCards(query, requestedRefs);
  return {
    rulesetId: RULESET_ID,
    sources: RULE_SOURCES.filter((source) => cards.some((card) => card.sourceId === source.id)),
    cards,
    guardrails: [
      'Separate visible observation, temporal ordering, tactical interpretation, and final rules conclusion.',
      'Treat screen-left/right, track identity, and named-fencer identity as separate facts.',
      'Do not infer blade contact, target contact, or referee speech when it is not observable.',
      'Represent uncertain event times as intervals and abstain when ordering can change the call.',
      'A model call is a proposal. Reviewed human labels are the training ground truth.',
    ],
  };
}
