# SignalLab v1.4 P1：连续采样 CFO 与已知真值补偿

状态：P1 工程原型；基于研究封存提交 `5f98b4f1a378fdcc2b059e0a67bbe905345e0e0f`。本阶段只实现 CFO 注入和理想同步，不包含 CFO 估计、STO、正式统计研究、页面入口或新的持久化数据库。由于尚无页面入口，生产构建不会打包此独立 Worker；Edge 测试通过开发服务器执行 Worker。

## 冻结的 P1 模型

- N=128，CP 由计划指定，活动载波为 ±1…±48；一个全训练符号、四个 QPSK 数据符号。数据使用固定的逐 bin 消费顺序。CP 不足仍经过实际连续 FIR，不使用对角频域捷径。
- 帧前 16 个和卷积尾部后 16 个保护采样；所有保护区及 FIR 尾部都有独立接收噪声。整个 CP-OFDM 帧经因果线性 FIR，零前史，不在符号边界复位。最多四个排序互异的固定复数抽头；不自动归一化。单抽头 `[1]` 即 AWGN。
- 对捕获中的每个绝对采样 n，先计算 `z[n] = exp(j*(phase + 2*pi*cfo*n/128)) * (h*s)[n]`，再加 `w[n]`。cfo 单位是子载波间隔，限定 `[-1,1]`；相位限定 `[-pi,pi]`。采样 CFO 的物理别名周期为 N，不保证估计捕获范围。
- `w` 为 CN(0,N0)，每实轴方差 N0/2。data Eb/N0 使用 data Eb=1；total Eb/N0 使用包括训练和 CP 的计划期望能量。保护区不作为发送能量。
- raw 和 ideal 共用同一个 noisy capture；raw 按名义 FFT 起点，ideal 使用真实 CFO/相位逆旋转整个捕获，然后按相同名义起点取窗。两支都从自己的 noisy 全训练观测做 LS，并以 ZF 判决。该理想分支知道仿真真值，不能称为估计接收机；CFO/相位补偿也不会修复不足 CP 的 ISI。
- 输出每帧两支的已比较位数、错误数、擦除位数、发送星座能量与未去偏误差能量，及 N0、CP 是否充分、预期 total Eb 和实际发送能量。擦除时误差能量为 null，错误数只统计可判决的位，解释 BER 时须同时报告擦除上下界；不得按成功帧筛样。深衰落引发的非有限误差能量也为 null。

随机域为 `signallab-ofdm-sync-rng-v1|seed|trial|role|slot`，SHA-256 前 16 字节按四个 little-endian uint32 初始化 xoshiro128**。数据角色每标准 bin 消耗四个虚拟 bit；噪声角色单独生成整个捕获的标准复 Gaussian，再按固定 N0 缩放。算法之间不另抽样。协议和计划哈希不复用 v1.3 身份。

源码位于 `react-app/src/lib/ofdmSync/`，Worker 位于 `react-app/src/workers/ofdmSync.worker.ts`。新 Worker 源码指纹覆盖全部 `src/lib` 下的 TypeScript 及自身；旧两个指纹的枚举规则保持不变。Worker 以 `start` 接收 runId 和计划，依次返回 `ready`、一个或多个 `batch`、`done`，或 `error`。终止 Worker 可取消；当前原型不提供检查点恢复或记录导入导出。

**字节级兼容边界：**v1.3 的源码指纹依赖工作树里的实际字节，而旧版本包含 LF 与 CRLF 混合文件；相同 Git 提交经不同的 `core.autocrlf` 检出，指纹也可能不同。本工作树从既有 v1.3 工作树恢复了原始数值文件字节，并核对了已发布的 v13.2 指纹 `b9deff86510bcba6a595fadd270b9d279bac8b4075c34d6a1397c8dd198621ba`。未来恢复旧检查点或研究时仍须使用其原始源码字节并核验指纹，不能只凭提交 SHA 或绕过身份检查；本原型不改变旧文件的 Git 内容。

## 工程验证

从 `react-app` 执行：

```text
npm run test:ofdm-sync-reference
npm run test:ofdm-sync-edge
```

前者需要 `python3` 或 `SIGNALLAB_PYTHON` 指向 Python 3。Python 标准库直接 DFT/FIR 的固定向量不导入产品内核，覆盖半子载波 ICI、正负及整数 CFO、多径和带噪捕获、已知真值补偿、CP 不足、零 CFO 与 v1.3 相同输入对照，以及新随机域的独立 SHA-256 状态。CI 运行这些参考测试。Edge 测试需要已安装 Microsoft Edge，运行 100 帧是工程基准，不是统计研究或 BER 改善结论。

本阶段不改旧协议、旧 IndexedDB、云同步或封存标签，不运行正式 Monte Carlo。原始研究数据的独立异盘备份仍未完成。
