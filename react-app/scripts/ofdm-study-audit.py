"""Independent stdlib-only archive parser/statistician; never imports TS or its summaries.
SHA integrity detects corruption, not an adversary rewriting an entire unanchored archive.
"""
import hashlib
import json
import math
import pathlib
import sys
import time
import cmath
import re
import stat

PROTOCOL = 'e9654ff6b2dcd4e733afccc543af3bc99fdc03431a19e13399d637389b0ddaf4'
METHODS = [p+'-'+e for p in ['ideal', 'training', 'comb'] for e in ['zf', 'mmse']]
ENERGIES = ['data-eb', 'total-eb']
BITS = 688


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(b):
    return hashlib.sha256(b).hexdigest()


def runtime_identity():
    return dict(version=sys.version, executableSha256=digest(pathlib.Path(sys.executable).read_bytes()),
                probes=[math.sin(1), math.sqrt(2)], isolated=sys.flags.isolated, dontWriteBytecode=bool(sys.dont_write_bytecode))


def unique(pairs):
    d = {}
    for k, v in pairs:
        require(k not in d, 'duplicate JSON key')
        d[k] = v
    return d


def decode(b):
    def number(text):
        n = float(text)
        require(math.isfinite(n), 'non-finite JSON number')
        return n
    return json.loads(b, object_pairs_hook=unique,
                      parse_float=number,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError('non-finite JSON')))


def canonical(x):
    # Budget constants have no exponent-form or nonintegral 1e21-scale values.
    if isinstance(x, dict):
        return '{'+','.join(json.dumps(k)+':'+canonical(x[k]) for k in sorted(x))+'}'
    if isinstance(x, list):
        return '['+','.join(canonical(v) for v in x)+']'
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return json.dumps(x, separators=(',', ':'), ensure_ascii=False)


def read(path, maximum=8388608, mirror=True):
    require(path.is_file() and not path.is_symlink(), 'missing file or symlink: '+str(path))
    require(path.stat().st_size <= maximum, 'oversized file')
    b = path.read_bytes()
    if mirror:
        other = pathlib.Path(str(path)+'.backup')
        require(other.stat().st_size <= maximum and b == other.read_bytes(), 'backup mismatch: '+str(path))
    return b, decode(b)


def count(n, maximum):
    return type(n) is int and 0 <= n <= maximum


def finite(x, minimum=0):
    return type(x) in (int, float) and math.isfinite(x) and x >= minimum


def ledger(root, m):
    files = sorted((root/'leases').glob('*.json'))
    previous = None
    charged = 0
    session = None
    reserved = 0
    settled = False
    sessions = set()
    heads = []
    completions = []
    sealed_reports = []
    for i, p in enumerate(files):
        require(p.name == f'{i:06d}.json', 'resource ledger gap')
        # A live host can be finishing its second durable copy; never accept a mismatch.
        for attempt in range(3):
            try:
                b, e = read(p, 65536)
                break
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(.01)
        require(e['seq'] == i and e['previous'] == previous, 'resource ledger chain')
        require(isinstance(e['session'], str) and re.fullmatch('[a-f0-9]{32}', e['session']) is not None, 'unsafe resource session identity')
        require(e['memoryBytes'] == m['limits']['memoryBytes'] and e['hardWorkingSet'] is True,
                'native memory enforcement absent')
        require(e['hardWorkingSetCeilingBytes'] == 535822336, 'hard working-set safety margin changed')
        require(e['timeLimitMs'] == m['limits']['activeMs'] and
                e['diskLimitBytes'] == m['limits']['diskBytes'], 'resource limits changed')
        require(e['hostRuntime'] == m['identity']['guardHost'], 'native runtime changed')
        if session != e['session']:
            require(e['session'] not in sessions, 'resource session repeated')
            sessions.add(e['session'])
            session, reserved, settled = e['session'], 0, False
        require(not settled, 'event after resource settlement')
        if e['kind'] == 'grant':
            require(count(e['reservedMs'], 30000) and e['reservedMs'] > 0, 'invalid grant')
            reserved += e['reservedMs']
            charged += e['reservedMs']
        else:
            require(e['kind'] == 'settle' and e['usedMs'] == reserved, 'prepaid time must never be refunded')
            settled = True
            if 'groups' in e:
                heads.append((e['groups'], e['head']))
                receipt = root/'receipts'/(e['session']+'.json')
                require(digest(receipt.read_bytes()) == e['receiptSha256'], 'native receipt anchor')
                if e['result'] == 'exited' and e['childExit'] == 0 and (m['mode'] != 'formal' or e.get('action') == 'formal' and 'finalReport' in e):
                    completions.append((e['groups'], e['head']))
                if 'finalReport' in e:
                    require(e['finalReport'] == 'reports/'+e['session']+'-final.json', 'final report path identity')
                    fb, final = read(root/e['finalReport'], 2097152)
                    require(digest(fb) == e['finalReportSha256'] and final['manifestSha256'] == (root/'manifest.sha256').read_text(), 'final report seal mismatch')
                    sealed_reports.append(final)
        require(e['chargedMs'] == charged <= m['limits']['activeMs'], 'cumulative time reset/overflow')
        require(count(e['peakWorkingSetBytes'], m['limits']['memoryBytes']), 'native peak exceeded')
        previous = digest(b)
    require(len(list((root/'leases').iterdir())) == 2*len(files), 'unexpected resource journal file')
    require(files, 'missing resource budget journal')
    return dict(chargedMs=charged, sessions=len(sessions), heads=heads, completions=completions, sealedReports=sealed_reports)


