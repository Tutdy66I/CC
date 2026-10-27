# OFDM 正式研究执行与审计工具

基线：v1.3.0 / `cf15bf2b65a71695490fb64eb6793f3738fb7718`。本轮只完成准备与固定工程预检，**不启动36,000帧正式研究**。本实现不修改四份冻结协议或已发布数学内核；[协议核对与精度边界](signallab-v13-study-protocol-audit.md) 单列科学结论的适用范围。

## 执行与数据格式

入口是 `react-app/scripts/ofdm-study-host.ps1`，Node执行器为 `ofdm-study-runner.mjs`，独立Python审计/分析器为 `ofdm-study-audit.py`。不新增依赖，运行需要现有Node 24、可读取实际二进制文件的Python 3.9+、Windows PowerShell/.NET。本机验证环境为Windows、NTFS、4 KiB分配单元；其他执行环境拒绝启动，不替换为软限制。Python用`-I -B`隔离用户site/PYTHONPATH并禁止额外pycache，独立报告也校验Python版本、二进制和选项。

`prepare`只创建正式Manifest、代码快照及资源账，不生成正式帧。每个Manifest绑定唯一studyId和原目录位置；新目录产生新身份，原授权不能无声用于新预算。复制的归档可用匹配Python独立只读审计，继续执行须恢复到原目录，且源码/工具/Node/Python/OS/CPU、Node启动选项和随机协议全部匹配。数学模块从归档source/的已校验Buffer执行，不从可能在审计期间变化的活动工作树动态加载；加载之后磁盘再变化也不能替换正在执行的代码。

正式执行按batchId=0..449串行进行。一个提交组包含同seed/index的data Eb与total Eb两批，每批80帧，故共900原始批文件，但独立统计单位始终是36,000个trial向量。两能量口径、布局、CSI、载波和比特均不增加独立样本分母。

每组在唯一`pending/`目录写入两份完整逐trial输出、逐文件备份、审计日志和检查点；逐文件SHA、Manifest身份、序号、种子、前驱hash、全局帧号和下一批次均入检查点。独立审计新组通过后，同卷原子目录改名发布到`groups/000000`等，已有目录和文件永不覆盖。检查点本身组成SHA链，无可回退的可变“已完成数量”指针。

这里的原始结果是发布内核返回的全部逐trial对象，包括各接收器计数、估计误差、能量和首帧预览；不是保存所有时域波形或逐bit判决。冻结源码与种子支持重放。异常保留error及可获得的rawAttempt，非有限值用明确标签保存，统计上按全未知误码界处理；不删除失败帧。

正常中断保存已完成的配对前缀，未提交的pending尝试仍保留。硬杀可能丢失尚在内存的尾部；恢复重放相同seed/index，不产生新样本，也不重复计数。资源仍按已预付账目累计。损坏/缺失文件、备份不符、重复组、序号断裂、协议/源码/运行时不符均拒绝恢复，不自动截断坏样本或建立新预算。

## 原生资源控制

