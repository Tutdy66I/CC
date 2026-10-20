# SignalLab AI v0.2：BER 扫描

保留 v0.1 的波形实验；新增独立 BER 扫描组件、纯统计模块和模块 Web Worker，不修改博客、RSS、待办逻辑，不引入依赖。

- 固定扫描 −4、−2、0、2、4、6、8、10 dB，每点可选 10000、100000 或 1000000 比特。
- 使用交替 01 的平衡比特流，每点调用现有 BPSK / AWGN / 硬判决算法，与手动波形输入独立。
- 每点实际种子为 `(基础种子 + 点索引) mod 2^32`；结果保留样本量、种子、误码数、BER 和统计区间。
- 理论相干 BPSK BER 为 `0.5 * erfc(sqrt(10^(EbN0Db/10)))`；采用稳定的 erfc 数值近似，并以参考值测试。
- 非零误码使用双侧 95% Wilson score 区间。零误码使用精确单侧 95% 上限 `1 - 0.05^(1/N)`，不是 BER 为零的结论。
- SVG 对数纵轴显示理论曲线、实测非零点和区间；零误码以单独的向下三角标注上限，不接入实测折线。
- 表格保留实测 0 和区间类型。每次运行显示参数快照，计算期间禁用扫描参数，逐点回传进度。
- 取消保留已完成点并标注未完成；重新运行清空旧结果；卸载时终止 Worker；失败显示错误并允许重试。
- 验证：理论参考值、区间参考值、零误码上限、种子复现、与原有链路一致性及统计容差；浏览器检查运行、取消、重跑、导航和窄屏。

数学依据：[MathWorks 相干 BPSK 理论 BER](https://www.mathworks.com/help/comm/ug/analytical-expressions-used-in-berawgn-function-and-bit-error-rate-analysis-app.html)、[NIST 二项比例置信区间](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)。区间逐点计算，不代表整条曲线的同时置信带。
