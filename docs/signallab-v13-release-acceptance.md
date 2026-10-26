# SignalLab AI v1.3 发布验收

日期：2026-10-26（Asia/Hong_Kong）。应用基线：PR #11 合并提交 `99e8286a811db83d7ef4d0767ba12430acfcc56c`；其 master verify、Pages 构建和部署均通过，[部署工作流](https://github.com/Tutdy66I/CC/actions/runs/40315800214)。验收工具/文档提交另经 PR 检查后合并；Release 标签以最终核对的 master 为准。

## 证据等级

| 项目 | 结果与来源 | 范围 |
| --- | --- | --- |
| 独立数学与工程回归 | 工具执行；独立 Python DFT/FIR、CP/能量、复数插值及旧版回归通过，详见 [第二阶段报告](signallab-v13-comb-validation.md) | 固定工程协议与已覆盖输入，不是正式研究结果 |
| 实体 iPad | 用户在 iPad Pro 2024、用户报告 iPadOS 27.0.1 / Safari 执行并确认三组操作；默认100帧界面显示0.42秒 | 用户实机反馈；Safari精确构建号、截图和导出JSON未取得，未做独立跨端数值对账 |
| 原生内存 | Windows Chromium 156 headless、单个生产Worker与最小宿主页；OS进程峰值和trace线程映射 | 用户批准的新256 MiB隔离renderer门槛通过；不是纯Worker线程内存，也不是iPad/Safari原生内存测量 |
| 正式研究 | 统计精度与资源预算已确定，并进行两个80帧工程预检 | 36,000帧正式研究未执行；不将预检纳入正式样本 |

## 实体 iPad 协议与用户确认

全程使用普通 Safari 页面与现有本地环境；不清理用户数据、不操作生产云记录。

1. **默认梳状模式与持久化**：N128/CP16/S4/QPSK、P4/P8、AWGN/Rayleigh、[0,8,16] dB、F100，种子20261028。用户确认完成100帧并“已保存本地”，两幅实虚部频响及导频点可见，刷新恢复完整记录。显示用时 **0.42秒**；这是界面报告的内部运行时间，不是独立测量的点击至保存延迟。
2. **取消与恢复**：N128/CP16/S4/QPSK、每侧32活动载波、P8单布局、Rayleigh、8 dB、F1500、种子20261029。该方案为1500 cell-frame、42,336,000 work-unit，仍在原浏览器预算内。用户确认取消后保存检查点，刷新后恢复，继续完成1500帧并保存。
3. **JSON与已打开页面离线**：导出同一记录、导入并刷新恢复；F4、CP0、total Eb/N0、Rayleigh、8 dB、种子20261030。用户确认关闭网络但保持页面打开后可以完成并本地保存，看到CP不足/理论不适用的预期诊断，恢复网络刷新后记录仍在；并明确确认三组均无OFDM报错或意外页面重载。

应用在设备上的导入校验由既有解析器执行；没有取得设备JSON做桌面独立重算。验收仅覆盖上述设备/系统和操作，不扩大为所有iPad版本、离线冷启动、长时间后台挂起、设备存储耗尽或Safari内存上限均通过。

## 原生内存：明确采用新的可测量门槛

最初目标是“单Worker工作集≤64 MiB”，之前的31–54 MiB仅为托管堆/backing-store采样，不能证明原生目标。

