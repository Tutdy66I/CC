# v1.3 implementation gates

后续交付状态（2026-10-26）：全训练基线已由 PR #10 合并，`master 2d4f69c` 的 CI/Pages 部署成功。以下保留合并前的开发与修复证据；文末当时“不合并/不部署”不再表示当前生产状态。第二阶段 comb 的实现与验收另见 [协议](signallab-v13-comb-protocol.md) 和 [验证报告](signallab-v13-comb-validation.md)。

Approved on 2026-10-26 by the user's “开始”, against `signallab-v1.3-design.md`.

This delivery implements the full-training LS baseline. Comb pilots remain a second stage. The independent reference uses Python's standard library; no NumPy dependency is added. No formal Monte Carlo study or production data change is authorized.

1. P0/P1: freeze the mathematical protocol, energy ledger and random domain; independently generated direct DFT, FIR and small matrix fixtures must pass before receiver work.
2. P2: full-training LS, ideal CSI, gain-aware ZF/MMSE, retained erasures and frame statistics; verify independent formulas and identical hard decisions.
3. P3: isolated Worker, validated versioned JSON, IndexedDB CAS, prefix-only cancellation/resume, bounded previews and accessible plots.
4. P4: small fixed screening and performance measurements, old source-byte parity, existing tests, lint, TypeScript, production build and browser regression. Publish engineering evidence separately from research conclusions.

Each meaningful gate is formatted, verified and committed. Large/private output stays local. v1.2 numerical sources, databases, cloud queues, Auth and RLS stay unchanged.

## 已实现的全训练基线

- 双向单位酉 Float64 FFT、标准 bin 与有符号频率映射、DC/保护载波、CP、整帧连续稀疏 FIR；CP 不足保留真实 ISI/ICI。
- AWGN、输入复增益的固定多径、只归一化 PDP 的块静态 Rayleigh。公开全训练 QPSK，LS 不读取信道真值；ideal 对照读取同一接收波形。
- ideal/LS 各自的 ZF 与增益感知标量 MMSE。相同 CSI 的逐位硬判决相同，MMSE 用于比较原始输出 MSE，不宣传未编码 BER 优势。
- 训练与 CP 的冻结期望能量账；data / total Eb/N0 分开。实际帧能量单独记录，不用于改变 N0。
- 完整独立帧 Hoeffding BER 区间与配对差，擦除上下界、失败分母、pooled EVM 与帧 P50/P90/P99/max、LS MSE/NMSE。极深衰落不截断；稳定均值防止汇总溢出。
- 独立 Worker、runId/协议/源码/运行时身份、完成消息逐帧前缀核对、终止取消、连续检查点恢复、独立 IndexedDB CAS、最多两条完整历史、完整 8 MiB 紧凑 JSON 预算。数值运行时由 Worker 的一次性 init/ready 握手提供；主页面的 UA 覆盖不参与数值运行时指纹，续跑仍严格核对原记录身份。
- 参数与资源栅格、BER/区间、原始/判决坐标 EVM、频响和星座预览。延迟加载在原有实验之后；移动视口检查不冒充实体 iPad 验收。

## 当前验证证据

日期 2026-10-26，Asia/Hong_Kong。证据均为本地工程验收，正式研究未执行。

- 核心/HTTP 测试 206 项与 Windows 备份 4 项通过；独立 Python 参考 5 项、旧信道工具 8 项通过；TypeScript、ESLint、普通生产构建通过。
- 全套四浏览器回归在收尾修复前一轮为 246 通过、6 个按平台规则跳过。后续紧凑序列化、损坏包络及配额故障用例以定向四浏览器验收和最终 PR CI 为准，不能把不同提交的结果合成“同一次全绿”。
- 现有登录/离线同步的合成服务回归 60 项通过，包含 OFDM 登录后没有云写入。它不验证真实 OAuth 或物理设备。
- 最终修复后的 OFDM 定向四浏览器验收为 25 通过、3 个非桌面 Chromium 性能项按规则跳过，含配额写入故障。静态 `/CC/` Pages 本地构建与完整子路径回归 24 项通过，没有部署生产。
- 后续远端提交 `9149d99` 的两套 CI：完整浏览器回归通过，但合成云同步在 Linux Firefox 的 OFDM 零帧身份校验处均失败，BER 阶段因前置失败跳过。该失败保留于本地 CI 归档。已通过 main-only UA 改写测试复现窗口/Worker 指纹来源错误，改用 Worker 握手后通过；还复现并修复了连续取消使启动令牌复用、迟到哈希覆盖新任务的竞态，现使用每次唯一的令牌。最新定向回归为 37 通过、3 个平台性能项跳过，合成云同步再次 60 项通过。修复提交的远端全套结果以 PR 最新检查为准。
- 独立 DFT/FIR/完整小 Toeplitz、CP 阈值、训练 CP 能量、解析 BER、LS N0/Ep、理想 ZF/MMSE 条件 MSE、随机整数向量、活动 bin 陷波与严格零 CSI 已验证。
- 原 v1.2 18 项数值/参考文件与封存工作区逐字节相同，源码闭包 SHA-256 仍为 `ea22da6f7a39dbadca65c7a95ce1207a57e843cd173f2c064dc7d536868b1e92`。新 worktree 的 CRLF 转换曾改变原始字节，现已恢复；旧文件没有内容差异。
- 360 cell-frame 的固定 F20 工程筛查已保存本地完整帧和哈希。它只有数量级筛查能力，不是精度研究、算法选优或总体性能证明。

Desktop Chromium 最新一次默认实验测量为 2.019 秒，同步消息处理 P95 14.7 ms，22 个 CDP 采样中的 Worker 托管堆和 backing store 峰值 21.43 MiB。Node 默认 200 帧 / 1,200 cell-frame 的一次测量为 1.223 秒，整个进程托管堆与数组缓冲采样峰值 23.45 MiB，紧凑记录 1,608,612 字节。并发负载和运行环境会影响耗时。

同机 Node 24、同一百万比特八点 BER、各两次预热与五次计时：封存 v1.2 中位数 437.2042 ms，本分支 433.9440 ms，比值 0.99254，输出逐值一致，满足本次测量的 ≤10% 回归门槛。另有原有全规模 BER 基准的逐值相同结果。

上述内存值不构成单 Worker 原生/OS 峰值工作集 ≤64 MiB 的证明，该目标仍未完成验证。同步回调 P95 不包含异步 continuation；未据此声称所有主线程任务都低于 50 ms。

开发期间保留并修复了检查点旧哈希混入、完成消息替换前缀、启动准备期间卸载、旧错误消息、深衰落汇总溢出、导出字节预算不一致等失败。故障注入用于验证保护行为，不冒充真实设备故障。

## 保留范围

梳状导频/插值为下一阶段；未增加 NumPy；未运行正式大矩阵、GPU 或云计算。未修改生产数据、RLS、Auth、数据库结构、旧记录和云队列。原生 Worker 工作集、实体 iPad、正式研究精度/样本/时间预算仍待单独验收或批准。

开发交付以分支和 PR 为准。本轮不合并 master、不部署生产、不创建 v1.3 Release；生产保持已封存 v1.2。详见 [工具与测量边界](signallab-v13-tools.md)。
