# 方案 A 公开合成实验阶段一预登记

基线为 `49953adbd335f63aaec7fbf1be698955ea0a2e4b`。本文件与[依赖锁](signallab-v15-witness-stage1-dependencies.md)补充 [PR #35](signallab-v15-synthetic-witness-protocol.md)。冲突处以本文件为准。范围仅为公开合成夹具。阶段一固定字节构造与判定规则，阶段二须单独授权后才能物化新签名和运行实验。

## 响应与优先级

每次验证输出恰有一个终态和一个主理由。按下表从上到下执行，命中即停。步骤 4–7 的前提是已核验独立输入提供的链，并根据受信撤销策略完成候选 P/R 校验。候选存在明确错误时，版本超前或缺 W 不能覆盖该错误。超前版本可在仅缺独立确认时返回 `unverified`，两种状态均禁止推动检查点或接受候选。

| 顺序 | 条件                                                                     | 状态 / 退出码 / 理由                                                                                                      |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 0    | 程序异常、崩溃、超时、运行时不匹配或预登记材料生成失败                   | `tool-error` / 70；中断工作流。非正常结束时保留真实 OS 退出或信号                                                         |
| 1    | 收据、可信摘要、可信链、外部状态头或对应本地记录缺失、损坏或无法交叉核对 | `unverified` / 2 / `trust-unavailable` 或 `state-unavailable`，先判信任再判状态；降代返回 `revocation-rollback`           |
| 2    | 外部管理器持有有效冻结态                                                 | `reject` / 1 / `frozen`，保存请求摘要供复核                                                                               |
| 3    | 候选有可验证错误                                                         | `reject` / 1。候选目录缺声明等基本对象为 `candidate-incomplete`。其他错误按子顺序判定，见下文                             |
| 4    | 同 stream 同序号存在不同声明，可信历史与候选的 P/R 均获授权且验签有效    | `reject` / 1 / `fork`，输出两条证据的身份。是否附 W 不影响此项                                                            |
| 5    | 某签名序号早于撤销截止，但归属尚缺独立固定的撤销前检查点证明             | `unverified` / 2 / `cutoff-unproven`。只有满足本条件才可暂缓判断，不得跳过已确认的撤销                                    |
| 6    | 候选序号等于锁定检查点，但提交内容缺 W 签名                              | `reject` / 1 / `missing-w`                                                                                                |
| 7    | 当前请求中的候选序号低于锁定序号，或声明超前                             | 低序号 `reject` / 1 / `rollback`，即使缺 W。超前且仅缺独立确认 `unverified` / 2 / `ahead-unconfirmed`，W 缺失或有效均适用 |
| 8    | 历史模式，候选序号在锁定检查点之内且与受信链一致                         | 齐全且复核通过 `historical-verified` / 3 / `history-valid`，缺 W 则 `reject` / 1 / `missing-w`                            |
| 9    | 当前模式且候选与锁定检查点完全一致，完整证据通过                         | `accept-current` / 0 / `current-valid`                                                                                    |

步骤 3 按以下子顺序处理。先做严格字节、键集和类型校验 `invalid-format`。算法和角色字段先检查字符串形态，再作语义校验。之后依次检查 P/R 必需签名 `missing-p`、`missing-r`，算法 `unknown-algorithm`、角色 `wrong-role`、密钥绑定 `unauthorized-key`，授权区间 `role-out-of-range`，撤销截止 `revoked-key`，签名目标 `signature-target-mismatch`，验签 `bad-signature`，原始对象存在性 `candidate-incomplete`，原始对象长度及摘要 `object-mismatch`，ZIP 内部结构和逐成员一致性 `archive-invalid`，最后检查版本前序与所用授权表的绑定 `chain-mismatch`。前序校验允许同一可信父声明的不同子声明，以便步骤 4 检测分叉。若同项发现多角色失败，按 P、R、W 排序。候选缺 W 封套可暂缓至匹配步骤，独立信任链缺 W 则属于步骤 1。超前夹具只登记紧邻已锁定检查点的一步，使用前一声明和前一检查点的准确摘要。步骤 1 验证可信链的完整性和当时签名；步骤 5 将当前撤销表应用于候选及其前序。授权截止无法证实时不能形成已认证分叉证据。

## 独立收据、交付及撤销

`receipt.json` 使用 PR #35 的 JCS 子集。它与收据 SHA-256 从独立渠道预交付。复核器的预期摘要必须来自该渠道的只读本地记录。字段集封闭，任一未列出字段皆不合法。表中“摘要”均指对象原始字节 SHA-256 的小写 64 位十六进制。序号、代数均为正安全整数。

| 字段                                                     | 类型与绑定                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`, `kind`, `scope`, `stream`                     | 整数 1，固定字符串 `receipt`、`synthetic-only`、`signallab-v15-witness-a`                                                                                                                                       |
| `receiptId`, `issuer`, `recipient`, `channel`            | 分别为 `receipt-[0-9]{3}`、`W`、`independent-reviewer`、`synthetic-out-of-band`                                                                                                                                 |
| `mode`, `deliveryOrder`                                  | `current` 或 `historical`。对象键恰为 `trust`、`candidate`，值分别固定为 1、2                                                                                                                                   |
| `trustConfigSha256`, `rosterSha256`, `revocationsSha256` | 摘要。后两项还须与 `trust` 中字段逐一相等                                                                                                                                                                       |
| `revocationEpoch`, `checkpointSequence`                  | 整数。分别与 `trust.revocationEpoch`、`trust.expectedSequence` 相等                                                                                                                                             |
| `checkpointSha256`, `declarationSha256`                  | 摘要。前者与 `trust.expectedCheckpointSha256` 相等，后者与该检查点中的声明摘要相等                                                                                                                              |
| `checkpointEnvelopeSha256`                               | 独立交付的 W 签名封套原始 JCS 摘要，同时校验封套角色与签名                                                                                                                                                      |
| `previousReceiptSha256`                                  | 首次交付为 null。更新时链接独立登记的同一验证环境上一收据                                                                                                                                                       |
| `cutoffReceipts`                                         | 数组，按 `keyId` 字节序递增且唯一。对象恰有 `keyId`、`receiptSha256` 两个摘要。链接撤销前已独立登记的收据，旧收据须绑定撤销表中对应 `lastTrustedCheckpointSha256`，检查点序号须为 `firstDisallowedSequence - 1` |

W 布置公开夹具后，复核方先核对审查通道提供的收据及其预期摘要、授权表、撤销表、完整声明和检查点链，再记录接收事件 1。此后才在另一只读目录接收候选并记录事件 2。交付记录必须体现真实操作顺序。每个交付日志是含两条 JCS 对象的数组，条目键恰为 `order`、`role`、`fixtureId`、`objectSha256`。第一条为序号 1、W、`fixture-1`、收据摘要，第二条为序号 2、P、`fixture-1`、候选提交清单摘要。该提交清单是列出收到的候选文件名和原始长度、SHA-256 的 JCS 对象，以相对路径为键，值恰含 `byteLength` 和 `sha256`。阶段二的两个目录和独立复核工具仅模拟逻辑隔离。

撤销更新必须独立交付，首次测试从代数 1 设立可信底线。更新的代数恰为既有代数加 1，`previousReceiptSha256` 精确链接既有收据，绑定值和外部登记均须吻合。旧代数即使自洽也返回 `revocation-rollback`，同代不同摘要、错序或跳代返回 `trust-unavailable`。同一代数使用不同验证模式的收据只作为预登记的隔离用例，复用同一已固定撤销表和检查点链，不能作为运行时更新。历史请求使用最新撤销表和可独立证明的旧检查点。若新策略使较晚链条不能成立，须通过预置的历史模式收据复核旧检查点。

## 分叉与持久化冻结

只读验证器只生成判定和分叉证据。分叉报告是 JCS 对象，键为 `version`（1）、`kind`（`fork-report`）、`stream`、`sequence`、`receiptSha256`、`checkpointSha256`、`trusted`、`candidate`。最后两个对象各含 `declarationSha256`、`pEnvelopeSha256`、`rEnvelopeSha256`，均为原始字节摘要。外部状态管理器须独立复核这些材料才建立持久化冻结记录。在复核和持久化完成前，协调者持有该 stream 的锁并阻止接受、发布和检查点推进；状态不可读时返回 `unverified`。后续进程从外部可信状态头读取 stream 的最小代数及记录摘要，重新验证本地文件后才能处理请求。只读 `fork` 输出本身不能证明持久化已成功。

合成实验使用 Linux 本地临时目录及独立提供的第二目录模拟状态头。成功登记的初始状态为 `active`、代数 1。状态记录采用相同 JCS 子集，字段恰为 `version`（1）、`kind`（`freeze-state`）、`stream`、`generation`（正安全整数）、`previousStateSha256`（首项 null）、`state`（`active` 或 `frozen`）、`forkReportSha256`、`releaseApprovalSha256`（初始均为 null，冻结时前者为摘要，解冻时两者都保留摘要）。状态头字段恰为 `version`（1）、`kind`（`freeze-head`）、`stream`、`generation`、`stateSha256`。状态头同样须由受信通道固定摘要。

管理器只追加状态记录，持有排他锁，将新文件写入同目录临时文件，刷新文件，原子更名并刷新目录。独立状态头也按原子替换顺序发布并刷新。协调者须在开始可推动检查点的验证前登记持久事务意图，至少绑定当前状态头和请求摘要。无分叉时在完成验证后结清，确认分叉时仅于冻结记录和新头核验后结清。启动时读取受信状态头及事务意图，逐项核对登记的记录与链。磁盘多出尚未提交的较新代数、未结清意图、记录或头缺失、摘要错误、旧状态重放均阻断。崩溃窗口内不自动回退到旧 `active`，尤其禁止因目录为空自建初始状态。无法证明文件系统的原子性及刷新语义时不执行写入阶段。若本地记录与受信外部状态头同时被一致回滚，实验不能检测。这里的状态头隔离只通过模拟实现。

解除冻结须另行明确授权。人工决定必须绑定 stream、冻结记录 SHA-256、分叉报告 SHA-256、采用的检查点 SHA-256、被拒绝的声明 SHA-256、下一代数和理由，并由独立通道登记该决定的摘要。状态管理器核对授权后追加 `active` 记录，保留分叉证据和旧冻结记录。阶段二只测试缺授权时拒绝解除；它不授权实际解除记录或修改既有检查点。

## 固定字节的构造

1. 基准 B0 使用已合入的 `react-app/scripts/v15-synthetic-independent-ci.py` 引用的 `fixture()` 与 `create()` 所定义的三件对象。基准 ZIP、manifest、anchor SHA-256 依次为 `de3ba299c5f9eaec7053eb2aa957d2e14d5ae536ac510d23c85e881471c350a3`、`a930dbdc0239976a993c966fde86c1e15a964210c1920fcb5d224f6838c1c0c8`、`70e0a3aa17a7cfa38a1ecbfa4490b237b4bd1a5ba31e0603a0f8aebcf5d60777`。替代 B1 固定为同一生成器仅先令 `audit/stderr.txt = ASCII("replacement")` 后再生成，沿用 PR #33 的负例规则。若 B0 无法得到登记摘要，停止。原始长度一律为实际字节数。
2. P、R、W 分别使用 RFC 8032 §7.1 的 TEST 1、TEST 2、TEST 3 的 `SECRET KEY` 和 `PUBLIC KEY` 字节，只使用标准公开向量。替代授权表 T 使用 TEST 1024、TEST SHA(abc)、TEST 1，依次赋给 P、R、W。正常及替代授权区间均为 1–3。H 的越权子例单独使用 P 的区间 1–1，完整重新绑定并预先交付该夹具收据。密钥 ID 按 PR #35 计算。
3. 基线声明 D1、D2 使用 B0，紧邻超前声明 D3 使用 B0，分叉声明 DF2 与 D2 同序号同前序且使用 B1。替代序列 T1、T2 使用 B1 和授权表 T。所有声明使用 PR #35 的固定常量，`sourceCommit` 为本文基线，`dependencyInventorySha256` 为本提交依赖锁文档的 Git blob 原始字节 SHA-256。检查点 C1、C2、C3 及 T 对应检查点遵守 PR #35 的前序绑定。声明字段值及签名输入均由固定规则唯一决定，纯 Ed25519 确定性签名的具体输出留待阶段二。
4. 基线撤销代数 1、条目为空。撤销用例在一个全新的逻辑环境先独立登记绑定 C1 的旧收据，再独立交付代数 2，撤销条目每次只涉及一个角色，`reason` 固定为 `compromised`，`firstDisallowedSequence` 为 2。正常截止绑定 C1；缺截止用例设 null 且 `cutoffReceipts` 为空。一般用例以当前模式锁定 C2；F 的历史子例同样锁定 C2，以历史模式验证 D1。H 的截止前子例保留已独立登记的序号 1，代数 2 的历史收据锁定 C1；H 的截止后子例同样锁定 C1，提交 D2，明确撤销优先于超前。
5. 每个用例有独立目录。收据 ID 从 `receipt-001` 开始按该例交付顺序递增。正常、替代与明确持久状态子用例的信任输入在接触候选前分别固定并记录。缺字段、删封套或修改值的操作仅应用到指定对象；除明确要求重新绑定、重新签署的步骤，其余字节完全沿用该例基准。翻转字节使用 XOR `01`，位置从零起算。签名封套本身均按严格 JCS 输出，原始篡改用例除外。

## 预登记矩阵

状态缩写仅用于表格，`AC`=`accept-current`/0，`R`=`reject`/1，`U`=`unverified`/2，`HV`=`historical-verified`/3。除指定情况，每个用例使用未冻结的初始状态及基线 D2/C2。阶段二按此表执行每个列出的子例；在看到输出后修改输入或判据会使本登记版本失效。

| 用例    | 固定输入及操作                                                                                                                                                                                                                 | 预期状态、退出码对应理由                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| A1      | B0、D2/C2、完整 P/R/W 和独立收据                                                                                                                                                                                               | AC `current-valid`                                                                                                  |
| B1–B4   | 依次删 D2 的 P、R、C2 的 W、候选外部 manifest；每次独立运行                                                                                                                                                                    | R，依次 `missing-p`、`missing-r`、`missing-w`、`candidate-incomplete`                                               |
| B5–B6   | B5 同时删 C2 的 W 与 manifest。B6 提交 D3/C3，删其 W 与 manifest                                                                                                                                                               | 两例 R `candidate-incomplete`                                                                                       |
| C1–C5   | C1 将 P 封套的角色换为 W，仍放在 P 槽。C2 将 P 封套的 ID 换成 T 的 P。C3 将 P 封套目标摘要换为全零。C4 将 P 算法改为 `Ed448`。C5 将 P 签名字节 0 XOR `01`                                                                      | R，依次 `wrong-role`、`unauthorized-key`、`signature-target-mismatch`、`unknown-algorithm`、`bad-signature`         |
| D1–D6   | 按 ZIP、manifest、anchor 顺序各做一例字节 0 XOR `01`，再按同顺序各做一例删末尾 1 字节。沿用原声明                                                                                                                              | R `object-mismatch`                                                                                                 |
| E1      | B1、T2、替代普通预期摘要与 T 的全部封套，经语法正确的替代声明重绑定；独立收据、可信配置和检查点仍为原件。候选槽位不随替代包切换 roster                                                                                         | R `unauthorized-key`，先核角色与授权根，再核候选 roster 交叉引用                                                    |
| E2–E3   | D3/C3 按原授权签署。E2 删候选 C3 的 W。E3 保留 W，两例均无预置 C3                                                                                                                                                              | 两例 U `ahead-unconfirmed`                                                                                          |
| E4      | D3/C3 使用 W 封套，但其签名字节 0 XOR `01`                                                                                                                                                                                     | R `bad-signature`                                                                                                   |
| F1–F3   | F1 当前模式提交 D1/C1。F2 以预置历史模式收据提交同件。F3 重复 F1 但删除候选 C1 的 W                                                                                                                                            | F1、F3 为 R `rollback`；F2 为 HV `history-valid`                                                                    |
| G1–G2   | DF2 分叉声明使用 B1，保持原 C2 为可信记录，候选不提供 W。G1 提供完整有效 P/R。G2 将分叉 R 签名字节 0 XOR `01`                                                                                                                  | G1 R `fork` 且产生双声明报告；G2 R `bad-signature` 且无冻结事件                                                     |
| G3–G9   | G3 持久化 G1 记录并重启后用 A1 输入。G4 在记录已落盘、状态头发布前中断，重启。G5 删除冻结记录。G6 冻结记录字节 0 XOR `01`。G7 删除状态头。G8 用代数 1 状态头替换当前头，保留独立代数 2 登记。G9 在冻结态发起解除，授权文件缺失 | G3 R `frozen`；G4–G8 U `state-unavailable`；G9 控制接口 R `release-authorization-missing` 且随后 A1 仍为 R `frozen` |
| H1–H3   | 撤销条目分别指 P、R、W，提交含相应序号 2 签名的 D2/C2                                                                                                                                                                          | R `revoked-key`                                                                                                     |
| H4      | P 的授权区间 1–1，独立收据锁定本夹具的 C1，提交已按本授权表重绑定、签署的 D2/C2                                                                                                                                                | R `role-out-of-range`                                                                                               |
| H5–H6   | 代数 2 撤销 P，在预置历史模式下提交 D1/C1。H5 有独立绑定 C1 的截止收据。H6 依前节构造无截止证明的代数 2                                                                                                                        | H5 HV `history-valid`；H6 U `cutoff-unproven`                                                                       |
| H7–H9   | H7 保留已登记代数 2，重新交付代数 1。H8 在已知代数 2 交付同代不同撤销表（将 P 条目的 `reason` 改为 `retired` 并更新替代收据摘要绑定）。H9 直接从代数 1 跳到 3（仅改代数及相应摘要绑定）                                        | H7 U `revocation-rollback`，H8、H9 U `trust-unavailable`                                                            |
| H10–H12 | H10 候选正常，删可信 C2 的 W。H11 候选正常，替换独立收据字节 0，保留原预期摘要。H12 候选正常，提交两件事件次序颠倒的交付日志                                                                                                   | U `trust-unavailable`                                                                                               |
| I1–I2   | 完整替换为 B1、T1/T2 及其整套信任配置。I1 固定原独立收据摘要而替换收据。I2 预先另存替代配置的收据摘要并以隔离验证环境启动                                                                                                      | I1 U `trust-unavailable`；I2 AC `current-valid` 仅相对于替代环境，实验结论为信任边界复现                            |
| J1–J12  | 在 D2 原始 JCS 上单独执行以下 12 个字节变异，沿用原签名                                                                                                                                                                        | R `invalid-format`                                                                                                  |

E1 的受信检查点链验证使用原件。对候选而言，先比较封套的 key ID 与受信角色授权，仍依法校验候选 roster 与所宣称授权表的交叉引用；两者都错时使用 `unauthorized-key`。G2 的 R 主理由不受候选缺 W 影响。

J1–J12 按顺序固定为向根对象首个左花括号后插入 ASCII 片段 `"version":1,`；向 `signers` 对象首个左花括号后插入 ASCII 片段 `"\u0050":"x",`（字节含反斜杠）；在根对象同一位置插入 `"unknown":0,`；将 `"sequence":2` 改为 `"sequence":"2"`；将其值改为 `9007199254740992`；改为 `-0`；把根对象第一个成员移至最后且保持合法逗号；尾部追加十六进制 `0a`；前置 `efbbbf`；前置 `ff`；将 `fixture-1` 替换为 ASCII 字节 `\ud800`；前置 ASCII 空格。另登记 J13，在候选 C2 中将前序检查点摘要设为 64 个 `0` 并重签 W，预期 R `chain-mismatch`。

## 独立复核与证据清单

实现阶段须提供两个只读验证入口。两者均接受明确的模式、只读候选目录、独立信任目录、预置收据摘要及状态快照引用。主入口使用锁定的 Python JCS 和 Node 签名接口，独立入口用 Go 复核签名、受限 JSON、摘要、ZIP 和确定性判定。实现分开且不共享解析器、判定代码或状态模拟器。对于 G3–G9，独立入口核对冻结记录、独立头和操作事件，再复核判定；外部状态写入由受授权管理器完成。使用相同源字节对比退出码、状态、理由、原件摘要和分叉事件。一次仅执行预登记用例，任一工具错误或证据不足停止且保留记录。

每个用例目录含 `input/`、`trusted/`、`messages/`、`results/primary/`、`results/independent/`、`state/`。保存送达的 ZIP、manifest、anchor、声明、签名前字节、所有提交的签名封套及公开向量身份、授权表、检查点、收据、预期收据摘要、撤销材料、交付事件、冻结前后记录与状态头、重启和中断操作证据。缺失对象通过清单列出预期缺失路径，不创建替代空文件。两入口分别保存原始 `stdout.bin`、`stderr.bin` 和 `process.json`，后者字段为 `exitCode`（整数或 null）、`signal`（字符串或 null）、`timedOut`（布尔值）。结果 stdout 采用一条 JCS 记录，含 `version`、`caseId`、`status`、`reason`、`receiptSha256`、`declarationSha256`、`forkReportSha256`，前三种摘要字段按可用性为十六进制或 null。进程异常由外层记录工具错误。

批次根目录含预登记提交与文件摘要、运行时及环境身份 JSON、两入口与管理器源码身份、公开依赖文件与摘要、用例输入构造清单、逐例实际与预期对照，以及 `SHA256SUMS`。摘要文件按相对路径 UTF-8 字节顺序排列，每行 `<sha256><两个 ASCII 空格><路径><LF>`，覆盖根目录中除该文件自身外的全部原件。路径限 ASCII 无空格、无重复或逃逸，按原始字节取哈希。阶段二另行记录清单本身的摘要与授权 ID，便于独立复核。实验不产生真实来源认证、长期保管或跨机器恢复的验收结论。

## 阶段一停止点

审查人须核对本提交 Git 身份、预登记 SHA-256、源材料和依赖锁。在另行授权后，先仅物化输入并登记全量原始输入和受信材料摘要，再开始验证用例。阶段二的实施与工具链实际验收尚待批准。阶段一不接入实验 CI，也无任何实验执行结果。变更规则、依赖身份、输入构造或预期结果须另行登记并复审。