Windows工作集是**进程**当前驻留物理页集合；`Process.PeakWorkingSet64`提供进程生命周期的峰值。Dedicated Worker通常是renderer内的线程，不能把整个进程计数精确归属到该线程。参见 [Win32工作集](https://learn.microsoft.com/en-us/windows/win32/memory/working-set)、[PeakWorkingSet64](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.peakworkingset64)；[Chrome文档](https://developer.chrome.com/docs/devtools/memory-problems)也区分OS memory footprint与JavaScript heap。

首个方法试测的renderer峰值约190 MiB、基线约62.4 MiB。基于该结果，用户明确批准新的发布门槛：**承载一个生产Worker的隔离renderer绝对峰值≤256 MiB，三个全新实例均须通过**。原64 MiB目标仍记为未证实，不重新标为通过。

方法：全新Chromium实例、最小HTML宿主、未修改的生产comb Worker默认100帧；验证Worker源码/协议/完成帧数，使用trace识别唯一DedicatedWorker线程的PID，匹配仍存活的renderer进程，读取OS `PeakWorkingSet64`。取renderer候选的最大值，包含原生进程开销、最小宿主、tracing与记录交接；不强制GC、不裁剪工作集、不减少样本、不把基线差值当精确线程内存。浏览器/GPU等其他进程不属于该renderer指标。

| 组 | 三次峰值（MiB） | 结论 |
| --- | --- | --- |
| 用户批准门槛后预先固定的三次复测 | 188.85 / 193.11 / 190.69 | 均≤256，100帧完成、线程PID映射与进程存活检查均通过 |
| 项目公开工具的三次再现 | 192.39 / 189.35 / 209.29 | 均≤256；六次中观测最大209.29 MiB |

复现：Windows中先执行 `npm test`、`npm run build`，再运行 `npm run accept:ofdm-native`。工具固定为三次、默认工作量、256 MiB绝对门槛；非Windows环境拒绝用JS堆替代。原始PID、trace、设备文件仅保存在忽略的本地 `output/signallab-v13-release-acceptance/`。

## 正式研究预算

用户选择主比较的绝对BER配对差±0.02。完整统计与资源定义见 [研究预算](signallab-v13-study-budget.md) 及 [机器可读协议](signallab-v13-study-budget.json)。

- QPSK；AWGN/Rayleigh；[0,8,16,24] dB；data/total Eb；P4/P8；共同数据86载波；两个预先指定的主对比，共32个假设。
- 95%同时置信度，Hoeffding + Bonferroni；最少35,774帧，固定36,000个完整独立trial向量，统计半宽约0.01994。相关比特/载波/布局/能量口径不增加独立样本分母。
- 每批80帧，两个能量口径共900个批记录、1,152,000 physical cell-frame。单批1280 cell-frame / 46,612,480 work-unit，保留原浏览器上限；不修改内核资源限制。
- 预检仅80个配对trial在两个能量口径各执行一次，工程种子3026102603，与正式种子范围隔离。结果约3.15/2.49秒、4,901,448/4,914,933 bytes；包含记录生成和读回校验。
- 预计计算/校验约42.29分钟；按1.5倍加10分钟归档预留，约73.43分钟。**累计活动时间硬上限2小时、Node进程峰值512 MiB、总磁盘16 GiB、启动前可用20 GiB**。原始紧凑记录理论上限7.03125 GiB，一份完整备份及日志计入16 GiB。预检Node原生峰值约297.11 MiB。

这些是固定预算与吞吐预测，不是正式结果或耗时保证。正式运行前还需完成流式编排、独立归档审计并单独授权启动；到达资源预算保存可核对前缀，不发完整样本区间，不靠重启重置累计预算，也不按显著性/误码数提前停止。

## 发布边界与工程修正

导入复核复现了一个展示问题：重复导入同一完整comb记录，会在刷新前显示两个相同的历史按钮，暂时隐藏另一条历史；数据库实际保留了两条不同记录。现按完整性哈希去重，与存储逻辑一致；增加真实浏览器回归，确保重复导入后两条不同历史都可见。该改动不改变数学内核、记录协议或原有存储内容。

本次修正的本地核验：222项核心测试、4项Windows备份测试、5项独立OFDM参考、4项独立comb参考通过；lint、TypeScript、普通及静态生产构建通过。重复导入回归先在修正前失败，修正后Chromium、移动Chromium、Firefox、WebKit四配置通过；静态Pages全部26项通过，其中两配置均验证重复导入仍显示两条不同历史。完整浏览器/云同步回归及最终部署由该提交的CI继续核对，最终结果以Release链接的工作流为准。

不修改v1.2冻结内核、原始归档、生产Supabase/RLS/Auth或用户记录。Release说明须区分自动化测试、用户实机反馈、原生进程测量与未验证范围；不声称正式研究已完成，不上传设备JSON、截图、trace或大型数据。待当前验收提交CI、合并和最终Pages版本核对完成后，创建指向准确master的注释 `v1.3.0` tag与GitHub Release。
