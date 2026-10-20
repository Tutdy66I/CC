# SignalLab AI 实验助教

SignalLab v0.3 在 BPSK、BER 扫描和 QPSK 区域各提供可展开的助教面板：快捷提问、连续追问、发送前预览参数与结果摘要、查看历史提问快照、取消回答、清空会话。

实验算法继续本地计算；仅在用户提问时发送所选实验的摘要和最近对话。对话只在当前页面内存中保留。修改参数后，下一次提问使用新快照，旧提问保留当时快照。离开页面会取消正在进行的请求。

## 配置与运行

### DeepSeek 一键启动（Windows）

在 `react-app` 目录运行 `npm.cmd run dev:deepseek`，在终端隐藏输入 DeepSeek API Key，再打开 Vite 输出的本地地址并进入 `#/signallab`。

启动脚本固定使用 `https://api.deepseek.com`、`deepseek-flash` 和 `AI_THINKING=disabled`（直接回答）。依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/zh-cn/)（2026-10-20 核对）。API Key 可在 [DeepSeek 平台](https://platform.deepseek.com/api_keys)创建。

密钥仅传入本次服务进程内存，不写文件。每次重新启动需再次输入；也可继承已有 `DEEPSEEK_API_KEY`，或在原 `AI_BASE_URL` 为官方 DeepSeek 地址时继承 `AI_API_KEY`。退出后恢复原进程环境。启动命令的执行策略设置仅作用于本次 PowerShell 子进程。

生产运行使用 `npm.cmd run start:deepseek`，脚本会先构建再启动。没有实际密钥前只能验证配置和本地链路，不能确认账号权限、余额及真实回答。

### 手动配置其他兼容服务

需要提供兼容 Chat Completions 的模型服务，支持 `POST /chat/completions`、Bearer 认证及 `choices[0].message.content` 字符串响应。没有预设供应商或默认模型。

在 PowerShell 中，于 `react-app` 目录运行：

```powershell
$env:AI_BASE_URL = 'https://你的模型服务地址/v1'
$env:AI_MODEL = '你的模型名称'
$env:AI_API_KEY = '你的服务密钥'
npm.cmd run dev
```

进入 `#/signallab`，展开对应实验的“AI 实验助教”。BER 助教需先启动扫描，快照包含扫描状态、运行参数、已完成点与区间；取消后的部分结果也可提问。

生产环境在同一组环境变量下运行 `npm.cmd run build`、`npm.cmd start`。环境变量由启动进程继承；此实现不自动加载 `.env` 文件。密钥不得使用 `VITE_` 前缀，也不要写入前端源码或 Git。`npm run preview` 仅预览静态文件，不提供助教 API。

## 行为与限制

- 开发和生产共用 `/api/ai-tutor` 处理器，缺少配置返回 503，界面显示配置提示，没有模拟 AI 降级回答。
- 纯文本渲染模型输出。系统教学约束要求区分实测、理论、推测；不编造未提供的实验结果，解释有限样本、零误码和置信区间限制。
- 单个新问题最多 4000 字，最近最多 5 轮已完成对话；请求超过预算时从最早完整轮次开始移除。历史答案和快照允许更长文本。
- 请求体上限 64,000 字节，读取超时 15 秒，模型请求超时 45 秒。客户端可取消；每进程最多 2 个并发请求、每来源地址每分钟最多 10 次请求，429 返回 `Retry-After: 60`。
- 限流按直接连接地址计算，未配置反向代理可信地址解析。该首版没有登录、用户级配额或跨实例限流；面向公网多人使用时需由部署层提供访问控制与配额。
- AI_BASE_URL 仅来自服务端配置；拒绝重定向，供应商错误正文和密钥不会回传浏览器。

取消与超时使用 Node 原生 fetch / AbortSignal，依据 [Node.js 官方文档](https://nodejs.org/api/globals.html#fetch)。

## 本轮验证

- `npm.cmd test`：51 项通过，其中助教 7 项，包含请求验证、长回答追问、未配置、教学指令与快照传递、上游错误隐藏、预取消，以及真实本地 HTTP 模型替身链路。
- `npm.cmd run build`：前后端 TypeScript 与 Vite 构建通过。
- `npm.cmd run lint`：通过。
- Chromium 开发环境冒烟：真实 503 配置提示；使用浏览器路由替身验证成功回答、连续追问、随机种子 42→43 的新旧快照、清空、取消后忽略迟到回答；390×844 无页面横向溢出。
- QPSK 与已完成 BER 扫描均确认发送对应实验上下文。生产启动检查确认静态页面返回 200，未配置助教接口返回 JSON 503。
- 未配置真实模型凭据，没有验证真实供应商响应质量、费用、兼容性。尚未覆盖全部浏览器与辅助技术，以及 HTTP 层传输中取消、超大请求和并发限流的集成测试。

设计：[实验助教设计](superpowers/specs/2026-10-20-ai-tutor-design.md)。
