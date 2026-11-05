"""Public test identity only; never reads or hashes protocol files."""
import hashlib
import json
import struct
import sys

names = ('01-model.json', '02-random.json', '03-statistics.json', '04-numeric.json', '05-evidence.json', '06-dependencies.json')
if len(sys.argv) != 3:
    raise SystemExit('usage: index revision')
index, revision = map(int, sys.argv[1:])
if index not in range(6) or revision not in range(2):
    raise SystemExit('public fixture coordinates only')
root = b'SL15PROT03' + struct.pack('>H', 6)
for i, name in enumerate(names):
    data = ('{"fixture":"public-only","revision":%d}\n' % (revision if i == index else 0)).encode('ascii')
    n = name.encode('ascii')
    root += struct.pack('>H', len(n)) + n + struct.pack('>Q', len(data)) + hashlib.sha256(data).digest()
protocol = hashlib.sha256(root).digest()
manifest = b'SL15MAN03' + root + protocol
print(json.dumps({'root':root.hex(), 'protocol':protocol.hex(), 'manifest':manifest.hex(), 'manifestHash':hashlib.sha256(manifest).hexdigest()}))
