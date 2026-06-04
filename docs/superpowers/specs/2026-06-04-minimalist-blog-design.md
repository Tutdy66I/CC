# Minimalist Blog — Design Spec

**Date:** 2026-06-04
**Status:** Approved

---

## Overview

Add a minimal, Matt-Mullenweg-style blog to the existing React + TypeScript + Vite app. Two pages (list + detail), no router, no CMS, Markdown files as content source. One new dependency (`react-markdown`).

## Architecture

```
src/
├── main.tsx              # Entry (unchanged)
├── App.tsx               # Root — state-driven view switch
├── App.css               # Global minimal styles
├── pages/
│   ├── PostList.tsx      # Article list
│   └── PostDetail.tsx    # Article detail
├── posts/
│   ├── hello-world.md    # Sample Markdown post
│   └── ...               # More posts
└── index.css             # Typography reset / base
```

### View switching

`App.tsx` uses `useState<'list' | { slug: string }>`:
- `'list'` → renders `<PostList onSelect={slug => setState({slug})} />`
- `{slug}` → renders `<PostDetail slug={slug} onBack={() => setState('list')} />`

No router. No URL. YAGNI.

## Components

### PostList

- Scans `../posts/*.md` via `import.meta.glob`
- Each `.md` file has HTML-comment frontmatter for title and date
- Renders: title (clickable), date (gray), sorted by date desc

### PostDetail

- Receives `slug`, dynamically `import()` the corresponding `.md`
- Passes raw Markdown string to `react-markdown`
- 「← Back」link at top

## Post Format

```markdown
<!-- title: Hello World -->
<!-- date: 2026-06-04 -->

Your content here...
```

Title and date extracted from HTML comments at the top of each `.md` file.

## Styling

- **Layout:** single column, `max-width: 680px`, centered
- **Font:** `system-ui, sans-serif`, 18px body, 28px headings, `line-height: 1.7`
- **Colors:** white background, `#1a1a1a` text, gray secondary, blue links
- **List page:** large "Blog" heading, generous spacing between posts, no dividers
- **Detail page:** "← Back" link at top, title + date, Markdown content with light-gray code blocks
- **Nothing else:** no nav, no footer, no tags, no avatar, no social, no comments

## New Dependencies

Only `react-markdown` (~50KB). No react-router, no CMS, no state library.

## Files to Create

| File | Purpose |
|---|---|
| `src/pages/PostList.tsx` | Article list component |
| `src/pages/PostDetail.tsx` | Article detail component |
| `src/posts/hello-world.md` | Sample post |
| `src/App.css` | Overwrite with blog styles |

## Files to Modify

| File | Change |
|---|---|
| `src/App.tsx` | Replace Vite template content with view switch logic |
| `src/index.css` | Add typography reset |

## Files to Remove

| File | Reason |
|---|---|
| `src/ContactForm.tsx` | Not needed for blog |
| `src/ContactForm.css` | Not needed for blog |
| `src/assets/react.svg` | Vite template asset |
| `src/assets/vite.svg` | Vite template asset |
| `src/assets/hero.png` | Vite template asset |

## Edge Cases

- **Empty posts/ directory:** PostList shows "No posts yet" message
- **Invalid slug:** PostDetail shows "Post not found" with back link
- **Missing title/date in frontmatter:** fallback to filename as title, file mtime as date
- **Long content:** natural scroll, no truncation

## What This Is NOT

- No SEO (SSR/SSG not needed for v1)
- No RSS feed
- No pagination
- No dark mode
- No analytics
- No comments
- No code syntax highlighting beyond basic markdown code blocks
