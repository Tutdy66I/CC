# CC Project — React + TypeScript + Vite

## Stack
- React 19, TypeScript 6, Vite 8
- ESLint (flat config), Prettier
- No router/state lib (add when needed)

## Commands
```bash
cd react-app
npm run dev      # Start dev server
npm run build    # TypeScript check + Vite build
npm run lint     # ESLint
npm run preview  # Preview production build
```

## Style
- Use functional components with hooks, no classes
- TypeScript strict mode — avoid `any`
- CSS files colocated with components
- `eslint.config.js` controls lint rules

## Rules
- Never edit `node_modules/` or `package-lock.json` by hand
- Never touch `.claude/` except `settings.local.json`, `skills/`, `hooks/`
- Use `git` for version control; commit after each meaningful change
- Format code with Prettier before committing
- Verify TypeScript compiles before claiming work is done
