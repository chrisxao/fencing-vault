"""RTMPose proposals on real video PTS. Never writes reviewed labels."""
import argparse
import hashlib
import itertools
import json
import sys
from pathlib import Path
import av
import cv2
import numpy as np
from rtmlib import BodyWithFeet
from geometry import Camera, project

NAMES = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'head', 'neck', 'hip', 'left_big_toe', 'right_big_toe', 'left_small_toe', 'right_small_toe', 'left_heel', 'right_heel']


def center(box):
    return np.array([(box[0]+box[2])/2, (box[1]+box[3])/2])


def select_pair(boxes, previous, seeds, width, height, movement):
    if len(boxes) < 2:
        return None
    if previous is None:
        if seeds:
            selected = []
            for side in ['left', 'right']:
                p = np.array([seeds[side]['x'] * width, seeds[side]['y'] * height])
                choices = [i for i, b in enumerate(boxes) if b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3]]
                if not choices:
                    return None
                selected.append(min(choices, key=lambda i: np.linalg.norm(center(boxes[i])-p)))
            return selected if selected[0] != selected[1] else None
        # Foreground heuristic only. The UI asks the reviewer to check identity or seed it.
        ranked = sorted(range(len(boxes)), key=lambda i: (boxes[i][2]-boxes[i][0])*(boxes[i][3]-boxes[i][1]), reverse=True)
        pair = sorted(ranked[:2], key=lambda i: center(boxes[i])[0])
        return pair
    anchors = np.array([center(b) for b in previous])
    if movement is not None:
        anchors = project(anchors, movement)
    costs = []
    for pair in itertools.permutations(range(len(boxes)), 2):
        distances = [np.linalg.norm(center(boxes[i])-anchors[j])/max(previous[j][3]-previous[j][1], height*.1) for j, i in enumerate(pair)]
        size_change = [abs(np.log(max(boxes[i][3]-boxes[i][1], 1)/max(previous[j][3]-previous[j][1], 1))) for j, i in enumerate(pair)]
        if max(distances) < .65 and max(size_change) < .65:
            costs.append((sum(distances)+sum(size_change)*.3, pair))
    costs.sort()
    if not costs or len(costs) > 1 and costs[1][0]-costs[0][0] < .18:
        return None
    return costs[0][1]


