# SignalLab：可选账号与实验同步

2026-10-23 批准的首期范围：GitHub OAuth、当前 `/CC/` Pages 地址、
GuidedExperiment 完成快照同步、游客手动导入、账号缓存和待上传队列。
Pages AI 继续禁用；Node AI 服务、DSP、种子日程与 Workers 保持原有行为。

## 交付与启用边界

本地实现可在没有 Supabase 项目的情况下验证。迁移文件的存在不代表远端已经
执行；合成浏览器测试也不证明真实 GitHub OAuth、SMTP、JWT 或 Data API 配置正确。
现已连接用户确认的已有 `quant-lab` 项目（`nxyryfuusponcwqptlic`），并经批准执行
`20261023082758_signallab_experiment_records` 远端迁移。迁移前 public 无表、
迁移历史为空；迁移后 RLS、列授权、触发器及安全顾问检查通过。
本地迁移文件版本已与远端迁移历史对齐，避免后续重复执行相同建表 SQL。
GitHub OAuth App、正式 Site URL 和精确回跳已配置；公众注册关闭，测试用户已预建。
真实 GitHub 登录和一次 Worker 结果上传已在本地验收地址通过；另一个独立 origin
（127.0.0.1 与 localhost，存储不共享）登录同账号后，恢复了同一记录 ID 和测量结果。
远端 PostgreSQL 角色及模拟 JWT claims 的事务测试验证本人读写、跨用户读写隔离、
匿名拒绝、快照列保护和修订号递增，测试记录全部回滚；此项不替代双账号 JWT 验收。
正式 Pages 已发布；独立设备及两个真实账号的 Data API 越权验收仍需另行完成。

云功能默认关闭。启用前需要核对目标项目 ID、现有表和授权、备份及迁移历史，
确认注册范围、容量配额和保留期。首期建议限制为已批准的测试账号。
不要自行开放公众注册或启用收费 AI。

## 架构和依赖

- 浏览器使用锁定版本的 `@supabase/supabase-js`，没有 ORM、SSR、Realtime 或新状态库。
- `supabaseClient.ts` 只接受 HTTPS 项目 URL 和 publishable key；配置无效时回到本地模式。
- `ExperimentHistory` 管理生命周期、身份切换、重试与 UI 状态。
- `experimentStore.ts` 用 IndexedDB 保存账号记录与 pending 状态，同一事务提交；
  不受游客五条显示规则影响。数据库按 Supabase URL 和部署 base 分区，行按 user ID 分区。
- `experimentCloud.ts` 只用当前用户 JWT 调用 Data API，不需要 secret/service_role。
- `experimentSync.ts` 校验单条完整记录、规范化比较 JSONB，并决定冲突；
  游客的 `signallab-guided-v1` 仍由现有五条恢复规则读取。
- `@electric-sql/pglite` 与 `fake-indexeddb` 仅用于测试，不进入浏览器应用。

## 数据与权限

`supabase/migrations/20261023082758_signallab_experiment_records.sql` 创建一张
`public.experiment_records`：复合主键 `(user_id,id)`、类型、模板、格式/算法版本、
参数、测量结果、独立分析、客户端完成时间、服务端审计时间、修订号和墓碑。
用户删除时按外键级联清理自己的记录。

新结果标记算法版本 `guided-awgn-v1`；旧历史无法证明算法版本，标记 `legacy-unknown`。
快照保留原始 JSONB 数值、逐次种子、计数和区间，不转换为显示用舍入值。
完成时间来自客户端；上传和修改时间来自数据库，不能据此宣称实验在服务端执行。

SQL 检查模板、计划白名单、种子、递增 SNR、JSON 类型和 128 KiB 载荷上限。
客户端继续检查结果的领域一致性；二者都不能证明用户没有伪造自己的数据。

RLS 与列授权共同生效：

| 操作              | 权限                                                     |
| ----------------- | -------------------------------------------------------- |
| anon / 无用户 JWT | 无表权限，不使用 Supabase 匿名登录                       |
| SELECT            | authenticated 且 `auth.uid()=user_id`，包括本人的墓碑    |
| INSERT            | 仅自己的记录；审计字段、修订号和删除状态不能由客户端插入 |
| UPDATE            | 仅本人的未删除记录，列权限只开放 analysis 和 deleted_at  |
| DELETE / TRUNCATE | 不授予权限，没有 DELETE policy                           |

非暴露 schema 中的 SECURITY INVOKER 触发器保护不可变列、递增 revision、
设置服务端时间并防止墓碑恢复。新增私有 SECURITY DEFINER 触发器仅维护配额计数；
不提供可调用的业务 RPC 或视图，撤销 public/anon/authenticated 的 schema、表及函数权限，
固定空 search_path 并核对 auth.uid() 所有者。原有记录 RLS 和列授权不变。
表显式授权给 authenticated；还应核对项目当前 Data API 暴露设置。
RLS 不能约束管理员或 BYPASSRLS 密钥，因此绝不向浏览器提供这些凭据。

## 同步和恢复

