# Claude Code ↔ Codex 协同工作指南

## 模式概览

两种工具可以在同一个仓库中并行工作，互相审查，共享编码规范。

---

## 模式 3：分支隔离（Git Worktrees）

### 为什么用 Worktree

- 每个工具有自己独立的工作目录和分支
- 不会相互踩脚（文件锁、node_modules 冲突等）
- `git worktree` 共享同一个 `.git`，不需要 clone 两次
- 切换成本低，删掉 worktree 即可清理

### 初始化（首次）

```bash
# 在项目根目录执行

# 1. 确保在主分支且干净
git checkout master
git pull

# 2. 为 Codex 创建 worktree（示例）
git worktree add ../CC-codex -b feat/codex-task
#   ../CC-codex  → 新目录（在 CC 旁边）
#   -b feat/xxx  → 新分支

# 3. Codex 在 ../CC-codex 目录工作
cd ../CC-codex
npm install  # 每个 worktree 需要独立安装依赖

# 4. Claude Code 在原目录继续工作
cd ../CC
```

### 分支命名规范

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/user-auth`, `feat/dashboard` |
| `fix/` | Bug 修复 | `fix/login-error`, `fix/memory-leak` |
| `refactor/` | 重构 | `refactor/api-layer` |
| `chore/` | 杂项 | `chore/update-deps` |

建议加工具后缀区分来源（可选）：
```
feat/user-auth-cc      # Claude Code 做的
feat/user-auth-codex   # Codex 做的
```

### 日常工作流

```bash
# --- 开始新任务 ---

# 1. 拉最新
git fetch origin

# 2. 创建 worktree（在原目录执行）
git worktree add ../CC-<feature-name> -b feat/<feature-name>

# 3. 在新 worktree 中安装依赖
cd ../CC-<feature-name>
npm install

# 4. 开发、提交、推送
git add -A && git commit -m "feat: description"
git push -u origin feat/<feature-name>

# 5. 完成后清理
cd ../CC  # 回到主目录
git worktree remove ../CC-<feature-name>
# 分支还在，只是删了本地副本
```

### 查看当前所有 Worktree

```bash
git worktree list
# 输出示例：
# C:/Users/.../CC          abc1234 [master]
# C:/Users/.../CC-feature  def5678 [feat/some-feature]
```

### 环境检测（用于自动化脚本）

技能/脚本中检测是否已处于 worktree：

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)

if [ "$GIT_DIR" != "$GIT_COMMON" ]; then
  echo "Already in a linked worktree — skip creation"
fi
```

### 注意事项

- 每个 worktree 需要独立 `npm install`
- 不要在多个 worktree 同时修改同一个文件
- worktree 不能和主目录在同一分支（除非用 `--detach`）
- 删除 worktree 用 `git worktree remove`，不要直接 `rm -rf`

---

## 模式 4：共享编码规范

### 规范文件结构

```
CC/
├── CLAUDE.md              ← Claude Code 读取
├── CODEX.md               ← Codex 读取（与 CLAUDE.md 内容同步）
└── .claude/
    └── skills/
        ├── coding-standards/skill.md   ← 跨语言编码规范
        ├── react/skill.md              ← React 高级模式
        ├── typescript/skill.md         ← TypeScript 高级类型
        ├── frontend/skill.md           ← 前端状态管理/表单/路由
        ├── error-handling/skill.md     ← 错误处理策略
        ├── api-design/skill.md         ← API 设计规范
        ├── security/skill.md           ← 安全规范
        └── performance/skill.md        ← 性能优化指南
```

### 如何保持同步

1. **`CODEX.md` 和 `CLAUDE.md`** — 两者内容相同，都是项目级指令。修改任何一个时，同步更新另一个。

2. **Skills 目录** — 两个工具都能读取 `.claude/skills/` 下的 Markdown 文件。这些是"参考库"，不依赖特定工具。

3. **新增规范** — 往 `.claude/skills/` 添加新的 skill.md，然后在两个项目文件中引用。

### Codex 读取 Skills 的方式

Codex 不会自动加载 skills，但你可以：

- **方式 A（推荐）：** 在给 Codex 的 prompt 中引用：
  ```
  "按照 .claude/skills/coding-standards/skill.md 的规范重构这段代码"
  ```

- **方式 B：** 在 Codex 的 `~/.codex/config.toml` 中添加自定义指令，指向项目规范文件。

