# Sabre labeling protocol

Label in passes. Trying to decide the referee call while drawing skeletons creates confirmation bias and inconsistent timing.

## Pass 1 — source and bout

Confirm tournament, date, round, named fencers, and which athlete begins on screen-left/right. Keep the original frame rate and presentation timestamps. If the broadcast cuts, record the cut rather than inventing continuity.

## Pass 2 — phrase boundaries

A phrase is the interval from valid commencement after `Play` (or the clearest observable restart) through the referee’s `Halt` or another terminal condition. Mark both milliseconds and decoded frame numbers.

Start reasons include `Play`, restart, first visible movement when audio is absent, and broadcast return. End reasons include touch registration, no-touch Halt, violation, off-piste, corps-à-corps, dangerous/confused fencing, equipment, injury, period end, and broadcast cut.

A start followed by a referee Halt is still a phrase even when no touch is awarded. Record the halt reason and unchanged score. Do not discard it: those negatives teach the boundary model and prevent a future caller from equating every Halt with a scored touch.

## Pass 3 — geometry

At action onsets, blade interactions, occlusions, and ambiguous calls, label:

- screen side and persistent track ID;
- weapon-side shoulder, elbow, wrist; both hips, knees, and ankles; nose when visible;
- guard, blade midpoint, and tip;
- calibrated front/rear foot positions and opponent distance;
- meaningful occlusion.

Coordinates are normalized to the video frame. Piste meters come from a separate homography, not from pixel distance. Label `visible=false` instead of guessing an occluded joint.

## Pass 4 — ordered events

Create timestamped events for each fencer’s preparation and footwork, blade search/contact, attack/defense, light, referee gesture/voice, priority transition, and violation. Write visible evidence before tactical interpretation.

Footwork is multi-label. A competition action may be `lunge` + `waiting` + `jumping/sliding`; do not force it into one mutually exclusive drill class. Mark the onset of each characteristic. Stable action keys can be extended in Action Library without destroying old labels.

Use uncertainty honestly. If blade contact may occur across frames 812–814, the training export should eventually carry that interval. If alternate orderings would change priority, the caller must abstain.

## Pass 5 — call and review

Store these separately:

1. apparatus lights and target contact;
2. referee’s observed award;
3. analyst’s ordered action interpretation;
4. score before/after;
5. final award or explicit no-touch;
6. explanation and controlling rule references.

`Reviewed` means one careful human pass. `Adjudicated` means an independent second pass resolved disagreement. Model proposals remain proposals until accepted.

## Quality control

- Re-label at least 10% of bouts without seeing the first labels.
- Track boundary error, event-onset error, Cohen’s kappa per action, call agreement, and rule-reference agreement.
- Review every new action definition on 20 examples before using it as a training target.
- Hold out entire tournaments and fencers for evaluation; never split adjacent frames or phrases randomly.
