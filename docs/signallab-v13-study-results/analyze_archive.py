"""Read frozen batches, aggregate common-data metrics, cross-check independent audit.

This never calls the simulator or modifies the archive. Outputs are exclusive-create.
"""
import collections
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()
audit = json.loads((out / 'audit-summary.json').read_text(encoding='utf-8'))
assert audit['verified'] and audit['formalFixedHorizonComplete']
assert audit['groups'] == 450 and audit['independentTrialVectors'] == 36000
assert len(audit['primaryComparisons']) == 32
stats = collections.defaultdict(lambda: dict(frames=0, tones=0, channelEnergy=0.0,
    trainingError=0.0, combError=0.0, bias=0.0, noise=0.0,
    methods=collections.defaultdict(lambda: dict(bits=0, errors=0, erased=0, deep=0))))
previous = None
failures = []
for group in range(450):
    directory = root / 'groups' / f'{group:06d}'
    checkpoint_bytes = (directory / 'checkpoint.json').read_bytes()
    cp = json.loads(checkpoint_bytes)
    assert cp['group'] == group and cp['previous'] == previous and cp['completedTrialVectors'] == (group+1)*80
    previous = hashlib.sha256(checkpoint_bytes).hexdigest()
    assert {f['name'] for f in cp['files']} == {'data-eb.json', 'total-eb.json'}
    for entry in cp['files']:
        data = (directory / entry['name']).read_bytes()
        assert len(data) == entry['bytes'] and hashlib.sha256(data).hexdigest() == entry['sha256']
        batch = json.loads(data)
        assert batch['group'] == group and len(batch['trials']) == 80
        for i, trial in enumerate(batch['trials']):
            assert trial['index'] == i and trial['globalFrame'] == 80*group+i
            if trial['status'] != 'ok':
                failures.append((group, batch['energy'], i, trial['status']))
                continue
            for cell in trial['raw']['cells']:
                if cell['scope'] != 'common':
                    continue
                key = (batch['energy'], cell['layout'], cell['channel'], cell['ebN0Db'])
                a = stats[key]; a['frames'] += 1
                for k in ['tones', 'channelEnergy', 'trainingError', 'combError', 'bias', 'noise']:
                    a[k] += cell['estimation'][k]
                for method, val in cell['methods'].items():
                    z = a['methods'][method]
                    z['bits'] += val['bits']; z['errors'] += val['errors']
                    z['erased'] += val['erasedBits']; z['deep'] += val['deepFadeSymbols']
assert previous == audit['head'] and not failures and len(stats) == 32
for key, x in stats.items():
    assert x['frames'] == 36000 and x['tones'] == 36000*344
    for val in x['methods'].values():
        assert val['bits'] == 36000*688 and val['erased'] == 0
for r in audit['primaryComparisons']:
    energy, channel, snr = r['energy'], r['channel'], r['ebN0Db']
    if r['contrast'] == 0:
        left, right = stats[(energy,1,channel,snr)]['methods']['comb-zf'], stats[(energy,1,channel,snr)]['methods']['training-zf']
    else:
        left, right = stats[(energy,0,channel,snr)]['methods']['comb-zf'], stats[(energy,1,channel,snr)]['methods']['comb-zf']
    assert left['errors']-right['errors'] == r['sumLowerBits'] == r['sumUpperBits']
records = []
for (energy, layout, channel, snr), x in sorted(stats.items()):
    result = {k:x[k] for k in ['frames','tones','channelEnergy','trainingError','combError','bias','noise']}
    result.update(energy=energy, layout=layout, channel=channel, ebN0Db=snr)
    result['methods'] = dict(x['methods'])
    records.append(result)
payload = dict(schema='sealed-data-aggregate-v1', manifestSha256=audit['manifestSha256'], head=previous,
    auditedTrials=36000, failures=failures, scope='common-data-only', records=records)
with (out/'aggregate.json').open('x', encoding='utf-8', newline='\n') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
print(json.dumps(dict(records=len(records), failures=len(failures), head=previous, trialVectors=36000)))
