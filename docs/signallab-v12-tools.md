# v1.2 离线验证与复现

本研究完全本地执行，不访问 AI、账户、云同步或数据库。
命令从 `react-app` 执行。`npm run test` 编译后默认使用 `.test-build` JS；
显式设置 `SIGNALLAB_CHANNEL_SOURCE=1` 则使用 Node 的 TypeScript 去类型执行。
执行模式、依赖闭包或 Node/平台/架构改变后必须使用新输出目录，不能拼接旧检查点。

## 独立数学参考

```powershell
python3 scripts/channel-reference.py --self-test
python3 scripts/channel-reference.py
```

Python 仅使用标准库 `math.erfc`，独立积分 Gray 16QAM 判决区间，再对指数分布
信道功率积分。BPSK/QPSK 闭式 Rayleigh BER 与该积分交叉核对。
高 SNR 尾概率使用反射后的 erfc 差，避免两个接近 2 的数相减。
脚本不调用 TypeScript、项目 PRNG 或仿真结果。导出的固定数值见
`signallab-v12-reference.json`。

```powershell
$env:SIGNALLAB_PYTHON='python3'
node --test tests/channel-tools.test.mjs
```

Windows 可把环境变量设为 Python 可执行文件的绝对路径。显式指定的 Python
不可执行时测试失败，不能以跳过掩盖；不提供变量时仅跳过两项跨语言验证。
跨语言检查使用相对误差门槛 `2e-10`，极小概率绝对容差下限 `2e-25`。

## 冻结矩阵与完整研究

完整协议固定 N=1024、F=10000、seed=42、P=4/16/64。
主矩阵三调制、−4/0/4/8/12/16/20 dB、AWGN/准静态 Rayleigh，共126格；
含导频总能量矩阵 QPSK/16QAM、0/8/16 dB、两模型，共36格；
逐符号独立 Rayleigh 负对照三调制、0/8/16 dB，共27格。

63个分组各包含同一调制/SNR/模型下的三个导频数量，保留公共数据集配对。
每组只在内存保留本组结果，不把全部研究的原始帧聚合为一个数组。

```powershell
node scripts/study-channel-research.mjs --register-only
node scripts/study-channel-research.mjs
node scripts/inspect-channel-research.mjs ../output/signallab-v12-study
```

默认输出 `output/signallab-v12-study`。协议在计算前落盘；冻结内容包括完整矩阵、
每组引擎协议 hash、TS 源码依赖清单、实际执行 JS/TS 清单、研究/审计/数学参考脚本、
Node/平台/架构。摘要 hash 不等于外部注册或真实性认证。

每10帧写一份至多10帧的不可变增量 chunk，绑定前一 chunk 的 SHA256。
恢复验证完整连续链、冻结身份及逐帧指标，已完成帧不重复计数。磁盘开销随帧数线性增长。
异常退出最多损失尚未落盘的9帧，结果继续保持未完成状态；不会生成固定样本完整区间。
更改协议、源码或实际执行构建会拒绝续跑。损坏链不会静默跳过。

每组保存独立 `.json.gz`，最终流式生成 `results.jsonl.gz` 与 `summary.json`。
审计核对完整63组/189格、每组方案和F、原始压缩 hash、独立文件与总归档字节一致性，
并通过记录解析器重算汇总。完整大体积原始归档留在本地研究目录，不能把摘要当作原始数据。

## 快速和恢复验证

```powershell
node scripts/study-channel-research.mjs --quick --out ../output/signallab-v12-quick
node scripts/inspect-channel-research.mjs ../output/signallab-v12-quick
```

quick 使用 QPSK、N128、F20、P4/16，固定7组14格；仅用于工具和恢复验证，
不能代替完整研究。`--stop-after-checkpoints 1` 可在首个10帧 chunk 后有意停止；
原命令移除该参数即可恢复。自动化测试覆盖该过程、完成后的重复执行及协议篡改拒绝。

## 性能与旧研究

```powershell
node scripts/benchmark-channel-research.mjs --out ../docs/signallab-v12-kernel-benchmark.json
node scripts/restore-v11-reference.mjs
```

性能脚本固定2次预热、7次测量；独立报告最大帧4096、三导频布局、三个模型、
单SNR内核时延，默认协议 Node 端到端时延，以及32MiB V8 old-space子进程验收。
它不代表浏览器 Worker 启动、绘图、存储或浏览器峰值内存验收。
旧百万比特 BER 扫描逐值与 v1.1 基准对照，环境相同时要求中位时延回归不超过10%；
默认协议 Node 端到端目标不超过5秒。不能把不同机器的绝对耗时直接用于该门槛。

旧研究逐文件行尾和实际执行字节恢复方法见 `signallab-v12-v11-restore.md`。
已实际生成隔离副本并运行原审计：27格、540校准帧、3240评估帧，
sourceMatches/runtimeMatches 均为 true；原目录中一份10帧 v1.1 检查点也被恢复内核正确解析。
没有重新运行旧大矩阵，没有修改原 v1.1 归档。
