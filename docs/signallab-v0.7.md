# SignalLab AI v0.7：多种子验证与异常恢复

2026-10-21，基线 `d32fe50`；[先行计划](signallab-v0.7-plan.md)。
本轮范围为多种子统计、Worker 异常恢复测试、跨浏览器回归与兼容依赖修复。
实现先在本地验收，推送和 Pages 发布单独确认。原 BPSK/QPSK/16QAM 数学定义、Mulberry32、Box–Muller 和既有单次扫描种子协议保持不变。

## 多种子统计

新增独立统计区和 Worker，复用 v0.6 `simulateComparisonPoint`。
界面每次可选 16,384 / 65,536 / 131,072 比特、重复 5 / 10 / 20 次，扫描 −4 到 14 dB、步长 2 dB，三调制共 30 行。
核心允许完整 64 比特周期、5 至 20 次整数重复，整个运行最多 80,000,000 比特；越界请求直接报错，不静默降低样本量。
每次使用原来的 64 位全星座周期。第 j 次、第 i 个 SNR 的种子为：

`(base + j * 10 + i) >>> 0`，i/j 从 0 起。

最多 200 个不同的 SNR/重复组合种子，跨 uint32 边界仍不重复。三调制在同一组合共用种子；
BPSK/QPSK 共用逐位噪声，因此 BER 完全重合，不是独立重复证据。不同重复使用不同种子，但确定性 PRNG 不构成独立性证明。

各行只聚合已经完成的试验，显示总误码数、平均 BER、最小/最大 BER、样本标准差和理论 BER。
每次长度相同，均值精确等于总误码数/总比特数。标准差以 n−1 为分母，使用 Welford 累积，只有一次时显示空值；
它描述跨种子离散程度，不是均值置信区间。图中竖线表示极差，线性纵轴保留实测零。

以完整 64 比特周期的误码比例 Y∈[0,1] 为一个有界块，在不同块理想噪声独立的模型下：

`N = 总比特数 / 64`，`radius = sqrt(ln(40)/(2*N))`。

