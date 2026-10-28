"""Independent read-only engineering audit. No runner or final summary is imported."""
import hashlib
import json
import math
import pathlib
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def simultaneous_interval(lower_sum, upper_sum, n, comparisons=4, alpha=0.05):
    """Framewise paired bounds in [-1,1]; Bonferroni simultaneous coverage."""
    require(n > 0 and comparisons > 0 and 0 < alpha < 1, 'invalid confidence inputs')
    require(-n <= lower_sum <= upper_sum <= n, 'invalid paired sums')
    radius = math.sqrt(2 * math.log(2 * comparisons / alpha) / n)
    return max(-1.0, lower_sum / n - radius), min(1.0, upper_sum / n + radius), radius


def audit_leases(root):
    folder = root / 'leases'
    files = sorted(folder.glob('*.json'))
    require(files and len(list(folder.iterdir())) == 2 * len(files), 'missing or unexpected resource leases')
    previous = None
    reports = []
    for index, path in enumerate(files):
        require(path.name == f'{index:06d}.json', 'resource lease sequence')
        data = path.read_bytes()
        require(data == pathlib.Path(str(path) + '.backup').read_bytes(), 'resource lease backup mismatch')
        event = json.loads(data)
        require(event['sequence'] == index and event['previous'] == previous and event['reservedSeconds'] == 60 and event['limitSeconds'] == 3600, 'resource lease chain')
        require(event['freeBytes'] >= 8589934592 and event['filesystem'] == 'NTFS', 'session free-space check')
        session = event['session']
        require(isinstance(session, str) and len(session) == 32 and all(c in '0123456789abcdef' for c in session), 'invalid resource session')
        report_path = root / 'sessions' / (session + '-report.json')
        if report_path.is_file():
            report = json.loads(report_path.read_bytes())
            require(report['session'] == session and report['hardWorkingSet'] is True and report['peakWorkingSetBytes'] <= 536870912 and report['peakJobCommitBytes'] <= 536870912, 'native resource gate')
            reports.append({'session': session, 'exitCode': report['exitCode'], 'deadlineExpired': report['deadlineExpired']})
        previous = sha(data)
    require(len(files) * 60 <= 3600, 'resource time budget exceeded')
    return {'leases': len(files), 'reservedSeconds': len(files) * 60, 'head': previous, 'reportedSessions': reports, 'allSessionsReported': len(reports) == len(files)}