### 规范覆盖范围

| 场景 | 参考文件 |
|---|---|
| 命名/重构/设计模式 | `coding-standards/skill.md` |
| Hook 设计/Suspense/Error Boundary | `react/skill.md` |
| 泛型/类型收窄/条件类型 | `typescript/skill.md` |
| Zustand/TanStack Query/表单 | `frontend/skill.md` |
| 错误建模/重试/日志 | `error-handling/skill.md` |
| REST 设计/分页/版本控制 | `api-design/skill.md` |
| XSS/CSRF/输入验证 | `security/skill.md` |
| 打包优化/懒加载/缓存 | `performance/skill.md` |

---

## 组合使用：完整工作流示例

### 拆分策略（重要）

**永远拆成小 spec，一次只给 Codex 一件事。** 实测：3 合 1 → 8 分钟；拆开每块 ~2 分钟。

```
❌ 一次给完: "做标签 + 归档 + RSS"        → 8 分钟，6+ 文件冲突
✅ 三轮拆分:
  轮1: 标签系统                            → ~2 分钟，改 4 个文件
  轮2: 归档页                              → ~2 分钟，改 2 个文件
  轮3: RSS                                 → ~2 分钟，改 2 个文件
```

### 单轮流水线（正向 — Claude Code 设计，Codex 实现）

```
1. Claude Code 写小块 spec（≤80 行，只描述一个问题）
       │
2. Codex 按 spec 实现（只改 2-4 个文件，一次 push 完成）
       │
3. Claude Code 审查 → 修复 → merge
       │
4. 下一轮
```

### 反向流水线（Codex 设计，Claude Code 实现）

```
1. 你给 Codex 一句话需求："我需要 X 功能"
       │
2. Codex 产出设计方案 + 精简 spec（快，~30 秒）
       │
3. Claude Code 审阅 spec 合理性 → 调整
       │
4. Claude Code 按 spec 实现（快，支持并行）
       │
5. Codex 审查 Claude Code 的实现 → 修复 → merge
```

**什么时候用反向：** Codex 写代码慢但设计快；Claude Code 实现速度更快且有 workflow 并行能力。需要快速出代码时选反向。

| 场景 | 用哪个 |
|---|---|
| 功能明确，需要快速落地 | 反向（Codex 设计，Claude 实现） |
| 需求模糊，需要仔细推敲 | 正向（Claude 写 spec，Codex 实现） |
| 安全/规范敏感 | 正向（Claude spec 更可控）
       │
2. Codex 按 spec 实现（只改 2-4 个文件，一次 push 完成）
       │
3. Claude Code 审查 → 修复 → merge
       │
4. 下一轮
```

### Spec 大小指南

| 指南 | 说明 |
|---|---|
| 每个 spec ≤ 80 行 | 太小拆不动为止 |
| 涉及文件 ≤ 4 个 | 减少交叉冲突 |
| 可一次 git push 完成 | 不跨 commit |
| 完成后立刻 merge | 避免积压

### 验收检查清单

- [ ] `CLAUDE.md` 和 `CODEX.md` 内容同步
- [ ] 两个 worktree 在不同分支上
- [ ] 提交信息遵循 `feat:` / `fix:` / `refactor:` 前缀
- [ ] 代码符合 `coding-standards/skill.md` 规范
- [ ] TypeScript 编译通过
- [ ] Prettier 格式化完成

---

## 跨工具代码审查

这是 Codex 和 Claude Code 协同的核心场景：**Codex 写代码，Claude Code 用共享规范做审查**。

### 为什么这样分工

| 优势 | 说明 |
|---|---|
| 独立视角 | Claude Code 没有写过这些代码 → 不带偏见 |
| 规范驱策 | 审查标准是写死的（skills），不是 Claude Code 临时编的 |
| 可复现 | 下次审查用同样的 skill → 同样的标准 |
| 双向 | Codex 也可以审 Claude Code 的代码，对称的 |

### 审查流程

```
1. Codex 完成实现，推到分支 feat/xxx
       │
2. Claude Code 切换到该分支的 worktree
       │
3. Claude Code 读取三个规范文件作为审查标准
       │
4. /code-review 对 diff 做对照审查
       │
5. 输出审查报告 → Codex 修复 → 再审查
       │