1. 游客实验先按现有方式保存在当前浏览器最近五次列表，离线不要求账号。
2. 登录后切换到独立账号缓存，只有完整 Worker done 才产生新记录。
3. “将游客历史导入此账号”是明确的归属确认；无效项提示跳过，旧数据不删除。
   重复导入不覆盖云端分析或删除状态。
4. 登录实验先写入 IndexedDB，再上传。队列不按五条截断；缓存写失败时保留本页结果并提示导出。
5. 插入使用稳定 ID，重复键后读取比较，禁止覆盖式 upsert。
6. 分析更新以 user_id、id、revision、未删除条件执行 CAS；零行不能算成功。
   并发冲突同时保留两份分析，用户选择后按最新 revision 重试。
   同 ID 不同快照只能导出本地数据后采用云端，不能覆盖测量值。
7. 删除写墓碑；旧设备的更新会读取并接受墓碑。首期不清除墓碑，避免离线复活。
8. 登录、进入实验、恢复前台、网络恢复、手动刷新时分页全量对账，按 ID keyset 翻页；
   不依赖客户端时钟，也不假设一次翻页是事务一致快照，后续对账可补齐并发变更。
9. 401/权限错误暂停；网络、429、临时 5xx 退避重试并遵循可读取的 Retry-After。
   跨域必须暴露该响应头；429 响应头不可读时至少等待一分钟。
   退出或换号取消请求；生命周期检查阻止旧回调写入当前用户 UI。
10. 本机缓存不是安全审计记录。退出会隐藏账号缓存并停止发送，pending 数据留在
    该账号分区供以后恢复；拥有本机浏览器访问权的人仍可能读取这些本地数据。

每账号最多 1,000 条记录（包括墓碑），参数、结果与分析的数据库文本载荷合计 20 MiB。
原有单条 128 KiB 和分析 12,000 字符上限保留。私有 experiment_usage 计数器由同一事务的
AFTER 触发器原子更新，账号计数行串行化并发写入；约束或事务失败同时回滚计数。
墓碑不释放条数额度。超限仍可读取、导出、缩短分析及软删除；禁止新增和增加载荷。
超限返回 P0001 / SIGNALLAB_QUOTA_EXCEEDED，前端保留 IndexedDB 队列、暂停自动上传；
对账读取继续，处理额度后使用“刷新云端记录”明确重试。重新加载页面会重新尝试一次。
额度是业务载荷，不能等同于包含索引、Auth、WAL 等开销的套餐物理容量；没有全库硬上限。

活跃记录的服务端 created_at 超过 365 天只进入 `supabase/retention-preview.sql` 预览，
不自动隐藏或删除。墓碑无限期保留。本地备份超过 30 天只提示待归档，不自动清理。
公众注册继续关闭；双真实账号和第二台实体设备测试按用户决定暂缓，不能标记为通过。

## 加密应用备份与恢复

备份位于被 `*.local` 忽略的 `react-app/backups.local/`，使用 Windows CurrentUser DPAPI。
只读导出 experiment_records（含墓碑、完整审计字段），并附带 Git 提交及已应用迁移源文件。
不导出 Auth 表、邮箱、密码、会话、JWT、OAuth secret 或密钥；这是应用备份而非整库备份。
同机同 Windows 身份可解密；电脑或用户身份丢失时无法保证恢复，不属于异地灾难备份。

每日香港时间 20:00 由本会话 heartbeat 执行。依赖本机、Codex 和 Supabase 插件连接；
成功静默，失败或需要处理时通知，使用 Codex 额度，不调用应用模型接口。
本地加密文件不进入 Git、公开 CI artifacts 或聊天正文。

导出协议（通过 Supabase 插件执行 SELECT，不能用浏览器 JWT 或新增 service_role 凭据）：

1. 确认目标项目及已应用迁移，本地对应 SQL 必须存在。记录 `git rev-parse HEAD`。
2. 执行 `supabase/backup-manifest.sql`，取得 count/digest。
3. 逐行、逐段执行 `supabase/backup-row.sql`，仅将占位符换成非负整数。
   每段最多 2,000 字符；校验每行字符数及 SHA-256，按 UTF-8/C 顺序重组原始 row JSON 文本。
   导出上限 100,000 行或 200 MiB，超过即失败并通知，不能悄悄截断。
4. 再读 manifest 和 migration list；前后及本地重组摘要必须相同。变化时重试整个导出，
   最多两次，仍变化则失败保留上一份。仅备份对应已应用迁移源文件。
5. 将 NDJSON 消息送入 `node scripts/signallab-backup.mjs create` 的 stdin：
   start 含 project、commit、manifest、migrations 文件名数组；每个 row 含原始 JSON 字符串 value；
   最后一条 finish 含重新读取的 manifest。不要打印记录或将明文写入文件。