显示 `[max(0, mean-radius), min(1, mean+radius)]`，由双侧 Hoeffding 界得到逐点至少 95% 保守区间。
同一符号内比特可相关；不使用逐比特独立的 Wilson 公式。确定性 PRNG 对理想独立噪声的模拟仅为模型近似。
仅当某行完成事先规定的全部重复次数时显示区间，未完成行显示“等待完整重复次数”。
提前取消不对未完成行作固定样本置信声明；已完成行的区间仍按事先固定样本量计算。
这不是 30 行的同时置信带，也不是序贯检验；零误码仍有正上界，低 BER 时区间较宽。
数学依据：[Hoeffding 1963](https://www.tandfonline.com/doi/abs/10.1080/01621459.1963.10500830)。

Worker 每完成一个调制试验发送一条聚合结果，保存最多三个各 20 项的标量组；不保留逐比特或逐符号数组。
界面最多 30 行。取消/卸载终止 Worker，实例检查拒绝旧回调覆盖新运行；出错保留实际完成结果，重试清空后开始新运行。
CSV 包含运行状态、实际 run 参数、种子公式、已完成次数、误码/均值/极差/标准差、理论 BER 与可用区间。
编辑下一次控件不改写上一次 run 的导出数据。CSV 为 UTF-8 BOM、引号转义、CRLF；空区间保持为空。
统计区本轮独立导出 CSV，不扩展原 HTML/Markdown 报告或 AI 助教上下文协议；旧实验原有功能均保留。

## 依赖更新

审计基线为 7 项告警（6 high、1 moderate），均有声明范围内修复。
先执行 dry-run，再运行无 `--force` 的 `npm audit fix`，由 npm 更新锁文件；根 `package.json` 版本声明未变。
随后执行 `npm ci` 并直接核对实际安装的包版本，避免仅依据锁文件或审计输出作结论。

| 包                       | 原版本  | 修复后  |
| ------------------------ | ------- | ------- |
| vite                     | 8.0.16  | 8.3.5   |
| postcss                  | 8.5.15  | 8.5.31  |
| nanoid                   | 3.3.12  | 3.3.20  |
| browserslist             | 4.28.2  | 4.29.4  |
| baseline-browser-mapping | 2.10.33 | 2.11.30 |
| brace-expansion          | 5.0.6   | 5.0.12  |
| source-map-js            | 1.2.1   | 1.2.2   |

全部及仅生产依赖审计均为 0 告警，见 [当日审计记录](signallab-v0.7-dependency-audit.json)。
审计数据库会变化，此结果不是未来安全保证。[npm 官方流程](https://docs.npmjs.com/cli/v11/commands/npm-audit/)。
Vite 8.3.5 构建有未来 native config loader 的扩展名兼容提醒；当前默认构建成功，本轮未迁移 loader。

## 验证与文件清单

核心测试包含种子回绕/唯一性、工作量拒绝、手算均值/标准差、零/全误码边界、样本增加后区间收窄、
部分结果不显示区间、样本参数一致性、完整驱动可复现与原逐次仿真精确一致。

异常 E2E 对三类 Worker 分别检查：首个真实结果后的取消与保留、回放实际迟到消息、替换 Worker 后拒绝旧回调、
模块直接抛错、真实计算发送第二条结果时抛错及原 catch 的错误协议、失败后恢复。
测试控制投递或故障，不伪造数值结果；统计部分 CSV 还验证未完成行没有区间。
跨浏览器包含桌面 Chromium、Pixel 7 模拟移动视口、Firefox、WebKit。
Pages 单独覆盖 `/CC/` 子路径、三个 Worker、下载、静态后端提示及不发出模型调用。

独立审查先检查统计定义、预算、Worker 生命周期和 CSV；核心 6 项测试由审查者独立运行通过。
浏览器审查指出相同参数重启只检查完成状态可能漏掉旧消息污染，现已改为新种子重启、暂缓全部新消息、
回放旧回调后要求运行中且零行，再放行新消息并精确检查新种子的误码数。复审确认问题已解决。
WebKit 首轮三项错误后重试失败，根因是故障注入响应继承生产资源的 immutable 缓存头，导致重试复用注入脚本；
只为测试替身增加 `Cache-Control: no-store` 后九项 WebKit Worker 回归通过，产品缓存策略不变。

既有流式 BER 实现的基准回归复测使用 Node 24.16.0；各档八点扫描预热两次、测量五次，原数组路径作为参考。
全部返回字段逐点深比较相等，见 [原始基准](signallab-v0.7-ber-benchmark.json)。

| 每点比特数 | 原数组中位 ms | 流式中位 ms | 倍速 |
| ---------- | ------------- | ----------- | ---- |
| 10,000     | 14.30         | 3.91        | 3.66 |
| 100,000    | 133.22        | 43.06       | 3.09 |
| 1,000,000  | 1349.81       | 434.32      | 3.11 |

百万档流式测量的最大扫描前后 heapUsed 增量约 0.74 MiB，进程峰值 RSS 约 53.51 MiB；
前者不是瞬时堆峰值，后者含运行时/预热，速度依机器而变。原有 32 MiB old-space 预算测试继续通过。
源文件对比确认旧调制内核、EVM、比较内核和两个旧 Worker 均未改动。

最终本地验收：

- `npm test`：**92/92** 单元与 HTTP 测试通过。
- `npm run test:e2e`：**92/92**，四配置各 23 项，最终完整运行 1.9 分钟。
- Pages 环境构建后 `npm run test:pages`：**10/10**，桌面/模拟移动各 5 项。
- `npm run lint`、五组 TypeScript 检查、普通与静态生产构建、全部修改文件 Prettier 检查、`git diff --check` 通过。
- `npm run benchmark:ber`：三档精确 parity 通过，记录见上表。
- 全部依赖及 `--omit=dev` 审计均为 **0** 告警；只读代码审查的测试盲点已修复并复审。

运行命令在 `react-app/`，Windows 使用 `npm.cmd` / `npx.cmd`。Pages 本地验收构建设置
`DEPLOY_BASE_PATH=/CC/`、`VITE_STATIC_HOST=true`、`SITE_DOMAIN=tutdy66i.github.io/CC`。
本轮不触发远程 Actions，不推送或部署；上述结果全部是本地新安装依赖后的验收。

| 文件（相对仓库根）                               | 修改用途                                            |
| ------------------------------------------------ | --------------------------------------------------- |
| `react-app/src/lib/seedStatistics.ts`            | 统计请求、种子派生、聚合、固定样本区间和驱动        |
| `react-app/src/workers/seedStatistics.worker.ts` | 独立统计 Worker、错误协议                           |
| `react-app/src/components/SeedStatistics.tsx`    | 控件、进度、取消恢复、曲线/表格、CSV                |
| `react-app/src/components/SeedStatistics.css`    | 独立区块布局                                        |
| `react-app/src/pages/SignalLab.tsx`              | v0.7 标记与统计区入口                               |
| `react-app/tests/seed-statistics.test.ts`        | 6 项统计核心测试                                    |
| `react-app/e2e/statistics.spec.ts`               | 真实统计 Worker、复现、种子边界、快照导出与输入验证 |
| `react-app/e2e/worker-recovery.spec.ts`          | 三 Worker 各三项异常/恢复回归                       |
| `react-app/e2e-pages/pages.spec.ts`              | Pages 子路径统计 Worker 冒烟                        |
| `react-app/playwright.config.ts`                 | Firefox/WebKit 项目                                 |
| `.github/workflows/ci.yml`                       | 安装三种引擎并执行完整回归                          |
| `react-app/package-lock.json`                    | npm 生成的兼容安全更新                              |
| `README.md`                                      | 功能入口、导出类型和浏览器范围                      |
| `react-app/README.md`                            | 安装、审计、浏览器命令与统计文档                    |
| `docs/github-pages.md`                           | 十项静态版测试说明                                  |
| `docs/signallab-v0.7-plan.md`                    | 先行实施计划                                        |
| `docs/signallab-v0.7-dependency-audit.json`      | 当日全部/生产依赖审计                               |
| `docs/signallab-v0.7-ber-benchmark.json`         | 修复环境下原 BER 基准与精确 parity                  |
| `docs/signallab-v0.7.md`                         | 数学、文件、验证和剩余限制                          |

## 剩余限制

- 只模拟 AWGN、理想同步与硬判决；不代表硬件、射频标准或真实链路验证。
- 多种子均值和离散程度不保证每次单调；保守区间对稀有误码较宽，未提供序贯/同时覆盖率。
- 桌面三引擎及模拟手机不等于真实 Safari/iPhone/Android 设备的全面验收。
- 公网 AI 助教认证、总预算和上游响应字节限制仍是 v0.5 待落实方案；本轮未改认证、未访问密钥、未调用付费模型。
- 本地验证不能替代尚未执行的远程 GitHub Actions；未确认前不发布 v0.7。
- 用户原有 `.mcp.json` 与 `user-memory.local.md` 不纳入提交。
