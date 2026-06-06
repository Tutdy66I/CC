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

假设要做一个新功能"用户仪表盘"：

```
终端 1 (Claude Code):
  cd CC
  # Claude Code 负责架构设计、写 spec
  → "帮我设计用户仪表盘的 spec，放到 docs/dashboard-spec.md"

终端 2 (Codex):
  cd ../CC-dashboard
  # Codex 根据 spec 实现组件
  → "按照 docs/dashboard-spec.md 实现仪表盘组件"

Code Review:
  # 互相审查对方的 PR
  Claude Code: /review # 审查 Codex 的 PR
  Codex:        /review # 审查 Claude Code 的改动
```

### 验收检查清单

- [ ] `CLAUDE.md` 和 `CODEX.md` 内容同步
- [ ] 两个 worktree 在不同分支上
- [ ] 提交信息遵循 `feat:` / `fix:` / `refactor:` 前缀
- [ ] 代码符合 `coding-standards/skill.md` 规范
- [ ] TypeScript 编译通过
- [ ] Prettier 格式化完成

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