def expected_plan(m, group, energy):
    s = m['budget']['primaryScope']
    return {k: s[k] for k in ['fftSize', 'cp', 'dataSymbols', 'modulation', 'activeBins', 'taps', 'channels', 'ebN0Db', 'pilotLayouts']} | dict(
        energyBasis=energy, trials=80, seed=m['schedule']['seedBase']+group, noiseEnabled=True)


def plan_hash(plan):
    # Independently encode the published wire definition, not a TypeScript-generated expected hash.
    p = dict(engineVersion='ofdm-v13.2', randomVersion='signallab-ofdm-rng-v1', plan=plan,
             fft='unitary-both;standard-bin', channel='continuous-FIR-zero-prehistory;block-static;PDP-only-normalization',
             pilots='public-QPSK:((13*k+7)^(k>>>2))&3;Ep=Es;one-full-training-plus-comb-in-every-data-symbol',
             interpolation='signed-physical-frequency;real-imag-linear;edges-required;no-extrapolation',
             energy='Es=bitsPerSymbol;dataEb=1;expected-total-Eb;fixed-pilot-CP-exact;data-pilot-CP-cross-term',
             pairing='shared-channel/virtual-4bits-per-standard-bin/standard-noise;all-and-common-data;layout-pairs-common-only',
             statistics='complete-independent-frames;Hoeffding-alpha=.05;failure-bounds;no-partial-interval;no-multiplicity-correction',
             receiver='no-truth-entry;LS-Y/P;gain-aware-scalar-MMSE;zero-or-nonfinite-erasure',
             random='SHA256-domain|seed|trial|role|slot;LE4;xoshiro128**;4bits/standard-bin;BoxMuller-pair/sqrt2')
    return digest(canonical(p).encode())


def close(a, b):
    return finite(a, -1e300) and abs(a-b) <= 1e-9*(1+abs(b))


def channel_truth(plan, index):
    seed = hashlib.sha256(f'signallab-ofdm-rng-v1|{plan["seed"]}|{index}|channel|0'.encode()).digest()
    s = [int.from_bytes(seed[k:k+4], 'little') for k in range(0, 16, 4)]
    mask = 2**32-1
    def rotate(x, k):
        return ((x << k) | (x >> (32-k))) & mask
    def uniform():
        result = (rotate((s[1]*5) & mask, 7)*9) & mask
        t = (s[1] << 9) & mask
        s[2] ^= s[0]
        s[3] ^= s[1]
        s[1] ^= s[2]
        s[0] ^= s[3]
        s[2] ^= t
        s[3] = rotate(s[3], 11)
        return result/2**32
    power = sum(t['power'] for t in plan['taps'])
    taps = [math.sqrt(-2*math.log(1-uniform()))/math.sqrt(2)*cmath.exp(2j*math.pi*uniform())*math.sqrt(t['power']/power)
            for t in plan['taps']]
    return {q: sum(h*cmath.exp(-2j*math.pi*(q % 128)*t['delay']/128) for h, t in zip(taps, plan['taps'])) for q in plan['activeBins']}