6. 工具不支持持久 stdin 时，可将完整 NDJSON 的 UTF-8 字节按不超过 6,000 字节切块，
   每块 base64 作为 `node scripts/signallab-backup.mjs chunk <随机UUID> <从0递增序号> <base64>` 参数，
   工具立即 DPAPI 加密到 staging.local，然后 `node scripts/signallab-backup.mjs seal <UUID>`。
   仅在内存重组明文，摘要/恢复验证完成后原子发布 `.slbackup`；失败不覆盖上一份。
   不输出 base64 载荷。加密 staging 不自动删除，计入 30 天归档预览。
7. 验证已有快照：`node scripts/signallab-backup.mjs verify <绝对路径.slbackup>`。
   只打印记录数、核对列数及 authRestored=false。

工具解密并校验 SHA-256，在全新的内存 PGlite 加载快照附带的可信迁移，暂时禁用本地记录触发器，
逐列恢复和比对 14 个字段（包括微秒时间戳、所有者、修订号、墓碑），随后关闭临时数据库。
Auth 占位用户仅用于临时外键验证，不是 OAuth 身份恢复；工具没有生产连接或回灌功能。
私有配额计数是可重建的派生数据，生产恢复时必须在写锁下重新统计，不从快照直接信任计数。

## GitHub OAuth 和 Pages 配置

前端环境变量（全部公开）：

```text
VITE_EXPERIMENT_SYNC=true
VITE_SUPABASE_URL=https://<existing-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Pages CI 对应 repository variables：`SIGNALLAB_EXPERIMENT_SYNC`、`SUPABASE_URL`、
`SUPABASE_PUBLISHABLE_KEY`。未配置开关时构建保持本地模式。
不得把 Supabase secret、`service_role`、模型密钥或用户 access/refresh token 放进 `VITE_*`。
构建会在产物生成前拒绝非 publishable key，错误消息不回显配置值。
生产发布前按独立开关流程启用，配置变化需要重新构建。

Supabase Auth Site URL 和 redirect allowlist 需包含精确的
`https://tutdy66i.github.io/CC/`；开发环境按实际地址另外加入，不使用生产通配符。
GitHub OAuth App 的 authorization callback URL 则使用 Supabase Dashboard 提供的
Auth callback 地址，不能误填成 Pages 地址。GitHub client secret 只交给 Supabase Auth。

前端走 PKCE，回到存在的 `/CC/?code=...`，只交换一次授权码，清理 URL 后恢复
`#/signallab`；不需要 Pages 的 `/auth/callback` 服务端路由。
不要在同一浏览器同时发起多个登录流程；verifier 位于发起浏览器，不能跨设备交换授权码。
跨设备同步指在另一设备独立登录同一账号，再读取其记录。

同一个 `tutdy66i.github.io` 下的项目共享 origin，路径和缓存键前缀不能形成安全隔离。
当前按用户选择保留 Pages 地址，后续独立域名可以改善隔离。

## AI 仍是独立上线事项

审计修复已给 Node AI 增加默认鉴权、允许账号及保守预算保护，配置与部署限制见
[AI安全启用](signallab-ai-security.md)。未启用跨域 API 或部署公网 AI。
Pages 的 AI 建议与分析继续禁用，不会因为登录成功自动开放。
公网 AI 上线前需验收 JWT 与允许账号、会话撤销策略、精确 CORS、用户/IP 限流、
预算持久存储及其部署边界，并配置供应商硬预算、核对保守费用预留与真实账单。
不能把 Supabase 登录、Origin 检查或 max_tokens 当作这些保护的替代。

## 验证与回滚

在 react-app 运行：

```text
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:cloud
npm.cmd run benchmark:ber
```

原有 Pages 回归仍需使用 `DEPLOY_BASE_PATH=/CC/`、`VITE_STATIC_HOST=true` 构建后
运行 `npm.cmd run test:pages`。
云回归单独构建 `dist-cloud`，禁用 env 文件加载，仅用合成公开配置；
所有非本地网络请求均拦截，真实 Worker 产生结果，不登录 GitHub、不访问真实项目或收费模型。
测试覆盖游客导入、六次离线实验、丢失响应、第二浏览器恢复、分析冲突、软删除、账号切换和 PKCE 回跳。
PGlite 测试实际 PostgreSQL 策略和触发器，仅 Auth 用户及 JWT 上下文为替身，
不证明真实 Supabase JWT 验证或 PostgREST 配置正确。

连接项目后，先核对目标项目、现有表结构和备份，再按已批准范围执行远端迁移；
没有自动 db push。真实双账号 Data API 验收已按用户要求暂缓；现有 PGlite 和合成浏览器隔离测试
不能代替真实双账号验收。正常/失效 OAuth 回跳另在正式 `/CC/` 地址验证。

回滚先关闭 `SIGNALLAB_EXPERIMENT_SYNC` 并重新发布，或回退应用提交。
保留数据库、RLS、IndexedDB 和游客历史；不得删除表、放宽权限或清空 outbox。
远端数据清理或变更迁移需单独评审，不在回滚时自动执行。
仅回滚新配额可人工执行 `supabase/rollback-experiment-quotas.sql`，保留原有 RLS 和全部记录。
重新启用配额必须先在写锁下重算计数，不能复用停用期间失去更新的计数器。