def run(args):
    options = json.loads(Path(args.options).read_text())
    source_hash = hashlib.file_digest(open(args.input, 'rb'), 'sha256').hexdigest()
    container = av.open(args.input)
    stream = container.streams.video[0]
    width, height = stream.codec_context.width, stream.codec_context.height
    # Inference and optical flow share a fixed image geometry; store normalized output.
    scale = min(1, 960 / width)
    w, h = round(width*scale), round(height*scale)
    camera = Camera(w, h, options.get('calibration'))
    model_dir = Path(args.models)
    # Library initialization logs go to stderr; stdout is reserved for progress JSON.
    stdout = sys.stdout
    sys.stdout = sys.stderr
    model = BodyWithFeet(det=str(model_dir/'detector.onnx'), det_input_size=(640, 640), pose=str(model_dir/'pose.onnx'), pose_input_size=(192, 256), backend='onnxruntime', device='cpu')
    sys.stdout = stdout
    start, end, fps = options['startMs'], options['endMs'], options.get('sampleFps', 10)
    origin = stream.start_time or 0
    container.seek(max(0, int(start/1000/stream.time_base)+origin), stream=stream, backward=True)
    next_ms, frames, previous, misses, shot, segment = start, [], None, 0, 0, 0
    initialized, lost, metrics = False, False, {}
    for frame in container.decode(stream):
        if frame.pts is None:
            continue
        ms = float((frame.pts-origin)*stream.time_base)*1000
        if ms < next_ms-.1:
            continue
        if ms > end:
            break
        next_ms = ms + 1000/fps - 1
        image = cv2.resize(frame.to_ndarray(format='bgr24'), (w, h))
        boxes = model.det_model(image)
        boxes = np.asarray([b for b in boxes if b[3]-b[1] > h*.15 and b[2]-b[0] > w*.018], np.float32).reshape(-1, 4)
        cam, cut, movement = camera.update(image, boxes)
        if cut:
            shot += 1
            lost = True
            metrics = {}
        pair = None if lost else select_pair(boxes, previous, options.get('seeds') if not initialized else None, w, h, movement)
        poses = []
        if pair is not None:
            selected = boxes[list(pair)]
            keypoints, scores = model.pose_model(image, bboxes=selected)
            previous = selected
            initialized, misses = True, 0
            for i, side in enumerate(['left', 'right']):
                points = []
                for name, (x, y), confidence in zip(NAMES, keypoints[i], scores[i]):
                    inside = 0 <= x < w and 0 <= y < h
                    points.append({'name': name, 'x': round(float(np.clip(x/w, 0, 1)), 5), 'y': round(float(np.clip(y/h, 0, 1)), 5), 'confidence': round(float(np.clip(confidence, 0, 1)), 3), 'visible': bool(inside and confidence >= .3)})
                quality = float(np.mean(scores[i][5:17]))
                if quality < .35:
                    continue
                feet = [keypoints[i][j] for j in [20, 21, 24, 25] if scores[i][j] >= .5]
                meters = camera.meters(np.mean(feet, axis=0)) if len(feet) >= 2 else None
                speed = None
                history = metrics.setdefault(side, [])
                if meters is not None:
                    history.append((ms, meters))
                    history[:] = [v for v in history if ms-v[0] <= 700]
                    if len(history) >= 3 and 250 <= ms-history[0][0] <= 700:
                        speed = (meters-history[0][1])/((ms-history[0][0])/1000)
                        if abs(speed) > 12:
                            speed = None
                else:
                    history.clear()
                poses.append({'side': side, 'trackId': f'{side}-s{shot}-t{segment}', 'keypoints': points, 'bbox': [round(float(v), 5) for v in selected[i]/np.array([w, h, w, h])], 'confidence': round(quality, 3), 'footMeters': round(meters, 3) if meters is not None else None, 'speedMps': round(speed, 3) if speed is not None else None})
        elif initialized:
            misses += 1
            metrics = {}
            # A short missed detection can recover spatially; a prolonged loss needs reseeding.
            if misses >= max(2, round(fps*.4)):
                lost = True
        frames.append({'timestampMs': round(ms), 'sourcePts': int(frame.pts), 'shot': shot, 'poses': poses, 'camera': cam})
        if len(frames) % 10 == 0:
            print(json.dumps({'progress': min(.99, (ms-start)/(end-start))}), flush=True)
    container.close()
    if not frames:
        raise ValueError('No decodable frames in the selected range.')
    warnings = ['Body and foot detections are proposals. Sabre points require manual labeling.', 'Identity uses spatial continuity, not biometric recognition. Check the initial pair.']
    if lost:
        warnings.append('Tracking stopped after a cut or identity loss. Start a new range and select the fencers again.')
    if not options.get('calibration'):
        warnings.append('Strip position and speed are unknown until visible piste markings are calibrated.')
    elif not camera.valid:
        warnings.append('Piste calibration lost visual support. Metric estimates stop at that point.')
    if not initialized:
        warnings.append('Two fencers were not found. Choose a frame with both athletes visible and select each fencer.')
    result = {'schemaVersion': 1, 'model': 'RTMPose-m HALPE26 / YOLOX-m HumanArt (rtmlib 0.0.16)', 'sourceSha256': source_hash, 'width': width, 'height': height, 'sampleFps': fps, 'frames': frames, 'warnings': warnings}
    Path(args.output).write_text(json.dumps(result, separators=(',', ':'), allow_nan=False))
    print(json.dumps({'progress': 1}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['input', 'output', 'options', 'models']:
        parser.add_argument('--'+name, required=True)
    try:
        run(parser.parse_args())
    except Exception as error:
        print(f'Tracking failed: {type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