def geometry(plan):
    active, layouts = plan['activeBins'], plan['pilotLayouts']
    common = set(active)-set(sum(layouts, []))
    def pilot(q):
        k = q % 128
        c = ((13*k+7) ^ (k >> 2)) & 3
        return complex(-1 if c & 1 else 1, -1 if c & 2 else 1)
    def cp_energy(positions):
        return sum(abs(sum(pilot(q)*cmath.exp(2j*math.pi*(q % 128)*t/128) for q in positions)/math.sqrt(128))**2 for t in range(112, 128))
    training = cp_energy(active)
    result = []
    for pilots in layouts:
        weights = {}
        for q in active:
            j = next(j for j in range(len(pilots)-1) if pilots[j] <= q <= pilots[j+1])
            b = (q-pilots[j])/(pilots[j+1]-pilots[j])
            weights[q] = (pilots[j], pilots[j+1], 1-b, b)
        pilot_cp = 4*cp_energy(pilots)
        eb = (960+training+4*.125*(96-len(pilots))*2+pilot_cp)/(8*(96-len(pilots)))
        result.append(dict(weights=weights, common=sorted(common), all=[q for q in active if q not in pilots], expectedEb=eb, trainingCp=training, pilotCp=pilot_cp))
    return result


def metric_bounds(trial, layout, channel, snr):
    if trial['status'] == 'failed':
        return {method: (0, BITS, BITS) for method in METHODS}
    c = next(c for c in trial['raw']['cells'] if (c['layout'], c['scope'], c['channel'], c['ebN0Db']) ==
             (layout, 'common', channel, snr))
    return {k: (v['errors'], v['errors']+v['erasedBits'], v['erasedBits']) for k, v in c['methods'].items()}