6. 通过后 merge
```

### 实操步骤

**Step 1 — Codex 推送代码：**
```bash
cd ../CC-some-feature
git add -A && git commit -m "feat: user dashboard"
git push -u origin feat/user-dashboard
```

**Step 2 — Claude Code 拿到代码：**
```bash
cd CC  # 主目录
git fetch origin
git worktree add ../CC-review feat/user-dashboard
cd ../CC-review
```

**Step 3 — Claude Code 对照 3 个核心规范做审查：**

给 Claude Code 的 prompt：
```
审查当前分支的 diff。

审查标准（按优先级）：

1. coding-standards/skill.md — 命名、SOLID、设计模式、代码坏味道
   重点查：God Class、Primitive Obsession、Magic Numbers、重复代码
   
2. typescript/skill.md — 类型安全
   重点查：是否用了 any、是否缺少 discriminated union、
   noUncheckedIndexedAccess 兼容性、assertNever 穷尽检查
   
3. react/skill.md — React 模式
   重点查：useEffect 依赖完整性、Context 拆分合理性、
   Error Boundary 覆盖、forwardRef/useImperativeHandle 正确使用

对每个发现：
- 引用具体的规范条目（文件:行号）
- 评估严重度：error（必须修）/ warn（建议修）/ info（可选）
- 如果可能，给出修复建议
```

**Step 4 — 审查产出格式：**
```
## Code Review: feat/user-dashboard

审查依据：coding-standards | typescript | react

### 🔴 Error
| 文件 | 行 | 违反的规范 | 说明 |
|-----|---|----------|------|
| UserList.tsx | 42 | coding-standards:454 | `any` 类型用于模块边界 |

### 🟡 Warning  
| 文件 | 行 | 违反的规范 | 说明 |
|-----|---|----------|------|
| useDashboard.ts | 18 | react:96 | Context 包含高频变化的 state，应该拆分 |

### 🔵 Info
| 文件 | 行 | 规范 | 建议 |
|-----|---|------|------|
| Dashboard.tsx | 30 | react:753 | Suspense 外面建议包 ErrorBoundary |

### 总结
- Error: 1, Warning: 1, Info: 1
- 建议修复 Error 和 Warning 后再 merge
```

### 用 /code-review 命令

Claude Code 内置的 `/code-review` 可以做这个审查。指定审查力度：

```
/code-review high
```

它会产出 diff 级别的审查结果。你也可以指定只审某些维度：
```
/code-review medium --focus=typescript,react
```

### 匹配规范到审查维度

| Claude Code 审查维度 | 对应的 skill 文件 |
|---|---|
| correctness（正确性） | `typescript/skill.md` — 类型安全、null 处理 |
| bugs（潜在 bug） | `coding-standards/skill.md` — 代码坏味道、Side effects |
| simplification（简化） | `coding-standards/skill.md` — Design patterns、重复代码 |
| performance（性能） | `performance/skill.md` — 打包/渲染优化 |
| security（安全） | `security/skill.md` — XSS/注入/敏感数据 |

### 审查后修复循环

```
Claude Code 提审查报告
       ↓
Codex 收到 → 修复 error + warning
       ↓
Codex commit & push fix commits
       ↓
Claude Code 二次审查（只审 fix diff）
       ↓
通过 → merge
```

### 快速审查脚本

在给 Claude Code 的 prompt 里固化这个模式：

> "每次 /code-review 前，先读取 `.claude/skills/coding-standards/skill.md` 的 Red Flags 和 Checklist 段、`typescript/skill.md` 的 Red Flags 段、`react/skill.md` 的 Red Flags 段 —— 用这些作为审查检查表，逐项对照 diff 中的每个文件。"

审查模板保存位置可以是 `docs/review-checklist.md`（从三个 skill 中提取 Red Flags 聚合而成）。

---
## Codex 特有配置

### 启用 Multi-Agent（如需要）

在 `~/.codex/config.toml` 中：

```toml
[features]
multi_agent = true
```

### Codex App 在 Detached HEAD 环境

如果 Codex App 在一个外部管理的 worktree 中遇到 detached HEAD：
- 使用 App 的 "Create branch" 功能命名分支
- 或使用 "Hand off to local" 将工作转移到本地 checkout
- Agent 仍然可以运行测试、stage 文件、输出建议的分支名和 commit 信息
