# v1.3 第二阶段开发验证报告

后续状态：PR #11 已合并为 `99e8286`，master CI与Pages部署成功。实体iPad用户验收、明确修订为256 MiB的隔离renderer原生内存验收及正式研究预算见 [发布验收](signallab-v13-release-acceptance.md)。下文保留第二阶段当时的验证边界；原64 MiB Worker目标未被重新标为通过。

日期：2026-10-26（Asia/Hong_Kong）。开发基线：`master 2d4f69c`，PR #10。第二阶段引擎为 `ofdm-v13.2`，不是 `v1.3.0` Release。远端交付及 CI 状态以本阶段 PR 的当前提交检查为准；本文件记录本地验证与边界。

## 功能与算法

新增独立“梳状导频与插值”模式。可按数量、真实有符号频率间隔或手动位置配置最多三个布局；严格拒绝 DC、保护载波、重复/无序位置、缺失端点、全部载波为导频、无共同数据位置等输入。数量布局匹配等距物理频率目标；间隔布局显示真实间隔，跨 DC 不压缩坐标。

接收器在每个数据符号的已知非零公开 QPSK 导频上执行 LS `Yp/Pp`，再分别线性插值实部和虚部，不插值相位、不外推。估计器 API 仅接收导频观测、已知符号和坐标，没有信道真值或旁路 clean samples 入口。三个 CSI 分支为 ideal、单个全训练符号 LS、每数据符号 comb LS + 插值，分别使用既有 ZF 与增益感知标量 MMSE。

三种 CSI 读取同一发送帧与 noisy 观测。每帧一个全训练符号 + S 个含 comb 的数据符号，所有分支均计入训练开销；该对照没有移除 comb 分支的全训练符号。布局之间共享虚拟载荷、抽头和标准噪声；data/total Eb 口径决定各布局的实际 N0。全部数据和共同数据单独统计，跨布局配对差只使用共同数据位置。

展示 BER、完整帧区间、配对差、擦除/失败帧、原始输出 MSE/EVM、判决坐标 EVM、帧 EVM 分位数、信道估计 MSE/NMSE、条件插值偏差和导频噪声项。可切换布局、信道、统计范围与首帧 SNR，查看真实/全训练/comb 频响实虚部及导频 LS 点。只有完整固定帧批次发布区间；失败保留分母。

## 能量与统计协议

完整约定见 [数学协议](signallab-v13-comb-protocol.md)。`Es=log2(M)`、`Ep=Es`、`Eb,data=1`。训练、导频及 CP 都计入 expected total energy。固定导频的 CP 能量通过其单位酉 IFFT 尾部精确计算；实际 CP 分开记录 training/data/pilot/cross 项。独立参考同时覆盖 pilot CP 尾部为零、以及 data/pilot 交叉项非零的布局，不能统一用 `C/N` 替代。

同 CSI 的 ZF/MMSE 未编码硬判决一致，原始 MMSE 输出包含收缩。CP 不足使用整帧连续 FIR 保留 ISI/ICI，对角 BER 理论及 bias+noise 分解标为不适用。EVM 分位数为描述性统计，没有使用 BER 的有界区间替代其不确定性。

默认 N128/C16/S4、QPSK、P4/P8、AWGN/Rayleigh、[0,8,16] dB、F100，共 1200 physical cell-frame；每格另保留 all/common 两套指标。默认共同数据载波为 86 个。单 BER 的 95% Hoeffding 半宽约 0.136，配对差约 0.272，均为逐格区间，未校正多重比较。这是工程演示规模，不构成正式研究精度。

## 独立数学参考

`react-app/scripts/ofdm-comb-reference.py` 仅用 Python 标准库，以 O(N²) 单位酉 DFT、直接连续 FIR、复数除法及独立线性权重生成确定性 fixture，不导入生产 TypeScript、生产 PRNG 或 FFT 库。

- 常数复信道与复仿射频响，包括跨 DC 的真实距离、导频端点和无外推。
- 四个完整确定性时域帧：P4/P8 × CP2/CP3，最大时延 3；逐点比对发送栅格、CP 波形、连续 FIR、noisy FFT、全训练 LS、comb LS、插值与实际/期望能量。绝对/相对容差为 `1e-10*(1+abs(reference))`。
- 六个确定性插值偏差例：P4/P8/P16 × delay1/delay7，及 0/40 dB 的条件 MSE。delay1 的无噪声 MSE 约为 0.01718 / 0.0007246 / 0.00004731；delay7 为 0.64084 / 0.62409 / 0.08855。只说明这些既定案例，不能推为所有信道的普遍单调结论。
- 固定 F40 小筛查：实测估计 MSE 与 bias+pilot-noise 参考在预置宽容差内；40 dB 仍保留插值误差底限。它不是正式 Monte Carlo 研究。
- 三种调制 × 两种能量口径 × 有/无噪声的判决一致性、CP 不足、精确零信道擦除、最大 N1024/CP1024/时延1023/Nyquist 载波，以及非法和零值导频。

## 本地验证结果

| 检查 | 结果 |
| --- | --- |
| 完整数值、HTTP、记录与存储单元测试 | 219 通过 |
| Windows 备份/DPAPI 测试 | 4 通过 |
| 既有独立 OFDM DFT/FIR/Toeplitz/均衡参考 | 5 通过 |
| 新增独立 comb 参考 | 4 通过 |
| 旧研究恢复/独立数学/离线工具 | 8 通过 |
| lint / TypeScript / 常规生产构建 | 通过 |
| 全套 Chromium/移动 Chromium/Firefox/WebKit | 307 通过，9 个平台性能测量按规则跳过 |
| comb 专项四项目 | 45 通过，3 个非桌面 Chromium 性能项跳过（包含于全套） |
| 最终源码 Chromium 专项 | 12 通过；含编辑表单后恢复原协议 |
| 合成 Supabase 登录、离线、冲突、墓碑回归 | 63 通过；新 comb 已登录运行零云写入 |
| 静态 `/CC/` Pages 桌面/移动子路径 | 26 通过 |
| 既有 BER benchmark | exact parity=true |