def validate_trial(t, index, group, plan, geom):
    require(t['index'] == index and t['globalFrame'] == group*80+index, 'trial duplicate/gap/global identity')
    if t['status'] == 'failed':
        require(set(t) == {'index', 'globalFrame', 'status', 'error', 'rawAttempt'} and isinstance(t['error'], str) and 0 < len(t['error']) <= 4096,
                'failure omitted or malformed')
        return
    require(set(t) == {'index', 'globalFrame', 'status', 'raw'} and t['status'] == 'ok', 'unknown trial status')
    raw = t['raw']
    require(set(raw) == {'index', 'cells'} and raw['index'] == index and len(raw['cells']) == 32, 'incomplete vector')
    expected = [(l, s, c, db) for l in [0, 1] for c in ['awgn', 'rayleigh'] for db in [0, 8, 16, 24] for s in ['all', 'common']]
    truths = {'awgn': {q: 1+0j for q in plan['activeBins']}, 'rayleigh': channel_truth(plan, index)}
    references = {}
    for layout, g in enumerate(geom):
        for scope in ['all', 'common']:
            qs = g[scope]
            for channel, truth in truths.items():
                bias = 0
                for q in qs:
                    l, r, a, b = g['weights'][q]
                    bias += abs(a*truth[l]+b*truth[r]-truth[q])**2
                references[(layout, scope, channel)] = (4*sum(abs(truth[q])**2 for q in qs), 4*bias, sum(a*a+b*b for q in qs for l, r, a, b in [g['weights'][q]]))
    for c, key in zip(raw['cells'], expected):
        require((c['layout'], c['scope'], c['channel'], c['ebN0Db']) == key, 'repeated or reordered condition')
        require(c['cpSufficient'] is True and finite(c['noisePower']), 'CP/noise model mismatch')
        tones = 344 if key[1] == 'common' else 4*(96-[4, 8][key[0]])
        require(c['estimation']['tones'] == tones, 'tone denominator mismatch')
        for k in ['trainingError', 'combError', 'channelEnergy', 'bias', 'noise']:
            require(finite(c['estimation'][k]), 'non-finite channel statistic')
        n0 = (1 if plan['energyBasis'] == 'data-eb' else geom[key[0]]['expectedEb'])/10**(key[3]/10)
        reference = references[key[:3]]
        require(close(c['noisePower'], n0) and close(c['energy']['expectedEbTotal'], geom[key[0]]['expectedEb']), 'independent energy/noise reference')
        require(close(c['energy']['useful'], 960) and close(c['energy']['total'], c['energy']['useful']+c['energy']['cp']), 'energy balance')
        g = geom[key[0]]
        require(close(c['energy']['trainingCp'], g['trainingCp']) and close(c['energy']['pilotCp'], g['pilotCp']) and
                close(c['energy']['training'], 192+g['trainingCp']) and
                close(c['energy']['pilotUseful'], 8*len(plan['pilotLayouts'][key[0]])) and
                close(c['energy']['dataUseful'], 8*(96-len(plan['pilotLayouts'][key[0]]))), 'independent training/pilot resource energy')
        require(close(c['energy']['cp'], sum(c['energy'][k] for k in ['trainingCp', 'dataCp', 'pilotCp', 'crossCp'])), 'CP cross-term balance')
        require(close(c['estimation']['channelEnergy'], reference[0]) and close(c['estimation']['bias'], reference[1]) and
                close(c['estimation']['noise'], 2*n0*reference[2]), 'independent seeded channel / interpolation bias / noise reference')
        v = c['preview']
        if index == 0 and key[1] == 'all':
            require(v['bins'] == plan['activeBins'] and v['pilots'] == plan['pilotLayouts'][key[0]] and len(v['truth']) == 192, 'preview geometry')
            for j, q in enumerate(plan['activeBins']):
                require(close(v['truth'][2*j], truths[key[2]][q].real) and close(v['truth'][2*j+1], truths[key[2]][q].imag), 'seeded frequency response reference')
        else:
            require(all(not x for x in v.values()), 'unexpected preview outside first local frame')
        require(set(c['methods']) == set(METHODS), 'receiver methods mismatch')
        for v in c['methods'].values():
            require(v['bits'] == 2*tones and count(v['errors'], 2*tones) and
                    count(v['erasedBits'], 2*tones-v['errors']) and v['erasedBits'] % 2 == 0,
                    'invalid error/erasure denominator')
            require(count(v['deepFadeSymbols'], tones) and close(v['signalEnergy'], 2*tones), 'invalid signal/fade metric')
            for k in ['rawErrorEnergy', 'decisionErrorEnergy']:
                require(v[k] is None or finite(v[k]), 'invalid EVM metric')
            require(not v['erasedBits'] or v['decisionErrorEnergy'] is None, 'erasure hidden in EVM')
        for prefix in ['ideal', 'training', 'comb']:
            a, b = [c['methods'][prefix+'-'+k] for k in ['zf', 'mmse']]
            require(all(a[k] == b[k] for k in ['errors', 'erasedBits', 'decisionErrorEnergy']), 'ZF/MMSE hard decisions diverged')
    for j in range(0, len(raw['cells']), 2):
        all_cell, common_cell = raw['cells'][j:j+2]
        require(all_cell['energy'] == common_cell['energy'], 'all/common physical energy differs')
        for method in METHODS:
            a, c = all_cell['methods'][method], common_cell['methods'][method]
            require(c['errors'] <= a['errors'] and c['erasedBits'] <= a['erasedBits'] and
                    a['errors']-c['errors']+a['erasedBits']-c['erasedBits'] <= a['bits']-c['bits'],
                    'common data is not a subset of all data')


