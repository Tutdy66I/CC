"""CI adapter for the fixed public audit; no random roots or research inputs."""
import collections
import hashlib
import json
import pathlib
import re
import shutil
import struct
import subprocess
import sys

def hex64(x): return struct.pack('>d', x).hex()

KEYS = {'basic': ('op', 'a', 'b'), 'transcendental': ('op', 'input'),
        'qpsk-sign': ('input',), 'threshold': ('threshold', 'input')}

EXPECTED = []
for op, a, b in [('add',1,2**-53),('add',1,2**-52),('sub',1,1),
                 ('mul',5e-324,.5),('mul',5e-324,1.5),('div',1,3),('div',1,2),('div',-1,3)]:
    EXPECTED.append(('basic', (op, hex64(a), hex64(b))))
for x in (0.0,-0.0,.5,1.0,-.5,-1.0):
    for op in ('sin','cos'): EXPECTED.append(('transcendental',(op,hex64(x))))
for x in (0.0,-0.0,5e-324,.5,1.0,2.0,float.fromhex('0x1.fffffffffffffp+1023')):
    EXPECTED.append(('transcendental',('sqrt',hex64(x))))
for x in (-5e-324,-0.0,0.0,5e-324): EXPECTED.append(('qpsk-sign',(hex64(x),)))
for threshold in (1e-24,.1):
    integer = int(hex64(threshold),16)
    for delta in (-1,0,1): EXPECTED.append(('threshold',(hex64(threshold),format(integer+delta,'016x'))))

def validate(report):
    if not isinstance(report, dict) or not isinstance(report.get('results'), list) or len(report['results']) != 37:
        raise ValueError('expected exactly 37 results')
    runtime = report.get('node')
    if not isinstance(runtime, dict) or any(not isinstance(runtime.get(k), str) or not runtime[k] for k in ('node','v8','platform','arch')):
        raise ValueError('missing Node/V8 identity')
    seen = []
    for entry in report['results']:
        if not isinstance(entry, dict) or entry.get('status') != 'pass': raise ValueError('missing, failed or uncertified result')
        kind = entry.get('kind'); case = entry.get('case')
        if kind not in KEYS or not isinstance(case, dict): raise ValueError('invalid result')
        try: fields = tuple(case[k] for k in KEYS[kind])
        except KeyError as error: raise ValueError('missing input identity') from error
        if any(not isinstance(v, str) for v in fields): raise ValueError('invalid input identity')
        seen.append((kind,fields))
        if kind in ('basic','transcendental'):
            if not isinstance(case.get('result'),str) or not re.fullmatch('[0-9a-f]{16}',case['result']): raise ValueError('missing result bits')
            if kind == 'basic' and (not isinstance(entry.get('expected'),str) or not re.fullmatch('[0-9a-f]{16}',entry['expected'])): raise ValueError('missing expected bits')
            if kind == 'basic' and case['result'] != entry['expected']: raise ValueError('basic result mismatch')
            if kind == 'transcendental' and any(not isinstance(entry.get(k),str) or not re.fullmatch('[0-9a-f]{16}',entry[k]) for k in ('lower','upper')): raise ValueError('missing interval bits')
        elif kind == 'qpsk-sign':
            if type(case.get('decision')) is not int or type(entry.get('expected')) is not int: raise ValueError('missing decision')
            if case['decision'] != entry['expected']: raise ValueError('decision mismatch')
        elif not isinstance(entry.get('expected'),dict) or any(type(case.get(k)) is not bool or type(entry['expected'].get(k)) is not bool for k in ('gt','lt')):
            raise ValueError('missing threshold result')
        elif any(case[k] != entry['expected'][k] for k in ('gt','lt')):
            raise ValueError('threshold result mismatch')
    if collections.Counter(seen) != collections.Counter(EXPECTED): raise ValueError('missing, duplicate or unexpected input')

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def main():
    out = pathlib.Path('.test-build/numeric-public'); out.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([sys.executable,'-I','-B','scripts/v15-numeric-public-audit.py'],capture_output=True)
    (out/'audit.json').write_bytes(result.stdout)
    (out/'audit.stderr.txt').write_bytes(result.stderr)
    if result.returncode != 0: raise SystemExit('numeric audit failed; saved stdout and stderr')
    report = json.loads(result.stdout)
    validate(report)
    node = shutil.which('node')
    if not node: raise SystemExit('node executable missing')
    identity = {'python': {'version':sys.version,'executable':sys.executable,'sha256':digest(sys.executable)},
                'node': {**report['node'],'executable':node,'sha256':digest(node)},
                'auditSha256':digest(out/'audit.json'),'resultCount':len(report['results'])}
    (out/'runtime.json').write_text(json.dumps(identity,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(identity,indent=2))
    print('37 fixed public results passed; timing and memory are not compared')

if __name__ == '__main__': main()
