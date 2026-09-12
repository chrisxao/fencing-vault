# Video skeleton tracking preview

Sabre Studio uses pretrained **RTMPose-m with HALPE26 body/foot points**, preceded by the published YOLOX HumanArt person detector. It runs locally on CPU through ONNX Runtime. No fencing model was trained from scratch. Model proposals live in `pose_tracking_runs`, separate from `pose_keyframes` and label exports. Human corrections retain media/model provenance and PostgreSQL history.

## Run it

Use Python 3.11 and the repository root:

```sh
python3.11 -m venv .local/pose-venv
.local/pose-venv/bin/pip install -r ml/pose/requirements.txt
.local/pose-venv/bin/python ml/pose/setup.py
npm run db:migrate
npm run dev
```

`setup.py` downloads the two named publisher checkpoints and verifies their SHA-256 hashes. The runtime never trains or downloads weights during a job. Set `POSE_PYTHON` or `POSE_MODELS_DIR` to override the defaults. Python geometry tests: `.local/pose-venv/bin/python -m unittest discover -s ml/pose -p 'test_*.py'`.

For hosting, `Dockerfile.pose` includes the CPU runtime; the regular `Dockerfile` does not. This preview runs **one API instance**, one active tracking job at a time. Ready results are stored in PostgreSQL; interrupted jobs report failure and can be restarted. Jobs can be cancelled, are capped at 20 minutes of footage, 4 GB source size, and four hours of processing. It is not a distributed queue. Temporary source copies are removed after completion. The API must have enough CPU, RAM, disk, and access to the attached S3 video. The optional Docker image has not been built on this Mac.

For a private development test, set `DATABASE_URL=` and `POSE_DEMO_VIDEO=/absolute/path/to/clip.mp4`. This attaches that file only to the demo bout, without uploading it. It is disabled in production. Demo labels and runs are transient; use PostgreSQL for persistent work. Local video, credentials, downloaded models, and runtime results are Git-ignored.

## Labeling workflow

1. Attach/upload or capture the playable bout. Open **Geometry**, or use the geometry panel immediately when no phrase is selected.
2. Seek to a frame with both fencers visible. Optionally select each fencer by clicking inside their body; this excludes referees and background people. Without selection the largest two eligible people are proposed and must be checked.
3. Choose a duration and sampling rate, then **Track from this frame**. Start with short exchanges. Higher rates better preserve fast action but increase CPU time. The video plays normally while a range is processing.
4. Turn **Skeletons** on/off. Blue and amber identify the initially selected left/right athletes; limb names mean anatomical left/right. Dashed points/segments signal low confidence. Empty frames and cuts are not interpolated across.
5. Choose a side, then **Edit on video**. This pauses and locks the frame. Drag joints; click to add the selected joint; use arrow keys for a pixel nudge (Shift for ten); Delete removes a focused joint. Mark occlusions instead of inventing hidden evidence. Add guard, blade midpoint, and tip manually.
6. Save the correction, then **Done editing**. Saved human points take priority at their timestamp. Corrections are not automatically propagated to adjacent frames. **Next uncertain frame** jumps to samples with missing/low-confidence points.

Playback uses video frame callbacks; normalized coordinates account for object-fit letterboxing. Sampling uses decoded presentation timestamps rather than `frame / nominal fps`. Human frame numbers remain null where the exact source ordinal is unknown. Reviewed keyframes, model runs, and source hashes remain distinct.

## Camera movement and measurements

Open **Camera and strip position**. On the starting frame, identify two known longitudinal piste markings, enter their positions from the left end, then click their intersections with near/far piste edges in this order: left-near, left-far, right-far, right-near. Do not enter 0 and 14 for a zoomed-in view that does not show both ends. The preview assumes a 1.5 m width, stated in the UI.

OpenCV tracks background features with forward/backward optical flow and a RANSAC homography, excluding detected people and (without calibration) the top/bottom broadcast bands. With calibration, features are restricted to the piste plane. Foot positions project into that plane; provisional speed uses a short temporal window. This separates a camera pan from athlete motion. Metric output stops when feature support is lost or a cut breaks continuity. Without known markings, absolute strip position and speed stay **unknown**. Background homography alone is only relative camera evidence; it does not solve parallax, unseen strip endpoints, aerial feet, or moving overlays. No claim of human-level scene understanding is made.

## Research and observed evidence — 2026-09-12

- [RTMPose paper](https://arxiv.org/abs/2303.07399), [RTMLib implementation](https://github.com/Tau-J/rtmlib), and [official HALPE26 point definitions](https://github.com/open-mmlab/mmpose/blob/main/configs/_base_/datasets/halpe26.py): chosen because the pretrained body-and-feet model ran successfully on fencing footage with CPU ONNX inference. Code/model terms remain those of their publishers; no weights are committed here.
- [MediaPipe Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js): practical browser alternative with 33 landmarks and multi-pose settings. Its hip-relative world landmarks are not piste coordinates. The Python 1.0.1 package crashed during native Metal graph initialization on this Mac, so no fencing accuracy conclusion can be drawn from that attempt.
- [FenceNet](https://arxiv.org/abs/2204.09434): supports studying fencing footwork using skeleton sequences; it does not validate broadcast sabre identity or blade tracking. [The original fencing-AI experiment](https://github.com/GalDude33/fencing-AI) supplied a supporting public test clip; it contains background athletes and is not a sabre accuracy benchmark.
- [OpenCV homography](https://docs.opencv.org/4.13.0/d9/dab/tutorial_homography.html) and [optical-flow APIs](https://docs.opencv.org/4.13.0/dc/d6b/group__video__track.html): camera compensation primitives, with the planar and visibility limits above.

The requested [Do vs Bazadze recording](https://fencingtv.com/competitions/fencing-world-championship-hong-kong-china-2026/bouts/019f92dc-af11-7aed-96e7-c595b022776a) was captured from **42:00 to 59:00** using the owner's authenticated local session. The first 30 seconds include the introduction; they are not an action test. In a 20-second active interval at 42:40–43:00, RTMPose produced both fencer poses in 201/201 sampled frames at 10 Hz (inclusive endpoints). The in-app test at approximately 42:40.7–42:50.7 produced both poses in 100/100 samples. Browser observation confirmed aligned overlays, playback following, hiding/showing, and a draggable saved correction. These are detection coverage and interaction checks, **not labeled joint-accuracy measurements**, and do not establish full-bout tracking accuracy.

Before using geometry to train tactical analysis: review varied lunges, overlap, fast blade movements, cuts, and zooms; measure human-labeled joint error and identity switches across bouts; validate metric motion against calibrated ground truth. Weapon detection, robust re-identification after cuts, automatic line recognition, and automatic tactical calls remain future work.