def group_data(folder, number, previous, mh, m, headers_only=False):
    require(set(p.name for p in folder.iterdir()) == {n+s for n in ['data-eb.json', 'total-eb.json', 'audit.json', 'checkpoint.json'] for s in ['', '.backup']}, 'unexpected/duplicate group file')
    cp_bytes, cp = read(folder/'checkpoint.json', 65536)
    require(cp['schema'] == 'signallab-ofdm-study-checkpoint-1' and cp['manifestSha256'] == mh and
            cp['group'] == number and cp['previous'] == previous and
            cp['completedTrialVectors'] == (number+1)*80 and cp['nextGroup'] == number+1,
            'checkpoint chain or frame count')
    audit_bytes, a = read(folder/'audit.json', 65536)
    require(cp['auditSha256'] == digest(audit_bytes) and a['group'] == number and
            a['seed'] == m['schedule']['seedBase']+number and finite(a['elapsedMs']), 'audit log mismatch')
    require([f['name'] for f in cp['files']] == [e+'.json' for e in ENERGIES], 'paired energy order')
    if headers_only:
        for file in cp['files']:
            require((folder/file['name']).stat().st_size == file['bytes'] and pathlib.Path(str(folder/file['name'])+'.backup').stat().st_size == file['bytes'], 'prior batch missing/size changed')
        return digest(cp_bytes), []
    batches = []
    for file, energy in zip(cp['files'], ENERGIES):
        b, raw = read(folder/file['name'])
        require(file['sha256'] == digest(b) and file['bytes'] == len(b), 'raw batch SHA/length')
        require(raw['schema'] == 'signallab-ofdm-study-batch-1' and raw['manifestSha256'] == mh and
                raw['group'] == number and raw['energy'] == energy and
                raw['seed'] == m['schedule']['seedBase']+number, 'raw batch identity')
        require(raw['plan'] == expected_plan(m, number, energy) and len(raw['trials']) == 80, 'frozen plan changed')
        require(raw['protocolHash'] == plan_hash(raw['plan']), 'per-batch protocol digest mismatch')
        geom = geometry(raw['plan'])
        for i, t in enumerate(raw['trials']):
            validate_trial(t, i, number, raw['plan'], geom)
        batches.append(raw)
    return digest(cp_bytes), batches


def hypothesis_rows():
    return [dict(energy=e, channel=c, ebN0Db=db, contrast=k,
                 contrastDefinition='P8 comb-zf minus P8 training-zf; common data' if k == 0 else 'P4 comb-zf minus P8 comb-zf; common data',
                 sumLowerBits=0, sumUpperBits=0, unknownBits=0,
                 frameObservations=0) for e in ENERGIES for c in ['awgn', 'rayleigh'] for db in [0, 8, 16, 24] for k in [0, 1]]


def analyze_pair(rows, batches):
    for raw in batches:
        for row in rows:
            if row['energy'] != raw['energy']:
                continue
            for trial in raw['trials']:
                p8 = metric_bounds(trial, 1, row['channel'], row['ebN0Db'])
                if row['contrast'] == 0:
                    a, b = p8['comb-zf'], p8['training-zf']
                else:
                    p4 = metric_bounds(trial, 0, row['channel'], row['ebN0Db'])
                    a, b = p4['comb-zf'], p8['comb-zf']
                row['sumLowerBits'] += a[0]-b[1]
                row['sumUpperBits'] += a[1]-b[0]
                row['unknownBits'] += a[2]+b[2]
                row['frameObservations'] += 1


def intervals(rows, frames, formal_complete):
    radius = math.sqrt(2*math.log(2*32/.05)/36000)
    for r in rows:
        require(r['frameObservations'] == frames, 'correlated cells counted as extra frames')
        lo = r['sumLowerBits']/(frames*BITS) if frames else None
        hi = r['sumUpperBits']/(frames*BITS) if frames else None
        r['observedDifferenceBounds'] = [lo, hi]
        r['candidateSimultaneous95Interval'] = [max(-1, lo-radius), min(1, hi+radius)] if frames == 36000 else None
        r['candidatePrecisionAchieved'] = (hi-lo)/2+radius <= .02 if frames == 36000 else None
        r['candidateDirectionSupported'] = ('positive' if lo-radius > 0 else 'negative' if hi+radius < 0 else 'unresolved') if frames == 36000 else 'not-tested'
        r['simultaneous95Interval'] = [max(-1, lo-radius), min(1, hi+radius)] if formal_complete else None
        r['statisticalRadius'] = radius if formal_complete else None
        r['precisionAchieved'] = (hi-lo)/2+radius <= .02 if formal_complete else None
        r['directionSupported'] = ('positive' if lo-radius > 0 else 'negative' if hi+radius < 0 else 'unresolved') if formal_complete else 'not-tested'
        r['equivalenceTested'] = False


