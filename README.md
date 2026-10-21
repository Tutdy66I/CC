# CC

CC is a web application built with React, TypeScript, and Vite. The application lives in [`react-app/`](react-app/); project notes and collaboration guidance live in [`docs/`](docs/).

## Requirements

- Node.js 24 and npm (CI uses Node 24)

## Getting started

```bash
cd react-app
npm ci
npm run dev
```

Vite prints the local development URL in the terminal.

## Commands

Run these from `react-app/`:

| Command                 | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `npm run dev`           | Start the development server                             |
| `npm run build`         | Check TypeScript, build the app, and generate RSS output |
| `npm run lint`          | Run ESLint                                               |
| `npm test`              | Run unit and local HTTP integration tests                |
| `npm run typecheck`     | Check app, server, tests and E2E TypeScript              |
| `npm run test:e2e`      | Test Chromium desktop/mobile, Firefox and WebKit         |
| `npm run benchmark:ber` | Benchmark BER scans with exact reference parity          |
| `npm run preview`       | Preview the production build locally                     |
| `npm start`             | Serve the production build and RSS proxy on Node.js      |

For production hosting, use a Node.js service: run `npm run build`, then `npm start`.
The server listens on `PORT` when provided, or port `4173` by default. It serves
the built site and `/api/rss-proxy` from the same origin. Static-only hosting
requires a platform-specific serverless adapter for the RSS proxy.

SignalLab includes BPSK, QPSK, BER scans, and an AI experiment tutor. To enable
the tutor, configure server-side `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY`.
See [AI tutor setup and validation](docs/signallab-ai-tutor.md).

SignalLab v0.6 adds Gray 16QAM, its constellation and hard decisions, reference-aided
RMS EVM for all three modulations, and a Worker-based BER/EVM comparison at equal
Eb/N0. See [v0.6 definitions, validation and limitations](docs/signallab-v0.6.md).

SignalLab v0.7 adds reproducible multi-seed BER statistics, sample spread and
conservative pointwise bounds in a separate Worker, with CSV export and worker
failure/recovery coverage. See [v0.7 validation and limits](docs/signallab-v0.7.md).

BPSK, QPSK, 16QAM and the single-seed scans can export HTML reports or Markdown,
including graphs, results, and optional completed AI conversations. HTML reports
can be printed to PDF. See [report export](docs/signallab-report-export.md).

SignalLab v0.5 adds CI, bounded-memory BER scans, reproducible benchmarks and
automated browser coverage. See the [developer guide](react-app/README.md),
[implementation and validation report](docs/signallab-v0.5.md), and
[AI tutor security review and proposal](docs/signallab-ai-security-v0.5.md).
GitHub Actions runs tests, Lint, TypeScript checks, a production build, browser
tests and benchmark parity on pushes and pull requests. After all checks pass,
`master` publishes the static edition to GitHub Pages. See [Pages deployment](docs/github-pages.md)
for the URL, validation commands and backend limitations.

## Project layout

- `react-app/src/` — application source
- `react-app/public/` — static assets
- `docs/` — project and collaboration documentation
- `playground/` — experiments and prototypes
