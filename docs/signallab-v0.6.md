# SignalLab AI v0.6：16QAM、BER 对比与 EVM

2026-10-21，基线 9574d3c。[实施计划](signallab-v0.6-plan.md)。
在既有 SignalLab 页面底部增加 16QAM 与三调制对比，保留原 BPSK、QPSK 和 BPSK 置信区间扫描。
本轮已完成本地实现和验收，尚未推送或更新线上站点。推送 master 会自动部署；自动审批要求先取得 v0.6 明确发布确认。

## 16QAM 定义

四位输入的前两位控制 I，后两位控制 Q。每轴 Gray 映射：

| 两位 | 电平 |
| ---- | ---- |
| 00   | −3a  |
| 01   | −a   |
| 11   | +a   |
| 10   | +3a  |

`a=√(2/5)`；均匀星座的平均 Es=4、Eb=1，与旧模型的标称 Eb 一致。
每轴平均未缩放能量为 5，两轴共 10，乘 a² 后为 4。
**短输入若星座分布不均匀，实际能量不同，不重新缩放；Eb/N0 始终相对于均匀星座的标称 Eb=1。**
空输入、非二进制及长度不是 4 的倍数时报错，不自动补位；手动输入上限 10,000 比特。

每轴噪声方差仍是 `1/(2×10^(Eb/N0[dB]/10))`，复符号依次消费 I、Q 两次 Gaussian 采样。
沿用现有 Mulberry32/Box–Muller 算法和无符号 32 位种子约定，不改 BPSK/QPSK 的数学实现或返回结构。
判决边界为 −2a、0、2a，恰好相等归上侧区间。图表最多显示前 500 符号，统计使用完整输入。

均匀 Gray 星座、相干硬判决、理想同步与 AWGN 条件下：

`BER16QAM = 3/4 Q(d) + 1/2 Q(3d) − 1/4 Q(5d)`，`d=√(0.8×10^(Eb/N0[dB]/10))`。

此式由每轴 Gray 4-PAM 的误判区间乘相应 Hamming 距离再取平均得到，包含远邻误判项。
高 SNR 最近邻近似只有 `3/4 Q(d)`，低 SNR 下不能当作精确理论。Q 使用数值 erfc 近似。
测试以独立 Python `math.erfc` 结果验证 −10、−4、0、4、8、10、15 dB，要求相对误差小于 1e−6；
如 0 dB 为 0.14098163506684164、10 dB 为 0.00175415061789273。

