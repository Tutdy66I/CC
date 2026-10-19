# CC

CC is a web application built with React, TypeScript, and Vite. The application lives in [`react-app/`](react-app/); project notes and collaboration guidance live in [`docs/`](docs/).

## Requirements

- Node.js and npm

## Getting started

```bash
cd react-app
npm install
npm run dev
```

Vite prints the local development URL in the terminal.

## Commands

Run these from `react-app/`:

| Command           | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| `npm run dev`     | Start the development server                             |
| `npm run build`   | Check TypeScript, build the app, and generate RSS output |
| `npm run lint`    | Run ESLint                                               |
| `npm run preview` | Preview the production build locally                     |
| `npm start`       | Serve the production build and RSS proxy on Node.js       |

For production hosting, use a Node.js service: run `npm run build`, then `npm start`.
The server listens on `PORT` when provided, or port `4173` by default. It serves
the built site and `/api/rss-proxy` from the same origin. Static-only hosting
requires a platform-specific serverless adapter for the RSS proxy.

## Project layout

- `react-app/src/` — application source
- `react-app/public/` — static assets
- `docs/` — project and collaboration documentation
- `playground/` — experiments and prototypes
