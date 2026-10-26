# v1.3 第二阶段：梳状导频协议与兼容方案

基线 `2d4f69c`，用户于 2026-10-26 批准本阶段开发。仅工程验证和固定小样本筛查；不执行正式研究、不创建 Release、不改生产数据。

## 公平比较与发送帧

新引擎 `ofdm-v13.2`，随机域继续使用未改变的 `signallab-ofdm-rng-v1`。每帧一个全带宽训练符号与 S 个数据符号。数据符号的活动载波划分为已知梳状导频 P 与数据 D；DC 和保护载波为空。ideal、全训练 LS、comb LS + 复数线性插值读取同一 noisy 波形，分别运行 ZF/MMSE。该模式是三种 CSI 的共同预算对照，训练符号的开销也由 comb 分支承担。

布局按实际有符号频率排序，至少两个互异导频，必须覆盖活动频带两端；不外推。按数量选择最接近等距物理频率的活动位置，约束剩余位置保证互异；按间隔选择活动坐标上的整数步进并包含两端；手动位置严格校验。实际位置列表进入协议 hash，实际间隔另列，跨 DC 不压缩距离。不允许全部载波均为导频。

导频 LS 使用 noisy Yp / 已知 Pp。对目标 q 位于 qL、qR 之间，a=(qR-q)/(qR-qL)，b=1-a，分别对复数实部和虚部应用 a*HL+b*HR。导频自身权重为 1；不插值相位角。接收器函数没有信道真值入口。

## 能量与统计

Es=log2(M)，Eb,data=1，Ep=Es。B=S*|D|*log2(M)。期望 useful 能量为 (1+S)*|A|*Es。令 xP 为 comb 导频单独的单位酉 IFFT，期望 CP 能量为训练 CP 实际能量 + S*[C/N*|D|*Es + sum_tail |xP|²]。实际 CP 另列 data、pilot、training 与 data/pilot 交叉项，不能将固定导频 CP 能量简化为 C/N。

data Eb/N0 使用 N0=1/gamma；total Eb/N0 使用该布局预先冻结的 expectedTotal/B/gamma。N0 不随随机帧实际能量或衰落改变。资源占比区分数据符号内导频比例、全帧训练/导频 RE、空载波、CP 样本及 bits/complex sample。

最多三个布局在同一独立 trial 中共享抽头、虚拟载荷和标准噪声。所有 N 个标准 bin 固定消费四个虚拟 bit；pilot/null 不改变随机数消费。共同数据集合为 active 减去所有布局导频的并集，多布局时为空则拒绝。分别报告全部数据与共同位置的 BER/EVM/估计误差；跨布局配对差仅使用共同位置。每个完整帧是独立统计单位，失败和擦除保留分母；完整固定样本后才发布逐格 Hoeffding 区间，未校正多重比较。

CP 充分时，条件插值误差参考分解为 |A*HP-HD|² 与 N0*sum(weight²/Ep)，二者单独报告。真值只用于 ideal 分支及事后诊断。CP 不足保留整帧 FIR 的 ISI/ICI，经验误差继续报告，标量解析 BER/MSE 参考标为不适用。ZF/MMSE 同 CSI 硬判决必须逐位一致；MMSE 原始输出 MSE 与判决坐标 EVM 分开。

## 版本与存储

旧 v13.1 的核心、解析器、Worker 和 IndexedDB 保持原文；新模块以 `ofdmComb` 前缀隔离，新库 `signallab-ofdm-comb-v13`。模式选择器保留旧全训练入口，旧记录不迁移、不重新计算、不被新历史覆盖。旧引擎的源码指纹排除新 comb 文件，新增引擎的指纹覆盖自己的完整依赖集合。新旧 JSON 明确识别引擎，跨模式提示切换；不伪装升级。

新记录保留 schema、engine、protocol、source、Worker runtime 和完整性哈希；初始化握手、唯一启动令牌、连续前缀、CAS、取消/恢复延续既有保护。旧记录完整导出；源码/运行时改变的检查点拒绝拼接。

为六种接收器及 all/common 指标设置新的明确工程上限：最多 24 个布局/信道/SNR 格、1500 cell-frame、50,000,000 work-unit、8 MiB 紧凑记录。超限拒绝，不自动减样本。默认 QPSK/N128/C16/S4，P4/P8 两布局、F100、AWGN/Rayleigh、[0,8,16] dB，共 1200 cell-frame。F100 的单 BER 95% Hoeffding 半宽约 0.136，仅用于演示和工程筛查。

## 验证顺序与交付

先以 Python 标准库独立 DFT/FIR、手工复数线性向量和插值权重生成 fixture，再验证 TS 内核；覆盖平坦、复线性、跨 DC、边缘/非法输入、无噪声偏差、密度/时延扩展、SNR 极限、连续信道 CP 阈值和能量交叉项。随后接入 Worker、严格解析、独立存储和图表，执行三引擎/移动视口、Pages、云同步与旧数值闭包回归。

默认延迟和托管内存仅以实测报告；CDP/Node 堆样本不等同原生 Worker 工作集。实体 iPad 和正式研究预算另行验收。代码通过后推送 PR、核对当前提交 CI 并报告未解决问题；不在本阶段自动创建 Release。

## 外部数学参考与本项目推导

[MathWorks OFDM 资源栅格与信道估计](https://www.mathworks.com/help/comm/ug/ofdm-channel-estimation.html) 说明已知导频、导频位置与插值的用途；[OFDM 均衡公式](https://www.mathworks.com/help/comm/ref/ofdmequalize.html) 给出 ZF/MMSE。本文的标量 SISO 硬判决一致性、固定导频 CP 能量及条件插值 bias+variance 分解为本项目按所述模型作出的代数推导，以独立 DFT/FIR 与确定性参考验证，不是外部工具的认证结论。