理论适用条件参考 [MathWorks analytical BER](https://www.mathworks.com/help/comm/ug/analytical-expressions-used-in-berawgn-function-and-bit-error-rate-analysis-app.html)。
不将无噪声或不均匀短序列的实测 BER 当作均匀 AWGN 理论的验证。

## 参考辅助 EVM

`RMS EVM = √(Σ|r−s|²/Σ|s|²)`；百分比为该值乘 100，dB 为 `20 log10(RMS EVM)`。
使用实际发送信号 s 与接收信号 r，全输入、实际参考功率归一化；不将判决后的星座点用作参考。
无噪声 EVM 严格为 0；其 dB 为 −∞，JSON 用 null 表示这一情形，避免 Infinity/NaN 进入快照。
不作增益、相位、频偏、定时或均衡补偿，允许 EVM 超过 100%。
拒绝空/长度不等、非有限、零参考能量及无法计算的输入。
定义参见 [MathWorks comm.EVM](https://www.mathworks.com/help/comm/ref/comm.evm-system-object.html) 的 Average reference signal power。

BPSK 保持原有单实轴匹配滤波模型，因此其 EVM 仅含实轴误差，不能视为同一 RF 标准下的二维 EVM。
对于本项目均匀序列与 0 dB，BPSK/QPSK 的 RMS EVM 期望尺度约为 √(1/2)，16QAM 约为 1/2。
16QAM 的 Es 更高，归一化 EVM 较小不意味着 BER 较小；不能仅凭 EVM 排名调制方案或反推真实 BER。
这里不声明任何无线标准符合性，也不模拟功放非线性或同步误差。

## 三调制对比

独立 Worker 扫描 −4 到 14 dB、步长 2 dB，每个 SNR 计算三种调制，共 30 点。
选择 16,384、131,072 或 1,000,000 比特；都是 64 的倍数且不超过原百万比特预算。
64 位周期依次发送四位字 0000 到 1111，精确覆盖均匀 16QAM 星座，同时让 BPSK/QPSK 也均匀。
这样避免交替 01 序列只落在少数 16QAM 电平而导致理论对比偏差。

第 i 个 SNR 的种子为 `(base+i) >>> 0`，三种调制共用同一点种子。
BPSK/QPSK 沿用逐位噪声，共用随机数使实测 BER **完全重合**，不是两次独立试验。
16QAM 每符号只用两次噪声采样。相同比特数不等于相同符号数或实际带宽；各调制每符号为 1/2/4 比特，标称 Es 为 1/2/4。

流式比较只累加误码、参考能量与误差能量，不保留 O(N) 数组。测试与各完整数组仿真逐点精确比较误码数，EVM 比较使用浮点容差；
百万比特三种调制均可在 32 MiB V8 old-space 预算中完成。
旧 BPSK Worker、逐点区间、百万比特性能基准及取消行为保持原样。

比较支持后台进度、取消、重跑、种子回绕，取消保留已完成点；终止及实例检查避免旧 Worker 消息更新新扫描。
理论与实测分线；零误码用底部叉号，不将 0 送入对数轴，也不把叉号宣称为置信上限。
16QAM 同符号内错误可能相关，本轮比较不提供置信区间，不能照搬旧 BPSK 的逐比特 Wilson 区间。

## 报告与助教

16QAM 和比较区均有独立 HTML/Markdown 导出，包含图表、实际运行参数、实测/理论 BER、参考辅助 EVM、采样或完成点表。
部分比较仅导出已完成点，标明完成数；正在编辑的下一次参数不会替换本次 run。
报告保留旧格式的转义、CSP、时区和可选已完成问答。
助教新增 16QAM/COMPARISON 类型、EVM 归一化、相关误码及共用随机数说明；认证、限流、超时、请求预算和密钥行为不变。
GitHub Pages 仍是静态版，不调用收费模型；新增两类本地实验无需后端。

## 文件与验收

| 文件（相对仓库根）                                                                | 用途                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------- |
| `react-app/src/lib/qam16.ts`                                                      | Gray 映射/判决、完整仿真、理论 BER       |
| `react-app/src/lib/evm.ts`                                                        | 参考辅助 RMS EVM 与输入验证              |
| `react-app/src/lib/modulationComparison.ts`                                       | 均衡输入、流式 BER/EVM、预算验证         |
| `react-app/src/workers/modulationComparison.worker.ts`                            | 独立三调制 Worker 与逐点协议             |
| `react-app/src/components/QamExperiment.tsx` / `.css`                             | 16QAM 控件、星座、采样表与快照           |
| `react-app/src/components/ModulationComparison.tsx` / `.css`                      | 30 点对比、进度、取消、曲线、数据与分析  |
| `react-app/src/components/EvmReadout.tsx`                                         | 通用 EVM 展示                            |
| `react-app/src/pages/SignalLab.tsx`                                               | v0.6 入口、BPSK EVM、新实验入口          |
| `react-app/src/components/QpskExperiment.tsx`                                     | QPSK EVM 展示和快照                      |
| `react-app/src/components/AiTutor.tsx` / `react-app/server/aiTutor.ts`            | 新快照类型与教学规则                     |
| `react-app/src/lib/reportExport.ts` / `react-app/src/components/ReportExport.tsx` | 新实验报告和图表范围                     |
| `react-app/tests/qam16.test.ts` / `evm.test.ts` / `modulation-comparison.test.ts` | 映射、数值、边界、精确 parity 和内存预算 |
| `react-app/tests/modulation-report.test.ts`                                       | 报告、部分点及完整上下文预算             |
| `react-app/e2e/modulation.spec.ts`                                                | 桌面/移动新实验端到端回归                |
| `react-app/e2e/signallab.spec.ts`                                                 | 明确两个同类下拉框的角色与名称定位       |
| `react-app/e2e-pages/pages.spec.ts`                                               | 静态子路径的新星座与 Worker              |
| `README.md` / `react-app/README.md` / `docs/github-pages.md`                      | 功能、算法约束与发布测试更新             |
| `docs/signallab-v0.6-plan.md` / 本文件                                            | 先行计划、数学、验证和边界               |

验收命令：`npm test`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:e2e`、
Pages 构建后 `npm run test:pages`。新核心独立只读审查未发现阻断问题，审查者另运行核心测试 12/12 通过。
浏览器首跑发现下拉框定位歧义，改为 combobox 完整名称；报告表头补充“参考辅助”以准确说明归一化。

本地最终验收：单元/HTTP **86/86**，普通生产构建桌面/移动 E2E **24/24**，
Pages 子路径桌面/移动 **8/8**；Lint、五组 TypeScript 检查、普通/静态生产构建和 Prettier 检查通过。
新核心和旧核心源文件对比确认：signallab.ts、qpsk.ts、berSweep.ts、原 berSweep Worker 均未修改。

## 保留的边界

- 仅 AWGN、理想同步、相干硬判决，无成形滤波、频偏、衰落、均衡或编码。
- 实测零误码与短序列 EVM 不代表总体性能，理论假设必须与输入分布和能量约定一致。
- 浏览器为桌面 Chromium/模拟移动视口，不等于全部浏览器、真实手机或硬件验证。
- 取消测试覆盖启动等待与旧消息门控，不覆盖所有部分完成/Worker 崩溃竞态。
- 公网助教认证、用量预算及上游响应字节限制仍沿用 v0.5 的待实施方案，未在此轮扩展。
- 用户已有 `.mcp.json` 和 `user-memory.local.md` 不进入本轮提交。
