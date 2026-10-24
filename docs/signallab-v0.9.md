# SignalLab AI v0.9：可复现的相位与频率偏移

基线 master：`24099992aa6abb7e2662003196b852d20e61ae60`。
范围与协议见 [设计](superpowers/specs/2026-10-24-signallab-v09-design.md) 和
[实施计划](superpowers/plans/2026-10-24-signallab-v09.md)。

## 使用

在 `#/signallab` 的“相位与频率偏移实验”中选择调制、扫描类型、固定 Eb/N0、
比特数、重复次数、基础种子和递增扫描点，点击“确认偏移方案并运行”。
编辑参数不修改完成快照；取消或异常不生成新记录。完成后可查看整帧统计、
第一试验的跨帧星座预览和未取模相位轨迹，载入方案重新确认运行，或导出 JSON。

最近五次记录仅保存在当前浏览器来源，不进入账号同步队列，也不包含在现有
云端应用备份中。存储失败时结果留在内存并提示导出；检测到未知版本、损坏历史
或另一页面修改历史时，不自动覆盖原存储。当前不支持 JSON 文件导入。
记录校验验证格式和内部一致性，不证明结果未被人为改动。

## 数学与随机协议

`r[n] = s[n] exp(j(phi + 2*pi*epsilon*n)) + w[n]`，n 从零开始，单位为符号。
相位输入单位为度，范围 [-180,180]；epsilon=Δf/Rs，单位 cycles/symbol，
范围 [-0.5,0.5)。频率在此采样率下有混叠，不能据此推断真实射频频偏。
模型在每符号一个理想采样处旋转，不模拟脉冲成形、匹配滤波损失、ISI 或锁定过程。

- 保持 BPSK/QPSK/16QAM 原 Gray 映射、Eb=1、能量、门限和边界归属。
- QPSK/16QAM 沿用原 I、Q 顺序；BPSK 的 I 保留旧流，Q 使用
  `(seed XOR 0x9e3779b9) >>> 0` 派生流。旋转后在接收坐标系加入两轴 AWGN。
- 每轴方差 `1/(2*10^(Eb/N0/10))`；PRNG 和 Box–Muller 保持原实现。
- 试验种子 `(baseSeed + trial*10 + snrIndex) >>> 0`，trial 从零开始，snrIndex
  使用完整 `[-4,-2,0,2,4,6,8,10,12,14]` 网格索引。扫描点共享同次试验噪声。
- 比特沿用完整64比特星座周期。每次64至131072比特，64的倍数；界面提供
  16384/65536/131072，重复5/10/20次，最多21个扫描点，工作量另受8000万比特上限保护。
- 频偏相位依赖绝对符号索引，不在64比特周期边界重置；不同调制每帧符号数不同。
- 精确四分之一周使用精确旋转值，保留门限上的确定性判决；邻近角度不作容差吸附。

I/Q RMS EVM 使用实际参考能量，包含相位误差，不自动校正。相位固定且无噪声时，
EVM=`2*abs(sin(phi/2))`。复数 BPSK 的 I/Q EVM 与旧实轴 EVM 不同；零偏移时
旧 BPSK BER 保持一致，QPSK/16QAM 的 BER 和 EVM 均保持一致。

## 理论与统计

预测按实际符号和逐符号相位计算条件期望，不把零偏移理论曲线当作偏移预测。
BPSK 使用 `Q(sqrt(2*gamma_b)*cos(phi))`；QPSK 分别计算两轴跨零概率；16QAM
对旋转后每轴高斯分布积分，按原 Gray 码汉明距离加权。无噪声时直接使用
原门限的确定性判决，尤其不能在90°边界套用含非零噪声的连续极限。
正态尾概率使用 erfc 数值近似（含精确 Q(0)=0.5）；独立 Python stdlib
参考程序 `react-app/scripts/carrier-reference.py` 提供静态及频偏固定值，测试容差为1e-7。

误码数为整数，BER=总误码数/总比特数；EVM 汇总为等长试验 RMS 平方均值的平方根。
种子样本标准差使用 trials−1 分母。完整64比特块的误码比例为 [0,1] 有界变量，
Hoeffding 半宽 `sqrt(ln(40)/(2*totalBits/64))`，裁剪到 [0,1]。
允许不同块的期望随相位变化，假设理想噪声块独立；PRNG 近似这一假设。
这是有限帧平均期望的逐点区间，不是同时置信带，也不是各偏移点独立的差异检验。
零误码上界保持正值。无噪声没有抽样噪声，界面区间仍沿用该保守规则。

JSON 保存实验/引擎版本、种子规则、symbolStart、EVM 定义、冻结参数、实际种子、
统计及有界预览。旧 v0.8 历史、云端 schema、RLS、配额、备份和 AI 模板不变。
新实验没有 AI 调用，不需要新增服务、依赖、账号或付费模型。

## 验证与限制

数值测试覆盖独立数组通道、Python erfc 参考、零偏移旧结果、种子边界、四象限、
极小角度、90°两侧、能量/EVM、输入预算及损坏/未知版本记录。
浏览器测试覆盖真实 Worker、三调制、冻结参数、刷新/导出、频偏、取消、旧消息回放、
Worker 故障及畸形消息、存储失败和多页面冲突。云端测试使用合成 Supabase 会话
验证登录后不上传；Pages 测试使用仓库子路径，不访问实际模型或生产数据库。

依次执行 `npm test`、`npm run lint`、`npm run typecheck`、`npm run build`、
`npm run test:e2e`、`npm run test:cloud`、静态 Pages 构建及 `npm run test:pages`，
以及 `npm run benchmark:ber`。浏览器套件应串行运行：默认 E2E 输出目录包含
cloud 子目录，并发运行会清理彼此的 trace 文件。Windows 本机还执行全部 DPAPI 测试。

跨浏览器对误码计数要求一致，浮点量使用明确容差；不保证所有数学库逐位一致。
当前没有载波估计/恢复、过采样、自动补偿、新 AI 模板或新实验云同步。

2026-10-24 本机验证：核心测试123/123，Windows备份4/4；通用浏览器132/132，
合成云同步36/36，静态Pages14/14；Lint、TypeScript、普通/静态构建、Prettier
及diff检查通过。原BER基准 exactParity=true（10k/100k/1m比特）；新内核最大帧
三种调制在32MiB V8 old-space限制下通过，并与条件理论在预设容差内一致。
独立审查发现并修复近90°相位舍入问题，新增边界两侧测试；Worker协议异常、
本地存储冲突/写满均可恢复或导出。桌面/手机预览无页面横向溢出。
仍有原有Vite native配置加载兼容警告；本轮未修改相关RSS/AI配置文件。
这些是本机结果，不代表已推送、合并、部署或完成真实双账号/实体跨设备云端验收。

理论参考：

- [MathWorks PhaseFrequencyOffset](https://www.mathworks.com/help/comm/ref/comm.phasefrequencyoffset-system-object.html)
- [MathWorks EVM](https://www.mathworks.com/help/comm/ref/comm.evm-system-object.html)
- [MathWorks AWGN analytical expressions](https://www.mathworks.com/help/comm/ug/analytical-expressions-used-in-berawgn-function-and-bit-error-rate-analysis-app.html)
