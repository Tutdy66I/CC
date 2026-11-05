# v1.5 研究身份与随机派生：公开测试域原型

此阶段仅实现可复核的公开测试向量，不是正式研究协议、随机源或执行器。协议仍未冻结，确认性研究尚未获授权。

`src/research-v15r/publicTestRandom.ts` 只接受公开测试域 `0x7f`、内置公开测试密钥、两组假 protocolId、两组公开 experimentId 和四个公开 scenarioId；拒绝调用方根密钥、其他域及非法帧／角色／位置。它不生成 Box–Muller 噪声、载荷帧或确认样本。输出中的密钥完全公开，只是测试向量。验证和复制身份后才执行异步 HMAC，避免调用方在等待期间改写输入。

`src/research-v15r/publicTestIdentity.ts` 的 mock 身份函数仅接受六个内容固定为 `PUBLIC_TEST_ONLY:<name>\n` 的文件，其协议／manifest 摘要仅是 mock 向量；它不能计算或验证真实研究协议。其规范字节解析器也仅接受 `sl15-public-test-1` 测试 schema，不能当作六文件正式 schema 的验证器。上述限制是接口边界，不是 JavaScript 安全沙箱；未来正式适配器必须经单独审阅和授权设计。

`tests/fixtures/v15r-public-vectors.json` 为此前审阅的公开向量原样副本，SHA-256 为 `ddb6cabb4f21ba0f2ca674daf3ac8c829f1499872630a77fbac43570c8f538cb`。`scripts/v15r-public-vectors.py` 是独立 Python 实现；测试比较完整向量及 HMAC、四场景、均匀数边界，并检验重复键、编码、身份和域拒绝。它们不证明浮点接收路径的跨运行时等价，也不证明伪随机帧独立。

本阶段不创建正式六文件、确认性随机根、研究样本、检查点或研究数据。正式协议身份、数值误差／判决边界、历史随机材料不可比范围、独立执行器和备份恢复仍须另行审阅与验收。