def audit(root):
    root = pathlib.Path(root)
    manifest_bytes = (root / 'manifest.json').read_bytes()
    require(sha(manifest_bytes) == (root / 'manifest.sha256').read_text('utf-8'), 'manifest hash mismatch')
    m = json.loads(manifest_bytes)
    require(m['schema'] in ('signallab-v14-engineering-preflight-1', 'signallab-v14-research-stream-1') and m['mode'] in ('engineering', 'fixture', 'formal') and m['inference'] is False, 'invalid study mode')
    fixture = m['mode'] == 'fixture'
    formal = m['mode'] == 'formal'
    require(m['chunkFrames'] == 20 and (fixture or m['frames'] == (101504 if formal else 100)), 'fixed horizon changed')
    p = m['protocol']
    protocol_content = dict(p)
    claimed_protocol = protocol_content.pop('protocolSha256')
    canonical = json.dumps(protocol_content, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    require(sha(canonical) == claimed_protocol == '838c09680a471a05c96b79fee70fe3cdb447f9af1894e4c698b069234449c6b6', 'protocol hash mismatch')
    require(p['schema'] == 'signallab-v14-sync-study-protocol-1', 'protocol schema')
    require(p['schedule']['framesPerScenario'] == 25376 and p['schedule']['totalScenarioFrames'] == 101504 and p['schedule']['batchFrames'] == 1000 and p['schedule']['lastBatchFrames'] == 376, 'formal schedule')
    require([(s['channel'], s['ebN0Db']) for s in p['scenarios']] == [('awgn', 0), ('awgn', 8), ('multipath', 0), ('multipath', 8)], 'scenarios changed')
    require(p['limits'] == {'timeMs': 3600000, 'memoryBytes': 536870912, 'diskBytes': 4294967296, 'minimumFreeBytes': 8589934592}, 'limits changed')
    plan = m['plan']
    require(plan['cp'] == 16 and plan['cfo'] == 0.25 and plan['sto'] == 8 and plan['phase'] == 0 and plan['trials'] == (1000 if formal else 100) and plan['noiseEnabled'] is True and plan['energyBasis'] == 'data-eb', 'plan changed')
    if not fixture and not formal:
        require(plan['ebN0Db'] == 8 and plan['seed'] in (3140000000, 3140000001, 3140000002), 'preflight scenario changed')
        require(plan['taps'] == [{'delay': 0, 'i': 0.8, 'q': 0.1}, {'delay': 3, 'i': 0.2, 'q': -0.1}, {'delay': 7, 'i': 0.1, 'q': 0.05}], 'channel changed')
    if m['schema'] == 'signallab-v14-research-stream-1':
        seed_batch = plan['seed'] - 3140000000
        if fixture or formal:
            require((not fixture or m['identity'] == 'test-only') and plan['seed'] == 3140000000 and plan['ebN0Db'] == 0 and plan['taps'] == [{'delay': 0, 'i': 1, 'q': 0}], 'stream identity')
            full = [dict(scenario=s, batch=b, start=i, count=min(20, (376 if b == 25 else 1000) - i), seed=3140000000 + b) for s in range(4) for b in range(26) for i in range(0, 376 if b == 25 else 1000, 20)]
            expected_schedule = full[:len(m['schedule'])]
            require(len(expected_schedule) > 0 and m['frames'] == sum(v['count'] for v in expected_schedule) and (not formal or len(expected_schedule) == 5076), 'stream frame count')
        else:
            expected_schedule = [dict(scenario=3, batch=seed_batch, start=i * 20, count=20, seed=plan['seed']) for i in range(5)]
        require(m['schedule'] == expected_schedule, 'engineering schedule changed')
    identity = m['identity']
    verified_identity = False
    if isinstance(identity, dict):
        require(identity['schema'] == 'signallab-v14-preflight-identity-1', 'source identity schema')
        snapshot = root / 'source'
        require(snapshot.resolve() == pathlib.Path(identity['snapshotRoot']).resolve() and not snapshot.is_symlink(), 'source snapshot location')
        paths = set()
        for item in identity['files']:
            relative = pathlib.PurePosixPath(item['path'])
            require(not relative.is_absolute() and '..' not in relative.parts and item['path'] not in paths, 'unsafe or duplicate snapshot file')
            paths.add(item['path'])
            path = snapshot.joinpath(*relative.parts)
            require(path.is_file() and not path.is_symlink() and snapshot.resolve() in path.resolve().parents, 'unsafe snapshot file')
            require(sha(path.read_bytes()) == item['sha256'], 'snapshot hash mismatch')
        require('src/lib/ofdmSync/jointEngine.js' in paths and 'original/src/lib/ofdmSync/jointEngine.ts' in paths, 'missing numerical snapshots')
        auditor = [item['sha256'] for item in identity['tools'] if item['path'] == 'scripts/v14-study-audit.py']
        require(len(auditor) == 1 and auditor[0] == sha(pathlib.Path(__file__).read_bytes()), 'auditor identity changed')
        verified_identity = True
    else:
        require(identity == 'test-only', 'invalid test identity')
    require(not formal or verified_identity, 'formal source identity required')
    if formal:
        a = m['authorization']
        identity_json = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        directory = str(root.resolve())
        if sys.platform == 'win32':
            directory = directory.lower()
        require(a['schema'] == 'signallab-v14-formal-authorization-1' and a['protocolSha256'] == claimed_protocol and a['identitySha256'] == sha(identity_json) and a['directorySha256'] == sha(directory.encode('utf-8')) and a['scenarioFrames'] == 101504 and a['statement'] == 'I authorize the exact SignalLab v1.4 101504-frame study under its frozen limits.', 'formal authorization mismatch')
    resources = audit_leases(root) if verified_identity else None
    dirs = sorted((root / 'batches').iterdir())
    require([d.name for d in dirs] == [f'{i:06d}' for i in range(len(dirs))] and len(dirs) <= (len(m['schedule']) if m['schema'] == 'signallab-v14-research-stream-1' else 5), 'batch order or count')
    totals = {name: {'bits': 0, 'errors': 0, 'erasures': 0} for name in ('raw', 'ideal', 'estimated')}
    by_scenario = {i: {name: {'bits': 0, 'errors': 0, 'erasures': 0} for name in ('raw', 'ideal', 'estimated')} for i in range(4)}
    scenario_frames = [0, 0, 0, 0]
    scenario_failures = [{'failed': 0, 'cfoFailures': 0, 'timingFailures': 0, 'unsafeWindows': 0} for _ in range(4)]
    failed = cfo_failed = timing_failed = total_frames = 0
    previous = None
    for index, folder in enumerate(dirs):
        require(folder.is_dir() and not folder.is_symlink(), 'unsafe batch directory')
        require(sorted(p.name for p in folder.iterdir()) == ['batch.json', 'batch.sha256'], 'unexpected batch files')
        data = (folder / 'batch.json').read_bytes()
        require(sha(data) == (folder / 'batch.sha256').read_text('utf-8'), 'batch hash mismatch')
        batch = json.loads(data)
        if m['schema'] == 'signallab-v14-research-stream-1':
            require(batch['schema'] == 'signallab-v14-research-chunk-1' and batch['sequence'] == index and batch['parameters'] == m['schedule'][index], 'chunk parameters')
        else:
            require(batch['schema'] == 'signallab-v14-preflight-batch-1' and batch['index'] == index and batch['start'] == index * 20, 'batch identity')
        expected_start = batch['parameters']['start'] if 'parameters' in batch else index * 20
        expected_count = batch['parameters']['count'] if 'parameters' in batch else 20
        scenario = batch['parameters']['scenario'] if 'parameters' in batch else 3
        require(batch['previous'] == previous and batch['protocolSha256'] == p['protocolSha256'] and len(batch['frames']) == expected_count, 'batch chain')
        for offset, frame in enumerate(batch['frames']):
            require(frame['index'] == expected_start + offset, 'frame sequence')
            total_frames += 1
            scenario_frames[scenario] += 1
            e = frame['estimated']
            require(e['status'] in ('ok', 'failed'), 'acquisition status')
            if e['status'] == 'failed':
                failed += 1
                scenario_failures[scenario]['failed'] += 1
                reason = e['reason']
                require(reason in ('low-energy', 'low-coherence', 'low-correlation'), 'failure reason')
                cfo_failed += int(reason in ('low-energy', 'low-coherence'))
                timing_failed += int(reason == 'low-correlation')
                scenario_failures[scenario]['cfoFailures'] += int(reason in ('low-energy', 'low-coherence'))
                scenario_failures[scenario]['timingFailures'] += int(reason == 'low-correlation')
                require(e['metric']['errors'] == 0 and e['metric']['erasedBits'] == 768, 'failure denominator')
            if verified_identity:
                evaluation = frame['evaluation']
                if e['status'] == 'failed':
                    require(evaluation['estimatedWindowSafe'] is None and evaluation['estimatedTimingError'] is None and evaluation['cfoError'] is None, 'failed acquisition evaluation')
                else:
                    require(isinstance(e['cfo'], (int, float)) and math.isfinite(e['cfo']) and -1.000000000001 <= e['cfo'] < 1.000000000001 and isinstance(e['peak'], int) and isinstance(e['start'], int) and e['start'] == e['peak'] - 7 and 0.1 <= e['coherence'] <= 1.000000000001 and 0.1 <= e['score'] <= 1.000000000001, 'invalid acquisition measurement')
                    delta = e['start'] - (32 + 8 + 256 + 16)
                    delay = 0 if scenario in (0, 1) else 7
                    require(evaluation['estimatedTimingError'] == delta and evaluation['estimatedWindowSafe'] == (delay - 16 <= delta <= 0) and abs(evaluation['cfoError'] - (e['cfo'] - 0.25)) < 1e-10, 'incorrect truth-based evaluation')
            if frame.get('evaluation', {}).get('estimatedWindowSafe') is False:
                scenario_failures[scenario]['unsafeWindows'] += 1
            for name, item in (('raw', frame['raw']), ('ideal', frame['ideal']), ('estimated', e['metric'])):
                bits, errors, erasures = item['bits'], item['errors'], item['erasedBits']
                require(type(bits) is int and bits == 768 and type(errors) is int and type(erasures) is int and errors >= 0 and erasures >= 0 and errors + erasures <= bits, 'invalid metric')
                totals[name]['bits'] += bits
                totals[name]['errors'] += errors
                totals[name]['erasures'] += erasures
                by_scenario[scenario][name]['bits'] += bits
                by_scenario[scenario][name]['errors'] += errors
                by_scenario[scenario][name]['erasures'] += erasures
        previous = sha(data)
    n = total_frames
    raw, est = totals['raw'], totals['estimated']
    lower = (est['errors'] - raw['errors'] - raw['erasures']) / (768 * n) if n else None
    upper = (est['errors'] + est['erasures'] - raw['errors']) / (768 * n) if n else None
    per_scenario = []
    for s in range(4):
        count = scenario_frames[s]
        raw_s, est_s = by_scenario[s]['raw'], by_scenario[s]['estimated']
        lower_s = (est_s['errors'] - raw_s['errors'] - raw_s['erasures']) / (768 * count) if count else None
        upper_s = (est_s['errors'] + est_s['erasures'] - raw_s['errors']) / (768 * count) if count else None
        ber = {name: [item['errors'] / item['bits'], (item['errors'] + item['erasures']) / item['bits']] if item['bits'] else [None, None] for name, item in by_scenario[s].items()}
        per_scenario.append({'scenario': s, 'frames': count, **scenario_failures[s], **by_scenario[s], 'berBounds': ber, 'pairedBerDifferenceBounds': [lower_s, upper_s]})
    pending = len(list((root / 'pending').iterdir()))
    candidate = None
    if formal and scenario_frames == [25376] * 4 and n == 101504 and pending == 0 and resources['allSessionsReported']:
        candidate = []
        for row in per_scenario:
            low, high = row['pairedBerDifferenceBounds']
            left, right, radius = simultaneous_interval(low * 25376, high * 25376, 25376)
            candidate.append({'scenario': row['scenario'], 'lower': left, 'upper': right, 'radius': radius})
    return {'mode': m['mode'], 'frames': n, 'complete': n == m['frames'], 'sourceIdentityVerified': verified_identity, 'resources': resources, 'head': previous, 'failed': failed, 'cfoFailures': cfo_failed, 'timingFailures': timing_failed, **totals, 'pairedBerDifferenceBounds': None if formal else [lower, upper], 'perScenario': per_scenario, 'formalConclusion': False, 'confidenceInterval': None, 'candidateIntervals': candidate, 'pendingEntries': pending}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2, 'usage: v14-study-audit.py ROOT')
        print(json.dumps(audit(sys.argv[1]), ensure_ascii=False, sort_keys=True))
    except Exception as exc:
        print('AUDIT FAILED: ' + str(exc), file=sys.stderr)
        sys.exit(1)
