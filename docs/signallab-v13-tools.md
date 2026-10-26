# OFDM baseline tools

Run in `react-app` with Node 24 and dependencies installed from the existing lockfile.
The independent reference needs Python 3 standard library only. Set `SIGNALLAB_PYTHON`
to an absolute executable path when `python3` is unavailable; no NumPy is installed.

```sh
npm test
npm run test:ofdm-reference
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run test:cloud
npm run benchmark:ber -- --output benchmark-results.json
```

`test:ofdm-reference` regenerates a Python `cmath` O(N²) DFT/FIR/Toeplitz fixture,
then compares production transforms, the continuous link, public training CP energy,
RNG integer initialization, scalar equalizers and coherent BER formulas. Floating
comparisons use explicit tolerances; the SHA-256 integer state is exact. The CI gate
requires this test in addition to the TypeScript tests. Fixtures are deterministic,
small and public; runtime studies and screenshots are not committed.

```sh
npm run study:ofdm -- --register  # print the small fixed engineering protocol only
npm run study:ofdm -- --screen    # exactly 360 cell-frame, F20 per cell
npm run inspect:ofdm -- ../output/signallab-v13-screen/<run>/QPSK.json
npm run benchmark:ofdm           # default F200, 1200 cell-frame
```

The screen has three modulations, AWGN / four-tap block Rayleigh, and [0,8,16] dB
data Eb/N0. Each run creates a new timestamped local directory, with full frames,
source/runtime fingerprints, protocol/integrity hashes and file SHA-256. It does not
overwrite prior output. F20 is a magnitude/error screen, not a precision study or
algorithm selection result. The scripts expose no arbitrary matrix or formal-run
flag. Formal research requires a separately approved fixed protocol and budget.

Browser experiments reject plans above 4,000 cell-frame or 50,000,000 work-unit.
One work-unit expression is:

`F*cells*[2*(1+S)*N*log2(N) + (1+S)*(N+C)*L + 32*S*active]`.

Record serialization, download and import share an 8 MiB compact JSON budget,
including the integrity hash. The local database retains at most two complete
records and one checkpoint. A saved checkpoint resumes only with identical
protocol, source bytes and runtime fingerprint. Cancellation terminates the Worker
and saves only accepted complete frames; incomplete batches have no intervals.
Hard page/process termination is not a guarantee of saving the newest in-memory
prefix. CAS or quota failure preserves the previous database state and enables
export of the current in-memory result.

Node memory measurements sample the entire process's managed heap plus array
buffers. Desktop Chromium measurements sample the dedicated Worker's CDP managed
heap/backing store; native/OS peak working set is not established by either method.
Synchronous message timings exclude asynchronous continuation work. Mobile browser
emulation and desktop WebKit do not establish physical iPad compatibility.

No tool changes production data, cloud queues, RLS, Auth, or older local databases.
