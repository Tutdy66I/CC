# SignalLab AI v0.5 工程化交付记录

2026-10-21，Asia/Hong_Kong。基线 `ae8d047`。
[审查和实施计划](signallab-v0.5-plan.md)。仅本地实现、验证和提交，没有部署或调用收费模型。

## 算法兼容与基准

保持 BPSK/QPSK 映射、Eb/Es、AWGN 方差、Mulberry32 状态更新、Box–Muller 调用及判决阈值不变。
扫描将四个 O(N) 数组改为流式计数，每点仍消费同样的随机数，理论值、区间、Worker 协议和用户功能不变。
完整数组仿真仍供波形、QPSK 和基准参考使用，页面和报告版本标记更新为 v0.5。

Node 24.16.0，Windows x64，AMD Ryzen 9 6900HX。独立子进程，每档完整 8 点；预热两次、测量五次。
基础种子 4294967292，覆盖 32 位回绕，全部结果与数组参考深比较一致。

| 每点比特数 | 数组中位耗时 | 流式中位耗时 | 加速比 | 数组峰值 RSS | 流式峰值 RSS |
| ---------- | ------------ | ------------ | ------ | ------------ | ------------ |
| 10,000     | 14.18 ms     | 3.94 ms      | 3.60×  | 59.40 MiB    | 52.83 MiB    |
| 100,000    | 128.73 ms    | 41.38 ms     | 3.11×  | 129.49 MiB   | 53.43 MiB    |
| 1,000,000  | 1323.39 ms   | 424.09 ms    | 3.12×  | 434.96 MiB   | 53.27 MiB    |

