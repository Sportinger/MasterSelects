"""GPU smoke + input validation checks. Usage: python check.py worker.exe artifact-directory"""
import json
from pathlib import Path
import struct
import subprocess
import sys

worker = Path(sys.argv[1]).resolve()
artifacts = Path(sys.argv[2]).resolve()
artifacts.mkdir(parents=True, exist_ok=True)

def f32(values):
    return struct.pack('<' + 'f' * len(values), *values)

frame = bytearray(416)
def floats(lane, values):
    frame[lane * 4:lane * 4 + len(values) * 4] = f32(values)
def integers(lane, values):
    frame[lane * 4:lane * 4 + len(values) * 4] = struct.pack('<' + 'I' * len(values), *values)
floats(48, [0, 0, 4, 0])
floats(52, [1, 0, 0, 1])
floats(56, [0, 1, 0, 1])
floats(60, [0, 0, -1, .05])
floats(64, [0, 4, 1, 0])
floats(68, [64, 64, 64, 64])
integers(76, [0, 0, 1, 2])
integers(80, [2, 1, 0, 1])
integers(84, [0, 1, 0, 0])
floats(88, [0, 1, 1, 0])
floats(92, [0, 0, 1, 1])
light = f32([0, 0, 0, 3, .5, .5, .5, 0, 0, 0, 0, 1, 0, 0, 0, 1])
material = f32([1, 0, -1, 1, .8, .4, .2, .4, .4, 0, 1.55, 0, 1, 1, 1, 0, .2, 1, 0, 0])
# Page 0 is unused; the instance starts in page 1 and has a material-base offset.
identity = [1, 0, 0, -0., 0, 1, 0, -0., 0, 0, 1, -0.]
instance = f32(identity * 2) + struct.pack('<8I', 0, 1, 0, 1, 3, 2, 0, 1)
fiber = f32([0, -1, 0, .25, 0, 1, 0, .25]) + struct.pack('<4I', 0, 0x80ffffff, 0x80ffffff, 0)
hidden = f32([0, -1, 1, .5, 0, 1, 1, .5]) + struct.pack('<4I', 1 << 17, 0, 0, 0)
payloads = [frame, light, material * 2, instance, bytes(48), fiber + hidden]
header = struct.pack('<16I', 0x5850534d, 1, *(len(part) for part in payloads), *([0] * 8))
snapshot = artifacts / 'fixture.mspx'
snapshot.write_bytes(header + b''.join(payloads))

def render(name, samples=4, albedo=False):
    image = artifacts / (name + '.rgba32f')
    command = [str(worker), str(snapshot), str(image), str(samples)] + (['albedo'] if albedo else [])
    result = subprocess.run(command, capture_output=True, text=True, timeout=125)
    assert result.returncode == 0, result.stderr
    metrics = json.loads(result.stdout)
    assert metrics['segments'] == 1 and metrics['backend'] == 'OptiX 9.1', metrics
    pixels = struct.unpack('<' + 'f' * (64 * 64 * 4), image.read_bytes())
    assert pixels[3] == 0, 'Background must remain transparent'
    assert pixels[(32 * 64 + 32) * 4 + 3] == 1, 'Primary fiber missing'
    assert all(abs(value) < 100 for value in pixels), 'Invalid radiance'
    return image.read_bytes(), pixels, metrics

_, pixels, _ = render('albedo', albedo=True)
center = (32 * 64 + 32) * 4
assert max(abs(pixels[center + c] - [.8, .4, .2][c]) for c in range(3)) < 1e-6, 'Material page/rebase mismatch'
first, pixels, metrics = render('radiance')
assert sum(pixels[i] for i in range(0, len(pixels), 4)) > 1, 'No reflected illumination'
second, _, _ = render('repeat')
assert first == second, 'Native sampling is not deterministic'
for name, content in [('truncated', header + frame), ('bad-magic', bytes(4) + snapshot.read_bytes()[4:])]:
    malformed = artifacts / (name + '.mspx')
    malformed.write_bytes(content)
    result = subprocess.run([str(worker), str(malformed), str(artifacts / 'invalid.rgba32f'), '1'], capture_output=True, text=True, timeout=10)
    assert result.returncode != 0, 'Malformed input accepted'
evidence = {'passed': True, 'checks': ['page-1 fibers', 'material rebasing', 'hidden fibers', 'coverage', 'albedo', 'lighting', 'determinism', 'malformed input'], 'metrics': metrics}
(artifacts / 'checks.json').write_text(json.dumps(evidence, indent=2))
print(json.dumps(evidence))
