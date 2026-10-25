# v1.1 原归档的字节恢复

v1.2 不改写 v1.1 协议、结果、检查点或存储键。v1.1 的源码哈希包含整个
`src/lib/*.ts`，因此新增 v1.2 文件也会改变当前树的哈希；旧研究续跑使用隔离恢复副本。

只读调查在原仓库 git 对象中定位到提交
`fa2ae0167e6d6eabcc1585c215c044dea97732c9`。27 个源码文件不能全部按 LF 或
CRLF 检出：原研究生成于混合行尾工作目录。按恢复脚本中的逐文件规则重建后，
源码 SHA256 精确等于
`ac6924c19dae956fbc8d9faaf7d40d619d5f4579101f746cabab371c8cd52dc4`。

实际执行依赖为 23 个编译后的 lib JS 文件（不是所有 27 个源码文件），使用 LF。
Node `v24.16.0`、`win32`、`x64`，TypeScript `6.0.3` 的 ES2022/ESNext/Bundler
逐模块输出，加原 LF 研究脚本，运行时 SHA256 精确等于
`caef009297e0791b3b2300024c27efd5e8be98070b66a1565da35234d94bc6a5`。
这些两个精确匹配均已在只读、内存计算中验证；不是对当前树和旧归档哈希相同的承诺。

在 `react-app` 中执行只读核验：

```powershell
node scripts/restore-v11-reference.mjs
```

需要复现或继续旧研究时，显式指定本工作区内尚不存在的目标目录：

```powershell
node scripts/restore-v11-reference.mjs --write ../output/v11-reference
Set-Location ../output/v11-reference/react-app
node scripts/inspect-carrier-research.mjs
```

第二条命令必须从恢复副本的 `react-app` 目录执行，因为原审计脚本使用相对路径。
原 Node/平台/编译输出不匹配时脚本拒绝写入。恢复只复制旧源码、原执行 JS、
两份研究脚本与三份原归档，不复制账号、环境变量、密钥或云数据。
原始 v1.1 检查点可在该副本使用；改变旧协议、源码或运行环境必须另开研究目录。
哈希校验提供完整性证据，不构成外部真实性认证。