没有保留未解决的工程测试失败。一次完整浏览器进程未取得最终输出，未计入通过；随后保存完整日志重跑，退出码 0、307 通过。高密度布局校验优化、严格单值活动载波输入及图表标注之后执行了定向复验；最终提交还需核对远端全套 CI。

远端首轮同提交 push CI 通过，PR CI 的一项移动 Chromium 取消竞态测试在计算完成、保存尚未结束时触及通用 5 秒等待（306 通过、1 失败、9 跳过）。该功能测试的第二轮改为固定 20 帧，并明确等待两轮 Worker 进入运行态、断言旧错误处理器存在后注入迟到错误；四个浏览器项目各重复三次，12 次通过。独立默认性能测试仍为 100 帧、完成并保存 ≤5 秒；应用默认方案与数学源码未改变。修复后的最终检查以当前 PR 提交为准。

## 性能和内存

Windows、Ryzen 9 6900HX、Node 24.16、Playwright Chromium 156，本地单次/重复工程测量：

| 项目 | 旧全训练默认 | comb 默认 |
| --- | --- | --- |
| 帧数 / physical cell-frame | 200 / 1200 | 100 / 1200 |
| 浏览器端完成并保存 | 约 2.00 秒 | 约 3.60 秒 |
| Worker 托管堆+backing-store 采样峰值 | 约 21.6 MiB | 单次约 50.1 MiB，重复样本约 31–54 MiB |
| Node 内核+记录 | 约 1.41 秒 | 约 3.26 秒 |
| Node 进程堆+ArrayBuffer 采样峰值 | 约 21.5 MiB | 约 50.3 MiB |
| 紧凑 JSON | 1,608,612 bytes | 4,533,526 bytes |

两默认方案的接收器及统计工作量不同，表格用于容量对照。comb 默认在本机满足 ≤5 秒；新 Worker bundle 约 27.5 kB，旧 Worker 约 21.7 kB。同步消息处理器 P95 约 4.5 ms，测量不覆盖异步后续步骤。GC、采样间隔及机器状态会影响峰值。

**尚未验证原生/OS 单 Worker 峰值工作集 ≤64 MiB。** CDP 托管堆与 Node 进程采样都不能替代该指标。最多 24 格、1500 cell-frame、50M work-unit 和 8 MiB 紧凑记录的上限明确拒绝超限，不减少样本。最大序列化测试重复合成帧仅检查字节预算，不是独立帧研究证据。

## 兼容性与边界

旧 v13.1 内核、Worker、记录解析器及数据库未改。旧源码指纹在本机仍为 `4c8f1eba65a5b2fe2915240b29dbfcaba04399789a072fd2963377121441eb6a`；新增 comb 文件从旧指纹枚举排除，并使用独立完整依赖指纹。旧完整记录/部分检查点可原样解析导出；浏览器验证新实验后旧本地记录仍可原样导出。

v1.2 冻结依赖闭包 SHA-256 仍为 `ea22da6f7a39dbadca65c7a95ce1207a57e843cd173f2c064dc7d536868b1e92`；原始研究归档、源码快照未改。新库 `signallab-ofdm-comb-v13` 与旧库隔离，保留 CAS、两条完整历史及检查点。engine/protocol/source/Worker-runtime、连续前缀及完成消息均校验；源码或运行时变化拒绝拼接旧检查点，原记录仍可导出。

无新增依赖；无生产 Supabase/RLS/Auth/用户记录变更；无正式大型研究；无 `v1.3.0` tag/Release。合成登录/云回归不代表真实 OAuth 或实体设备验收，Windows WebKit 与移动视口不代表实体 iPad。生产仍是已合并的全训练版本，本阶段以 PR 交付。

## 后续验收

实体 iPad：记录型号、iPadOS/Safari 版本；在批准部署后运行默认方案、P4/P8 与手动布局、data/total Eb、CP16/CP0、取消/刷新/恢复、JSON 导入导出及旧历史保持。先联网打开并运行，再测试保持页面打开后的断网运行；离线冷启动单列，不推定可用。同步回归继续遵守生产数据边界。

正式研究：先批准逐格/多重比较的精度与失败概率、完整帧样本量、布局共同数据集合、信道/时延/PDP 矩阵、运行时间与存储预算，再冻结协议运行。特别保留深衰落、擦除、CP 不足及高 SNR 插值底限；不要用默认 F100 或重复序列化样本作正式结论。

## 复现入口

在 `react-app` 运行 `npm test`、`npm run test:ofdm-reference`、`npm run test:ofdm-comb-reference`、`npm run test:channel-tools`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:e2e` 与 `npm run test:cloud`。独立参考使用 Python 3，可通过 `SIGNALLAB_PYTHON` 指定可执行文件。

固定默认性能筛查：先编译测试，再运行 `node scripts/benchmark-ofdm-comb.mjs`。它没有可配置大型扫描入口，输出仅保存在忽略的本地 `output/signallab-v13-comb-validation/`。Pages 需先用 `/CC/` base 和 static-host 配置构建，再运行 `npm run test:pages`；普通构建与静态构建依次执行，避免共用 dist 干扰。
