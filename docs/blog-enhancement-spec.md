# Blog 增强 — 标签系统 + 归档页 + RSS

> 提供给 Codex 作为实现规格。遵循现有代码风格和技术栈。

---

## 架构概述

```
现有:
  App.tsx → PostList (文章列表) → PostDetail (文章详情)

增强后:
  App.tsx → PostList (列表 + 标签过滤) → PostDetail (详情 + 标签)
         → ArchivePage (归档)
  public/rss.xml (构建时生成)
```

---

## Part 1: 标签系统

### 1.1 数据格式

Markdown 文件新增 `<!-- tags: ... -->` 元数据：

```md
<!-- title: Hello World -->
<!-- date: 2026-06-04 -->
<!-- tags: react, typescript, getting-started -->
```

`hello-world.md` 补充 `<!-- tags: hello, markdown -->` 作为示例。

### 1.2 数据层 (`lib/markdown.ts`)

新增：

```ts
export interface PostMeta {
  slug: string
  title: string
  date: string
  tags: string[]          // 新增
}

// parsePostMeta 需要新增 tags 提取：
// const TAGS_RE = /<!--\s*tags:\s*(.+?)\s*-->/
// tags: match ? match[1].split(',').map(s => s.trim()).filter(Boolean) : []

// 新增导出：所有标签的扁平列表，按出现次数降序
export function getAllTags(): { tag: string; count: number }[]
```

### 1.3 PostList 增强

- 每个文章条目下，时间旁边显示标签 pills
- 列表上方显示标签云（所有标签，可点击）
- 点击标签过滤文章列表（再点同一个标签取消过滤）
- 标签状态用组件内部 `useState<string | null>` 管理，不需要改 View

```
┌─────────────────────────────────┐
│  Blog                           │
│                                 │
│  [All] [react] [typescript] ... │  ← 标签云
│                                 │
│  文章1                          │
│  2024-01-01  [tag1] [tag2]      │
│  文章2                          │
│  2024-01-02  [tag3]             │
│  共 N 篇                        │
└─────────────────────────────────┘
```

### 1.4 PostDetail 增强

- 标题下方、日期旁边显示标签

### 1.5 CSS

- 标签 pill：小圆角胶囊，边框 + 浅背景
- 标签云里的 active pill：填充色
- 暗色模式适配

色值参考现有 `#4a90d9` / `#6b7280` / 暗色 `#93c5fd` / `#2e303a`

---

## Part 2: 归档页

### 2.1 路由

`App.tsx` View 类型新增：

```ts
type View =
  | { page: 'blog' }
  | { page: 'detail'; slug: string }
  | { page: 'archive' }
  | { page: 'todos' }
```

### 2.2 ArchivePage 组件

新建 `pages/ArchivePage.tsx` + `pages/ArchivePage.css`

功能：
- 接收 `onSelect: (slug: string) => void` 回调
- 将 `posts` 按年份分组，年内按日期降序
- 分组展示：
  ```
  2026
    06-04 — Hello World
    05-20 — Another Post
  2025
    12-31 — Year End Recap
  ```

### 2.3 入口

- PostList 页面底部或 heading 旁放 "归档 →" 链接
- 顶部导航加 "Archive" 按钮（仅当在 Blog 或 detail 页面时）

### 2.4 CSS

- 年份标题：大号字，顶部有分隔线
- 文章条目：日期 + 标题，hover 高亮
- 暗色模式适配

---

## Part 3: RSS

### 3.1 生成方式

由于是纯前端 Vite SPA，RSS 需要在**构建时**生成静态 XML 放到 `public/` 目录。

新建 `scripts/generate-rss.ts`：

```ts
// 读取 src/posts/*.md，生成 public/rss.xml
// 用法: npx tsx scripts/generate-rss.ts (手动) 或作为 build 钩子
```

### 3.2 RSS 内容要求

- 标准 RSS 2.0 格式
- `<title>` — 从每篇文章的 `<!-- title: -->`
- `<link>` — `https://<your-domain>/#/post/<slug>`（域名留占位符 YOUR_DOMAIN）
- `<description>` — 正文前 200 字符（去掉 markdown 标记）
- `<pubDate>` — 从 `<!-- date: -->` 转换
- 文章按日期降序

### 3.3 集成到构建

`package.json` 的 `build` 脚本改为：

```json
"build": "tsc -b && vite build && npx tsx scripts/generate-rss.ts"
```

### 3.4 npm 依赖（可选）

不需要额外依赖。用 Node.js 内置 `fs` + `path` + 现有的 `markdown.ts` 中的 `posts` 数据即可（需要做 Node 兼容处理，或直接读文件系统）。

简化方案：`generate-rss.ts` 独立读取 `src/posts/*.md`，不依赖 markdown.ts 的 Vite glob（因为那是浏览器 API）。

---

## 实施顺序（推荐）

1. **标签系统** — 改 `lib/markdown.ts` + 更新 `hello-world.md` + 改 PostList + 改 PostDetail + CSS
2. **归档页** — 新建 ArchivePage + 改 App.tsx + CSS + 入口链接
3. **RSS** — 新建脚本 + 改 package.json

---

## 不做的

- ❌ 不用 `react-router`（项目约定）
- ❌ 标签不单独建路由页面（过滤在 PostList 内部完成）
- ❌ 不做分页（文章数量少）
- ❌ 不新增 npm 依赖（保持轻量）
- ❌ 不改 `.claude/` 目录
- ❌ 不改 `eslint.config.js`

---

## 验收标准

### 标签
- [ ] `hello-world.md` 包含标签元数据
- [ ] PostList 显示标签云，可点击过滤
- [ ] 过滤后只显示包含该标签的文章
- [ ] PostDetail 在日期旁显示标签
- [ ] 标签样式有亮色/暗色两套

### 归档
- [ ] 导航栏可切换到 Archive 页面
- [ ] Archive 按年份分组，日期降序排列
- [ ] 点击文章标题跳转到详情
- [ ] 样式与 Blog 整体风格一致

### RSS
- [ ] `npm run build` 后在 `dist/` 生成 `rss.xml`
- [ ] RSS XML 格式有效（标准 RSS 2.0）
- [ ] 包含所有文章的条目

### 通用
- [ ] TypeScript 编译零错误
- [ ] ESLint 零错误
- [ ] Vite build 成功
- [ ] 暗色模式全覆盖
