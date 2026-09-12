# Sabre ML

This package defines the contracts and quality gates for a staged video pipeline. It is deliberately not a monolithic “video in, referee call out” model.

1. Preserve source timestamps and propose `Play`/`Halt` phrase boundaries.
2. Segment and track each fencer; estimate body, weapon, piste position, and distance.
3. Predict timestamped actions and priority transitions with uncertainty intervals.
4. Build an ordered event graph and apply the versioned rules engine.
5. Abstain whenever uncertain event ordering can change the call. Every accepted proposal is still reviewed in the web app.

Recommended baselines are RTMPose for body pose, SAM 2.1 for prompted video segmentation, CoTracker3 for point tracking, a custom weapon keypoint head, a BiFenceNet-style temporal-convolution branch for footwork, and VideoMAE V2 for RGB temporal features. Install upstream projects in a pinned GPU image only when the corresponding human labels meet the stage gate.

The FenceNet branch is a baseline and an auxiliary feature encoder. Its original six-class Fencing Footwork Dataset uses isolated practice actions; the paper reports that those categories are imbalanced and overlap in competition. Sabre Studio therefore predicts coarse primitives and motion modifiers separately, then fuses those pose features with RGB and bout context. See `references/fencenet.md`.

Validate an exported dataset without model weights:

```bash
python -m pip install -e './ml[dev]'
sabre-ml ./sabre-studio-dataset.json --check
```

The fold generator groups by tournament and then fencer pairing. This prevents frames or adjacent phrases from one bout leaking into both training and evaluation.