- Node在挂起状态创建，先加入Windows Job再恢复执行。Job的进程和总提交内存上限均为512 MiB；Node硬工作集底层设为511 MiB，验收仍要求OS生命周期峰值≤512 MiB。压力测试发现Windows可超配置值数个内存页，因此保留1 MiB安全余量；不是放宽512 MiB预算。JS堆另限制320 MiB，不将它冒充原生限制。
- 原生宿主与数值进程分离，Job关闭会终止其全部子进程；进程峰值在退出后用原生句柄再读回，不能因两次采样间的峰值漏报。参见[Windows硬工作集参数](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-setprocessworkingsetsizeex)与[Job提交内存限制](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)。
- 时间使用Stopwatch单调时钟。运行前先把至多30秒额度写入不可覆盖的双份hash链资源日志，接近耗尽才续租；**不退任何未使用租约**，正常和异常退出都全额计入，实际观测耗时另列。每次调用最多多扣不足30秒，重启不能重置旧账。准备、恢复检查和运行内分析也计时，缺失日志直接拒绝。
- 独立原生绝对看门狗只在预付款两份均flush后延长截止，且检查最新截止以免旧回调误杀；即使PowerShell主线程阻塞在磁盘I/O，也会在预付窗口结束前终止Job和专用宿主。最终化与成功结算写入同样受限。宿主必须以单独的`powershell.exe -NonInteractive -File`启动，拒绝复用交互shell或dot-source。成功结算是最终提交点，不采用事后撤销或退款。
- 原始数据和备份、源码快照、日志、pending、报告及编译临时目录均在研究目录；以4 KiB分配单位计数，并预留32 MiB宿主/元数据空间。单文件仍≤8 MiB。写入前预记分配量，恢复先全量重新核对，不能靠新进程把磁盘占用归零。正式总上限16 GiB，每次开始至少20 GiB可用。
- 工程模式固定2组、160个trial向量，正式种子之外的3026102603/3026102604；时间更严限为120秒、磁盘128 MiB，内存仍不超过512 MiB。没有任意改帧数、扩大资源或转换工程数据为正式数据的参数。

全部编排、两能量口径、各帧和审计均串行执行，不增加CPU并行度。OS及磁盘故障导致停止时，保留可核对的提交前缀；不发布固定样本推断。备份位于同卷，仅用于完整性核对，不是异地容灾或防恶意修改认证。

### 目录发布与资源扫描同步

资源守卫续租时递归统计磁盘占用；运行器提交批次时会将`pending`目录原子改名到`groups`。这两步以前可能交错：扫描列出旧目录后它被移动，`Get-ChildItem`因此抛出`DirectoryNotFound`并安全终止会话。现在两者共用`coordination/publication.lock`独占标记，标记写入并flush后才进入临界区；扫描期间不发布，发布期间不扫描。等待超时、路径异常或真实I/O错误仍停止，不吞掉错误或忽略目录。运行器的逐文件写入前预记、守卫的资源账与上限保持不变。

标记位于研究目录内，占用已包括在32 MiB元数据预留中。独立审计器和运行器空间扫描对该唯一短暂标记先验证普通文件及不超过1 KiB，再排除其可消失路径，避免新的遍历竞态；其他文件仍照常计量。持锁进程异常退出可能留下标记；新宿主仅在取得原`run.lock`、校验资源链后，核对标记会话与账本PID、确认该PID已不存在，才移除可核验的遗留标记。标记损坏、进程仍存在或无法验证时拒绝恢复并保留证据。崩溃恰在标记创建后、内容写完前可能留下不可核验标记，需要人工依据账本和进程状态处理；不会自动猜测或删除。

该修复改变研究工具字节身份，不改数学内核或冻结协议。既有Manifest继续绑定原工具版本：旧归档应使用归档中的原审计器只读验证，不可将新工具冒充原工具续跑或覆盖历史研究。首次正式研究中异常会话没有封存最终生命周期内存峰值，该证据缺口不会因修复而补齐。

## 独立审计与报告

启动和恢复先完整验证归档；每个新组独立验证新原始数据和直接前驱；结束时再次完整验证全部原始文件、备份、源码和资源账，避免逐批重复扫描所有历史原始结果。Python不导入生产TS，也不使用其summary或区间。

审计器独立重建协议hash、SHA-256随机角色域、xoshiro状态与Rayleigh频响，并按直接DFT核对期望CP能量、N0、各帧信道能量、实虚部插值偏差和导频噪声项；检查同CSI的ZF/MMSE硬判决计数一致。它不重新仿真每个noisy接收波形；完整FFT/FIR/小矩阵/接收器数值正确性由既有独立Python参考与边界测试覆盖。

主分析只生成预先指定的32行，每行F相同。擦除给出每帧误码上下界，再计算配对差上下界；没有将80帧区间合并为36,000帧区间。只有完整36,000向量、所有完整性检查和成功原生结算同时成立，才发布95%同时区间。计算进程退出前的候选报告明确为待结算；宿主仅在成功退出后封存最终报告hash，独立审计再逐项重算核对。工程/部分/资源失败只输出描述结果，区间字段为null。