def describe_batch(acc, raw):
    for trial in raw['trials']:
        for layout in [0, 1]:
            for channel in ['awgn', 'rayleigh']:
                for db in [0, 8, 16, 24]:
                    cell = None if trial['status'] == 'failed' else next(c for c in trial['raw']['cells'] if
                           (c['layout'], c['scope'], c['channel'], c['ebN0Db']) == (layout, 'common', channel, db))
                    for method in METHODS:
                        key = (raw['energy'], layout, channel, db, method)
                        row = acc.setdefault(key, dict(frames=0, erasedBits=0, failedFrames=0, rawSum=0., decisionSum=0., signalSum=0., rawInvalid=0, decisionInvalid=0, histogram={}, evmValid=0))
                        row['frames'] += 1
                        if cell is None:
                            row['failedFrames'] += 1
                            row['erasedBits'] += BITS
                            row['rawInvalid'] += 1
                            row['decisionInvalid'] += 1
                            continue
                        v = cell['methods'][method]
                        row['erasedBits'] += v['erasedBits']
                        row['failedFrames'] += v['erasedBits'] > 0
                        row['signalSum'] += v['signalEnergy']
                        for field, target in [('rawErrorEnergy', 'raw'), ('decisionErrorEnergy', 'decision')]:
                            if v[field] is None:
                                row[target+'Invalid'] += 1
                            else:
                                row[target+'Sum'] += v[field]
                        if v['decisionErrorEnergy'] is not None:
                            value = math.sqrt(v['decisionErrorEnergy']/v['signalEnergy'])
                            slot = 'zero' if value == 0 else str(max(-385, min(384, math.floor(math.log10(value)*32))))
                            row['histogram'][slot] = row['histogram'].get(slot, 0)+1
                            row['evmValid'] += 1


def descriptions(acc):
    rows = []
    for key, row in sorted(acc.items()):
        quantiles = {}
        for q in [.5, .9, .99]:
            target = math.ceil(q*row['evmValid'])
            seen, bounds = 0, None
            order = sorted(row['histogram'], key=lambda k: -math.inf if k == 'zero' else int(k))
            for slot in order:
                seen += row['histogram'][slot]
                if seen >= target:
                    i = int(slot) if slot != 'zero' else 0
                    bounds = [0, 0] if slot == 'zero' else [0 if i == -385 else 10**(i/32), None if i == 384 else 10**((i+1)/32)]
                    break
            quantiles[str(q)] = bounds
        record = dict(zip(['energy', 'layout', 'channel', 'ebN0Db', 'method'], key))
        record.update({k: row[k] for k in ['frames', 'erasedBits', 'failedFrames', 'rawInvalid', 'decisionInvalid', 'evmValid']})
        for prefix in ['raw', 'decision']:
            value = row[prefix+'Sum']/(row['frames']*344)
            record[prefix+'PooledMse'] = value if not row[prefix+'Invalid'] and math.isfinite(value) else None
        record['frameDecisionEvmQuantileBrackets'] = quantiles
        record['quantileMethod'] = 'fixed log10 histogram, 1/32 decade; explicit zero/underflow/overflow, no statistical CI'
        rows.append(record)
    return rows


