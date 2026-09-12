# Sabre video intelligence roadmap

The sequence is evidence → geometry → actions → priority → call. Dataset counts below are planning ranges, not guarantees; learning curves decide when to advance.

## Stage 0 — annotation reliability

Target: 30–50 bouts, roughly 1,000–2,000 phrases, with 10% independently re-labeled.

- Lock the phrase/no-touch ontology and editable action-key policy.
- Measure human boundary and call agreement.
- Calibrate piste geometry on representative camera layouts.
- Create tournament/fencer/camera-held-out splits before training.

Gate: reviewed labels are internally consistent, and common disagreements have explicit policy.

## Stage 1 — phrase segmentation

Target: 100–200 bouts and 3,000–6,000 reviewed phrases, including several hundred no-touch Halts and broadcast cuts.

Use audio (`Play`/`Halt`), referee motion, scoreboard/light changes, and short RGB temporal windows. Start with a compact VideoMAE V2 or TCN head. Return boundary probabilities and uncertainty, not hard clips.

Gate: ≥0.95 boundary F1 at ±100 ms on held-out tournaments before proposals become default. Humans still confirm every segment.

## Stage 2 — fencer, weapon, and piste perception

Target: 20,000–50,000 strategically sampled keyframes across venues, lighting, uniforms, camera cuts, and occlusions.

- SAM 2.1: prompted fencer masks and temporal propagation.
- RTMPose/MMPose: body initialization and corrections.
- CoTracker3: dense point continuity between reviewed anchors.
- Custom small-object keypoint detector: guard, blade midpoint, tip.
- Piste-line detection + manual homography: real-world positions and distance.

Use active learning to request correction where tracks cross, weapon confidence drops, or geometry becomes physically impossible.

Gate: ≥0.90 left/right identity accuracy across full held-out bouts; keypoint PCK and distance error reported separately by occlusion state.

## Stage 3 — footwork and tactical events

Target: 8,000–15,000 phrases with dense action onsets; at least hundreds of examples for each promoted class.

FenceNet is the first pose-only baseline. The original paper used 2D skeletons and a dilated TCN, but its isolated six-class practice dataset does not mirror competition. Use coarse primitives plus overlapping modifiers, velocity/acceleration channels, athlete scale, piste direction, and opponent distance. Keep causal and bidirectional variants. Fuse the pose embedding with VideoMAE V2 RGB features for blade contact, lights, and occlusion.

Train separate heads for footwork, arm/threat state, blade events, target/light state, referee signals, and priority transitions. Evaluate macro F1, per-class precision/recall, onset error, calibration, and performance by athlete/camera.

Gate: median onset error below two 60-fps frames for high-confidence events, with useful precision at the chosen review workload.

## Stage 4 — rule-constrained call proposals

Target: 15,000–30,000 reviewed phrases and a smaller high-quality adjudicated set concentrated on ambiguous doubles and priority changes.

Construct an event graph with intervals and alternatives. Apply deterministic sabre transitions backed by the dated FIE/USA corpus. The language layer may explain and retrieve, but it cannot invent events or directly decide from pixels.

Abstain when track identity is uncertain, blade contact is unobservable, boundary confidence is low, or plausible event orderings produce different calls. Report selective accuracy and coverage together.

Gate: 100% of proposals include evidence, model versions, uncertainty, ruleset, references, and an abstention route. Human adjudication remains the exported ground truth.

## Stage 5 — continuous learning

- Rank review items by uncertainty, novelty, and expected training value.
- Detect data drift by venue, season, broadcast graphics, and rulebook edition.
- Freeze dataset manifests and model artifacts by checksum.
- Compare models on an untouched “gold” set; never tune against it.

Primary model references: [FenceNet](https://arxiv.org/html/2204.09434v1), [RTMPose](https://arxiv.org/abs/2303.07399), [MMPose](https://github.com/open-mmlab/mmpose), [SAM 2](https://github.com/facebookresearch/sam2), [CoTracker3](https://github.com/facebookresearch/co-tracker), and [VideoMAE V2](https://github.com/OpenGVLab/VideoMAEv2).
