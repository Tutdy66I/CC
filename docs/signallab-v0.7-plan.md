# SignalLab AI v0.7 实施计划

范围：多种子统计验证、Worker 异常恢复测试、兼容依赖安全更新；本轮本地验收，发布单独确认。

1. 保留 v0.6 调制、判决、AWGN、随机数与单次扫描协议。新增独立统计 Worker，复用原计算函数。每个信噪比重复 5/10/20 次，种子按 `(base + trial * 10 + snrIndex) mod 2^32` 派生，三调制配对使用相同种子。
2. 显示实际完成重复次数、平均 BER、种子间样本标准差、最小/最大 BER。以完整 64 比特星座周期为有界独立噪声块，使用 Hoeffding 逐点 95% 保守区间；只在该行预定重复全部完成时显示，避免对取消后的可选停止样本声称固定样本覆盖率。说明伪随机模型假设、区间保守性与非同时置信带性质。
3. 验证聚合、零误码、种子回绕、工作量上限、复现性及原算法一致性。浏览器测试覆盖真实 Worker、部分结果取消、迟到消息、失败后重试。增加 Firefox/WebKit，保留桌面/移动 Chromium。
4. 先审计与 dry-run，再执行不带 `--force` 的 `npm audit fix`，由 npm 更新锁文件；检查测试、Lint、TypeScript、生产构建与 BER 基准。现有审计基线：7 项（6 high、1 moderate），均可在声明范围内修复。
5. 更新开发/用户文档，记录每个文件、验证结果和剩余限制，提交后进行独立代码审查并处理问题。

参考：[Hoeffding 1963](https://www.tandfonline.com/doi/abs/10.1080/01621459.1963.10500830)、[npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/)。