def audit(root, stage=None, report=False):
    for p in (stage if stage else root).rglob('*'):
        require(not p.is_symlink() and not getattr(p, 'is_junction', lambda: False)(), 'symlink/junction in archive')
    mb, m = read(root/'manifest.json', 262144)
    mh = digest(mb)
    require((root/'manifest.sha256').read_text() == mh, 'manifest anchor mismatch')
    b = m['budget'].copy()
    require(b.pop('protocolSha256') == PROTOCOL and digest(canonical(b).encode()) == PROTOCOL, 'frozen protocol changed')
    formal = m['mode'] == 'formal'
    require(m['schema'] == 'signallab-ofdm-study-1' and m['mode'] in ['formal', 'engineering'] and m['formalAdmission'] == formal, 'mode/admission')
    require(isinstance(m['studyId'], str) and len(m['studyId']) == 32 and isinstance(m['locationBinding'], str) and len(m['locationBinding']) == 64, 'study identity/location binding')
    require(m['schedule'] == dict(groups=450 if formal else 2, batchFrames=80, seedBase=2026102603 if formal else 3026102603, energies=ENERGIES), 'seed or sample schedule')
    require(m['limits'] == dict(activeMs=7200000 if formal else 120000, memoryBytes=536870912,
                               diskBytes=17179869184 if formal else 134217728, minimumFreeBytes=21474836480), 'resource budget')
    require(m['identity']['auditRuntime'] == runtime_identity(), 'independent Python runtime/options changed')
    own = next(e for e in m['identity']['tools'] if e['path'] == 'scripts/ofdm-study-audit.py')
    require(digest(pathlib.Path(__file__).read_bytes()) == own['sha256'], 'auditor differs from frozen executable source')
    if stage:
        require(stage.parent == root/'pending' and not stage.is_symlink(), 'staging path outside pending directory')
        groups = sorted((root/'groups').iterdir()) if (root/'groups').exists() else []
        require(len(groups) < m['schedule']['groups'] and all(p.is_dir() and not p.is_symlink() and p.name == f'{i:06d}' for i, p in enumerate(groups)), 'prior group naming/gap')
        previous = None
        if groups:
            cp_bytes, cp = read(groups[-1]/'checkpoint.json', 65536)
            require(cp['group'] == len(groups)-1 and cp['manifestSha256'] == mh and cp['nextGroup'] == len(groups), 'immediate parent identity')
            previous = digest(cp_bytes)
        group_data(stage, len(groups), previous, mh, m)
        return dict(stageVerified=True, immediateParentVerified=True, groups=len(groups), head=previous,
                    scope='new pair and immediate parent only; startup/final audits verify the entire archive')
    h = hashlib.sha256()
    seen_paths = set()
    for entry in m['identity']['sources'] + m['identity']['tools']:
        name = entry['path']
        require(isinstance(name, str) and (re.fullmatch(r'src/lib/[A-Za-z0-9_-]+\.ts', name) is not None or name in
                ['src/workers/ofdmResearch.worker.ts', 'src/workers/ofdmCombResearch.worker.ts', 'scripts/ofdm-study-common.mjs',
                 'scripts/ofdm-study-runner.mjs', 'scripts/ofdm-study-audit.py', 'scripts/ofdm-study-host.ps1', 'scripts/ofdm-study-guard.cs']), 'unsafe source snapshot path')
        require(name not in seen_paths, 'duplicate source snapshot path')
        seen_paths.add(name)
        path = pathlib.PurePosixPath(entry['path'])
        require(not path.is_absolute() and '..' not in path.parts, 'source path escape')
        data = (root/'source'/path).read_bytes()
        require(digest(data) == entry['sha256'], 'source snapshot changed')
        require(pathlib.Path(str(root/'source'/path)+'.backup').read_bytes() == data, 'source snapshot backup mismatch')
        if entry in m['identity']['sources']:
            h.update(entry['path'].encode()+b'\0'+data+b'\0')
    require(h.hexdigest() == m['identity']['kernelFingerprint'], 'numerical source fingerprint')
    if formal:
        require(h.hexdigest() == m['budget']['sourceFingerprint'], 'published kernel mismatch')
    resources = ledger(root, m)
    groups = sorted((root/'groups').iterdir()) if (root/'groups').exists() else []
    require(len(groups) <= m['schedule']['groups'], 'too many groups')
    rows, previous, heads, failed, descriptive, failed_vectors = hypothesis_rows(), None, {0: None}, 0, {}, 0
    for number, folder in enumerate(groups):
        require(folder.is_dir() and folder.name == f'{number:06d}', 'duplicate/missing/reordered group')
        previous, batches = group_data(folder, number, previous, mh, m, headers_only=stage is not None)
        if stage is None:
            analyze_pair(rows, batches)
            if report:
                for batch in batches:
                    describe_batch(descriptive, batch)
        failed += sum(t['status'] == 'failed' for raw in batches for t in raw['trials'])
        failed_vectors += sum(any(batch['trials'][i]['status'] == 'failed' for batch in batches) for i in range(80))
        heads[number+1] = previous
    for n, head in resources.pop('heads'):
        require(n in heads and heads[n] == head, 'committed tail missing against resource receipt')
    for p in (root/'receipts').glob('*.json') if (root/'receipts').exists() else []:
        _, receipt = read(p, 65536)
        require(receipt['manifestSha256'] == mh and heads.get(receipt['groups'], 'missing') == receipt['head'], 'checkpoint rollback against receipt')
    if formal and groups:
        approved = False
        for p in (root/'authorizations').glob('*.json'):
            _, a = read(p, 65536)
            approved |= a.get('approved') is True and a.get('manifestSha256') == mh and a.get('protocolSha256') == PROTOCOL and a.get('fixedTrialVectors') == 36000 and a.get('statement') == 'I authorize this exact 36000-trial study within its frozen resource limits.'
        require(approved, 'formal data without matching authorization')
    if stage:
        group_data(stage, len(groups), previous, mh, m)
        return dict(stageVerified=True, priorPrefixHeadersVerified=True, groups=len(groups), head=previous)
    frames = len(groups)*80
    completions = resources.pop('completions')
    sealed_reports = resources.pop('sealedReports')
    complete = formal and frames == 36000 and (len(groups), previous) in completions
    intervals(rows, frames, complete)
    for sealed in sealed_reports:
        require(complete and sealed['formalFixedHorizonComplete'] and sealed['independentTrialVectors'] == 36000 and len(sealed['primaryComparisons']) == 32, 'invalid formal report publication')
        for expected, actual in zip(rows, sealed['primaryComparisons']):
            require(all(expected[k] == actual[k] for k in ['energy', 'channel', 'ebN0Db', 'contrast', 'frameObservations', 'sumLowerBits', 'sumUpperBits', 'unknownBits', 'equivalenceTested', 'precisionAchieved', 'directionSupported']), 'published primary comparison changed')
            require(all(abs(a-b) <= 1e-12 for a, b in zip(expected['simultaneous95Interval'], actual['simultaneous95Interval'])), 'published interval changed')
    pending = len(list((root/'pending').iterdir())) if (root/'pending').exists() else 0
    # The transient publication marker is already covered by the fixed metadata
    # reserve; exclude it before stat so its concurrent release cannot race audit.
    coordination = root/'coordination'
    try:
        c = coordination.lstat()
        require(stat.S_ISDIR(c.st_mode), 'unsafe coordination directory')
    except FileNotFoundError:
        pass
    marker = coordination/'publication.lock'
    try:
        marker_stat = marker.lstat()
        require(stat.S_ISREG(marker_stat.st_mode) and marker_stat.st_size <= 1024, 'unsafe publication marker')
    except FileNotFoundError:
        pass
    charged_disk = 32*1024**2 + sum(math.ceil(p.stat().st_size/4096)*4096 for p in root.rglob('*') if p != marker and p.is_file())
    require(charged_disk <= m['limits']['diskBytes'], 'archive exceeds disk limit')
    result = dict(verified=True, manifestSha256=mh, mode=m['mode'], groups=len(groups), head=previous,
                  independentTrialVectors=frames, physicalCellFrames=frames*32, familySize=32,
                  formalFixedHorizonComplete=complete, failedArmTrials=failed, pendingAttemptDirectories=pending,
                  failedTrialVectors=failed_vectors,
                  fixedSampleTargetReached=frames == 36000,
                  analysisProvisional=formal and frames == 36000 and not complete,
                  countedDiskBytes=charged_disk, resourceLedger=resources,
                  inference='simultaneous fixed-horizon' if complete else 'verified prefix / engineering only; no inferential interval')
    if report:
        result['primaryComparisons'] = rows
        result['descriptiveCommonDataMetrics'] = descriptions(descriptive)
        result['interpretation'] = ['Each hypothesis uses complete trial vectors, not tones/bits/energy arms as independent observations.',
            'An interval containing zero is unresolved, never evidence of algorithm equivalence.',
            'The approximately 0.02 absolute BER resolution cannot resolve differences on a 1e-3 or smaller scale at high SNR.',
            'Significance describes direction under the model; practical importance requires the absolute percentage-point magnitude and context.',
            'Independence is a frame-model/PRNG assumption; distinct deterministic seeds do not prove stochastic independence.',
            'Hash integrity is not authentication against complete archive replacement; retain an external manifest/head anchor.']
    return result


if __name__ == '__main__':
    try:
        args = sys.argv[1:]
        require(args and len(args) <= 4, 'audit ROOT [--stage DIRECTORY | --report]')
        root = pathlib.Path(args[0]).resolve()
        stage = pathlib.Path(args[2]).resolve() if len(args) == 3 and args[1] == '--stage' else None
        require(args[1:] in [[], ['--report']] or stage is not None, 'unknown audit arguments')
        print(json.dumps(audit(root, stage, '--report' in args), allow_nan=False, separators=(',', ':')))
    except (ValueError, KeyError, TypeError, OSError, StopIteration, IndexError, OverflowError, AttributeError) as error:
        print('AUDIT REJECTED: '+str(error), file=sys.stderr)
        sys.exit(1)
