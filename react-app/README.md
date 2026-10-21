# CC / SignalLab AI 开发指南

React 19、TypeScript 6、Vite 8；Node.js 24。以下命令在 `react-app/` 执行。
Windows 使用 `npm.cmd` / `npx.cmd`，避免 PowerShell 的脚本执行策略影响 npm shim。

## 安装与运行

```bash
npm ci
npm run dev
```

进入 Vite 本地地址的 `#/signallab`。仿真、图表和报告在浏览器本地完成；
助教需显式配置服务端模型。参见 [助教配置](../docs/signallab-ai-tutor.md)
及 [安全审查](../docs/signallab-ai-security-v0.5.md)。

```bash
npm run build
npm start
```

生产服务默认端口 4173，可用 `PORT` 指定；提供静态资源、RSS 和助教 API。
`npm run preview` 只提供静态预览。现有生产服务器监听所有接口，公网使用前先落实认证、代理和预算。

## 验证

```bash
npm test
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Linux CI 安装浏览器时使用 `npx playwright install --with-deps chromium`。
`typecheck` 独立检查 app、Vite 配置、服务端、单元/HTTP 测试和 E2E。
Node 24 test runner 自动发现 `.test-build/tests/*.test.js`；若移除或重命名单元测试，
先清理对应旧编译产物，避免残留测试被再次执行。

Playwright 使用已构建的生产资源和服务器（专用端口 4175，端口占用时失败，不复用已有服务）。
每次 E2E 前先执行 build；修改产品源码后只重跑 E2E 不会自动构建。
E2E 服务清除供应商配置，不读取本地加密密钥；成功/迟到回答为路由替身，缺少配置为真实 503。
桌面 Chromium 与 Pixel 7 模拟视口覆盖实验、Worker、下载和助教。
浏览器只允许测试服务器网络请求，不需要供应商账号或付费调用。

失败时查看 `playwright-report/`、`test-results/` 中的截图、trace 和页面快照：

```bash
npx playwright show-report
```

真实密钥不得放入 fixture、CI secrets 映射或 trace。测试不证明供应商质量或账单准确性。

## BER 基准

```bash
npm run benchmark:ber -- --output benchmark-results.json
```

直接写入 UTF-8 文件，兼容 Windows PowerShell；不指定 `--output` 时向标准输出写 JSON。
每个实现/样本量使用独立进程；两次预热、五次完整八点扫描，三档比特数。
原数组仿真作为参考，逐点深比较全部结果，不一致以非零退出码终止。
计时不包括编译、进程启动和显式 GC；扫描本身触发的 GC 在计时内。
记录扫描前后 heapUsed 差及整个子进程峰值 RSS，后者包括运行时、预热和全部测量。
heapUsed 差不是瞬时峰值，Node 数据不代表所有浏览器的收益。

[结果和逐文件清单](../docs/signallab-v0.5.md)。CI 保存基准、E2E 报告和失败 trace 七天。
无机器相关的耗时阈值；精确结果相等和百万比特堆预算是确定性门槛。

## 算法约束

v0.6 的 16QAM、对比序列、理论 BER 和 EVM 定义见 [v0.6 说明](../docs/signallab-v0.6.md)。
新增实验沿用现有测试和发布命令；`npm run test:e2e` 自动包含新实验回归，`npm run test:pages` 覆盖静态版两个 Worker。

- Eb=1、BPSK 0→+1/1→−1、Gray QPSK 两比特分别控制 I/Q、Es=2。
- Gray 16QAM 每轴 00/01/11/10→−3a/−a/+a/+3a，a=√(2/5)，均匀星座平均 Es=4；每四比特一符号，不自动补位。
- 三调制比较独立使用 64 比特全星座周期与新 Worker；不修改原 BPSK 扫描序列及协议。
- EVM 以实际发送信号为参考，不用硬判决重建；BPSK 仅实轴，不能直接把三种 EVM 当作同一射频标准指标。
- 每轴 AWGN 方差 `1/(2*10^(EbN0Db/10))`，`r >= 0` 判 0。
- Mulberry32、Box–Muller 每轴消费两个随机数；不缓存高斯对、不用 Math.random、不按块重设种子。
- 扫描交替 01，八点 `[-4,-2,0,2,4,6,8,10]`，点种子 `(base+index) >>> 0`。
- 理论 BER、逐点 Wilson、零误码单侧 95% 上限、Worker 协议和取消行为保持兼容。
- 先运行边界、固定采样和参考路径等价测试，再采集性能；统计近似不能代替确定性回归。

## 格式化与提交

保留现有单引号、无分号样式，对修改文件运行：

```bash
node node_modules/prettier/bin/prettier.cjs --single-quote --no-semi --write <files>
```

每个有意义修改通过检查后提交；不手改 node_modules 或 package-lock.json。
[协作约定](../docs/tool-collaboration.md)。不提交用户已有本地配置、密钥或记忆文件。