EVM/MSE不套用BER的有界区间；失败数量和分母保留。EVM分位数用固定log10步长1/32的直方图区间表示，零、下溢和上溢明确列出，不伪装为精确分位数或置信区间。MSE存在未知/溢出时返回null，不静默删除极端样本。

## 操作入口

以下命令从`react-app`执行。先将`SIGNALLAB_PYTHON`设为已安装、可读取的真实Python可执行文件路径；Windows Store执行别名不能用于可执行文件SHA冻结。不要安装新依赖或自动修改系统权限。

```powershell
# 固定工程预检；目录必须是新的唯一名字，或明确恢复同一研究。
npm.cmd run prepare:ofdm-study -- -Action preflight -Directory ../output/signallab-v13-study-preparation/my-check
# 请求安全中断（在另一终端）；不会清理用户数据。
npm.cmd run prepare:ofdm-study -- -Action request-stop -Directory ../output/signallab-v13-study-preparation/my-check
npm.cmd run prepare:ofdm-study -- -Action resume -Directory ../output/signallab-v13-study-preparation/my-check
& $env:SIGNALLAB_PYTHON -I -B scripts/ofdm-study-audit.py ../output/signallab-v13-study-preparation/my-check --report

# 只准备正式Manifest，不运行正式帧。
npm.cmd run prepare:ofdm-study -- -Action prepare -Directory ../output/signallab-v13-formal-study/approved-study
```

正式执行是单独的`-Action formal`，同时承担正式恢复入口；必须提供独立授权文件，`approved`为true，精确匹配Manifest SHA、冻结协议SHA、36,000向量和确认声明。该文件本轮不创建。原始源码字节指纹必须等于冻结预算的`b9deff…`，不自动归一化或改写内核来通过检查。研究路径的所有祖先均不得是reparse point或卷挂载点；控制请求与归档路径严格校验会话GUID、相对路径白名单和目录reparse/junction，损坏字段不能导致目录外写入。

供未来审核的模板仅示意，默认拒绝，不能用于启动：

```json
{
  "approved": false,
  "manifestSha256": "<prepare输出的精确SHA>",
  "protocolSha256": "e9654ff6b2dcd4e733afccc543af3bc99fdc03431a19e13399d637389b0ddaf4",
  "fixedTrialVectors": 36000,
  "statement": "I authorize this exact 36000-trial study within its frozen resource limits."
}
```

完整归档可用其中`source/scripts/ofdm-study-audit.py`和匹配Python只读审计，校验工具自身源码字节。复核本身不新增研究样本；不要把单独拷出的报告文件视为已通过原生资源结算，须同时核对Manifest、检查点和资源链。SHA链不能防止攻击者重写整份未外部锚定的归档，需另存Manifest/最终head与审批记录。

## 启动条件与未验证项

启动前须核对当前PR CI、Windows本地原生测试、准备Manifest身份、可用空间和剩余资源账；然后等待用户单独批准精确Manifest。若源码/运行时改变，旧记录仍可独立审计，不能直接拼接执行。

[本轮工程预检摘要](signallab-v13-study-preparation-validation.json)记录了两组工程样本的内存、时间和磁盘估算；它们不是正式研究结果，也不能保证完整运行一定在预算内完成。

本轮没有测试真实36,000帧/900批连续运行、真实2小时耗尽、掉电或磁盘硬件故障，也没有正式结果。小规模故障注入与保守资源预测不能保证一定在预算内完成；触顶必须停机保留前缀。硬杀发生在元数据双写本身时可能留下不一致尾部，此时拒绝恢复/推断，需依据原始备份和外部锚点处理，不能自动删除坏尾部继续。正式数据不得上传公开仓库，生产Supabase/RLS/Auth和用户记录保持不变。
