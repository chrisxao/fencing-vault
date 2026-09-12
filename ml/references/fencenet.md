# How FenceNet informs Sabre Studio

Primary source: [Zhu, Wong, and McPhee, “FenceNet: Fine-Grained Footwork Recognition in Fencing,” CVPR Workshops 2022](https://arxiv.org/html/2204.09434v1). Dataset source: [Fencing Footwork Dataset](https://galaxy.agh.edu.pl/~fmal/ffd/).

## What to reuse

- A small temporal convolutional network over 2D joints is a strong, inexpensive baseline for footwork.
- Include the weapon-side wrist, elbow, and shoulder with both hips, knees, and ankles. The paper’s ablation found this targeted set stronger than lower-body-only or full-body inputs.
- Normalize translation and body scale, retain forward temporal ordering, and use a bidirectional branch for offline analysis.
- Evaluate with held-out fencers. Random clip splits substantially overstate generalization.
- Sample overlapping windows instead of zero-padding isolated actions.

## What not to copy literally

- FFD is 652 isolated practice clips from 10 fencers, captured at 30 Hz with Kinect skeleton/depth and no RGB. It is useful for a warm-start benchmark, not an estimate of broadcast performance.
- Its six labels are mutually exclusive: forward/back steps and four lunge dynamics. The authors found these labels imbalanced and not directly transferable to competition, where jumping/sliding motion can overlap speed or waiting characteristics.
- Phrase segmentation, two interacting fencers, blade actions, camera motion, occlusion, score lights, and rules calls are outside FenceNet’s task.

## Adaptation in this project

1. Train coarse primitives (`advance`, `retreat`, `lunge`, `jump`, `check`) and independent modifiers (`rapid`, `incremental speed`, `waiting`, `jumping/sliding`) as multi-label outputs.
2. Add joint velocity, acceleration/speed, confidence, calibrated piste direction, and opponent distance to normalized coordinates.
3. Keep a causal FenceNet head for live/current-tournament suggestions and a BiFenceNet-style head for completed bouts.
4. Fuse the skeleton embedding with an RGB temporal backbone so blade contact, lights, and occlusion remain observable.
5. Measure per-fencer, per-camera, and per-tournament generalization. Do not mix phrases from the same bout across train and test.
