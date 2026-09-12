"""Download the published RTMPose / YOLOX checkpoints; no training required."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2] / '.local' / 'pose-models'
MODELS = {
    'detector.onnx': 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_m_8xb8-300e_humanart-c2c7a14a.zip',
    'pose.onnx': 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip',
}
EXPECTED = {'detector.onnx': '3dea6513388889f0fff4b77bf7a26013600321b9eb9ceb0e9a400a82572f5f23', 'pose.onnx': '26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf'}
ROOT.mkdir(parents=True, exist_ok=True)
manifest = {}
for name, url in MODELS.items():
    target = ROOT / name
    if not target.exists():
        archive = ROOT / (name + '.zip')
        print('Downloading', name, flush=True)
        urllib.request.urlretrieve(url, archive)
        with zipfile.ZipFile(archive) as z:
            entry = next(n for n in z.namelist() if n.endswith('.onnx'))
            target.write_bytes(z.read(entry))
        archive.unlink()
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest != EXPECTED[name]:
        raise ValueError(f'Checkpoint checksum mismatch: {name}. Remove it and retry from the official source.')
    manifest[name] = {'url': url, 'sha256': digest}
(ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print('Pretrained models ready:', ROOT)
