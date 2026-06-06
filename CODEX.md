# CC Project — React + TypeScript + Vite

> Shared project instructions. Also read by Claude Code as `CLAUDE.md`.
> See `docs/tool-collaboration.md` for multi-tool workflow.

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

## Shared Standards
Coding standards, React patterns, TypeScript patterns, and more live in `.claude/skills/` —
both Claude Code and Codex can reference them:

| Skill | File |
|---|---|
| Coding Standards | `.claude/skills/coding-standards/skill.md` |
| React Patterns | `.claude/skills/react/skill.md` |
| TypeScript Patterns | `.claude/skills/typescript/skill.md` |
| Frontend (forms, state, routing) | `.claude/skills/frontend/skill.md` |
| Error Handling | `.claude/skills/error-handling/skill.md` |
| API Design | `.claude/skills/api-design/skill.md` |
| Security | `.claude/skills/security/skill.md` |
| Performance | `.claude/skills/performance/skill.md` |

## Rules
- Never edit `node_modules/` or `package-lock.json` by hand
- Never touch `.claude/` except `settings.local.json`, `skills/`, `hooks/`
- Use `git` for version control; commit after each meaningful change
- Format code with Prettier before committing
- Verify TypeScript compiles before claiming work is done

## Multi-Tool Workflow
When working alongside Claude Code (or vice versa), use git worktrees for isolation.
See `docs/tool-collaboration.md` for the full guide.