百万比特档最大扫描前后 heapUsed 增量：数组约 220.55 MiB、流式约 0.89 MiB。
这是五次差值最大值，不是峰值分配量；GC 会影响数据。RSS 包括运行时和预热，
字段参见 [Node process.resourceUsage](https://nodejs.org/docs/latest-v24.x/api/process.html#processresourceusage)。
不承诺所有浏览器/CPU 相同收益，不作为 CI 硬性耗时门槛。

原始数据：[优化前](signallab-ber-baseline.json)、[优化后](signallab-ber-optimized.json)。
前者 reference/candidate 都是优化前实现；后者在同机分别隔离参考和流式实现。
复现：`npm run benchmark:ber -- --output benchmark-results.json`。

## 验证结果

- 基线 59/59；新增后 `npm test`：71/71（含 HTTP 父测试及五个子测试），0 失败。
- 百万比特的 32 MiB V8 old-space 约束：旧实现内存不足而失败，新实现通过，确认先红后绿。
- 新边界覆盖最小/奇偶样本、种子 0/最大值、理论端点、百万比特上限、种子回绕、超大整数区间、固定的优化前噪声采样及 QPSK/BPSK 逐轴一致性。
- 真实 HTTP 覆盖 UTF-8 超大体、15 秒慢体超时、并发上限、客户端断连传播、频率上限和伪造转发头。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。类型检查覆盖 app、Vite、服务端、单元和 E2E。
- `npm run test:e2e`：14/14，桌面和移动 Chromium 各 7 项。生产资源、真实打包 Worker，八点误码数与数组参考一致并可重复。
- E2E 还覆盖错误输入、无噪声、视口溢出、启动等待时取消 Worker、HTML/Markdown 下载内容、真实 503、助教快照/连续追问/清空/纯文本渲染/取消迟到回答。
- 首跑两处断言已修正：Markdown 时区下划线应按转义形式比较；消息应按实际 article 定位。
- 独立只读审查未发现新增阻断问题；审查者另运行核心实验编译产物测试 28/28 通过。
- 全量 npm audit 有 7 项工具链告警；omit=dev 为 0。未升级既有工具链，见 [安全审查](signallab-ai-security-v0.5.md)。

## 逐文件修改清单

路径相对仓库根目录。

| 文件                                    | 修改                                                          | 验证                         |
| --------------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| `.github/workflows/ci.yml`              | push/PR/手动 CI，只读权限、超时、取消旧运行、七天 artifact    | 本地等价命令；远端未运行     |
| `react-app/package.json`                | typecheck、E2E、基准命令，自动发现 Node 测试，固定 Playwright | npm、TypeScript、E2E         |
| `react-app/package-lock.json`           | npm 自动添加 Playwright 三个包                                | 安装、lock 元数据、E2E       |
| `react-app/.gitignore`                  | 排除缓存、E2E 和当前基准输出                                  | Git 状态                     |
| `react-app/playwright.config.ts`        | 桌面/移动、生产服务、失败证据、不复用服务                     | 14 项 E2E                    |
| `react-app/tsconfig.e2e.json`           | strict 检查配置与测试                                         | typecheck                    |
| `react-app/scripts/e2e-server.mjs`      | 清除供应商配置后启动生产服务                                  | 真实 503、E2E                |
| `react-app/scripts/benchmark-ber.mjs`   | 隔离计量、保留参考、深比较、UTF-8 输出                        | 三档八点一致                 |
| `react-app/src/lib/signallab.ts`        | 抽取共享 AWGN 有状态采样器                                    | 固定采样、BPSK/QPSK 回归     |
| `react-app/src/lib/berSweep.ts`         | 流式计数消除 O(N) 扫描数组                                    | parity、堆预算、基准         |
| `react-app/src/lib/reportExport.ts`     | 报告标记 v0.5                                                 | 单元、下载 E2E               |
| `react-app/src/pages/SignalLab.tsx`     | 页面标记 v0.5                                                 | typecheck、build、E2E        |
| `react-app/tests/signallab.test.ts`     | 固定优化前噪声采样                                            | Node tests                   |
| `react-app/tests/ber-sweep.test.ts`     | 范围/seed/样本/区间边界和内存预算                             | Node tests，内存约束先红后绿 |
| `react-app/tests/qpsk.test.ts`          | QPSK/BPSK 逐轴精确相同                                        | Node tests                   |
| `react-app/tests/ai-tutor-http.test.ts` | HTTP 防护和真实断连回归                                       | Node tests                   |
| `react-app/e2e/signallab.spec.ts`       | 浏览器、Worker、下载、助教回归                                | 桌面/移动 14 项              |
| `README.md`                             | Node 版本、验证命令、CI/文档入口                              | 人工核对                     |
| `react-app/README.md`                   | 替换模板，运行/测试/基准/算法约束指南                         | 命令与实测一致               |
| `docs/signallab-v0.5-plan.md`           | 编码前审查、取舍、验收计划                                    | 逐项核对                     |
| `docs/signallab-v0.5.md`                | 交付报告和文件清单                                            | 与 JSON、测试核对            |
| `docs/signallab-ai-tutor.md`            | 指向最新审查，标明历史验证范围                                | 文档检查                     |
| `docs/signallab-ai-security-v0.5.md`    | 五类接口安全审查、响应内存、分阶段方案                        | 源码和 HTTP 实测             |
| `docs/signallab-ber-baseline.json`      | 优化前原始数据                                                | UTF-8 JSON、parity           |
| `docs/signallab-ber-optimized.json`     | 优化后同机对比                                                | UTF-8 JSON、parity           |
| `docs/signallab-dependency-audit.json`  | 只读审计快照                                                  | npm audit，保留告警          |

## 剩余风险与未验证项

1. GitHub Actions 未推送运行；未修改分支保护或部署。
2. 公网认证、用户/全局费用预算和共享限流尚未实施，需确认模式、身份系统、代理及阈值；当前生产监听所有接口。
3. 上游 JSON 尚无读取字节上限；45 秒自然到期、真实供应商取消计费、代理和多实例压力需进一步验证。
4. 工具链 7 项告警仍需补丁回归，生产依赖审计 0 不能替代工具链更新；审计结果随时间变化。
5. 仅 Chromium；移动为模拟视口。受控 Worker 取消覆盖启动等待场景，未自动化部分点完成后的取消和运行中异常；完整扫描/再扫描为原生 Worker。
6. Node 测量不等于所有浏览器收益；删除/重命名测试时需清理对应旧编译产物。
7. `.mcp.json` 和 `user-memory.local.md` 为开始时已有改动，保留且不纳入提交。
