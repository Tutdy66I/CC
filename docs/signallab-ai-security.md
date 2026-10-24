# SignalLab AI Node 安全启用

本轮实现默认鉴权、账号白名单、同机多进程共享限流、保守费用预留和有界响应。
Pages 的 AI 仍禁用；登录不等于开通付费调用。本文件不表示公网 AI 已部署。

## 服务端配置

模型的 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY` 继续只放服务端。
另外设置以下服务端环境变量，缺项时拒绝调用：

| 变量                        | 含义                                                  |
| --------------------------- | ----------------------------------------------------- |
| `SUPABASE_URL`              | 与前端一致的 HTTPS 项目 origin                        |
| `SUPABASE_PUBLISHABLE_KEY`  | 此项目的 publishable key，不使用 service_role         |
| `AI_ALLOWED_USER_IDS`       | 获准使用的用户 UUID，逗号分隔，不能使用 user_metadata |
| `AI_BUDGET_DB`              | 本机持久卷内 SQLite 文件的绝对路径，父目录预先创建    |
| `AI_DAILY_BUDGET_MICRO_USD` | 全服务每日预算，正整数微美元，UTC 日期切换            |
| `AI_MAX_REQUEST_MICRO_USD`  | 单次最坏费用的保守上界，正整数微美元                  |

客户端把当前 session access token 放入 Authorization。服务端先检查目标项目、
audience、expiry，再经 Supabase Auth `getUser(jwt)` 验证；不信任自己解码的
claims 或浏览器 getSession 的用户信息来鉴权。允许列表在服务端执行。
参考：[Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)。
访问令牌仍受其有效期约束；local sign-out 不是立即撤销所有已签发 JWT 的保证。
公网敏感部署还需短令牌寿命、服务端会话撤销验收及 TLS 网关。

## 预算与部署限制

SQLite `BEGIN IMMEDIATE` 在同一事务内检查并预留用户每分钟10次、IP每分钟30次
和全服务日预算。进程重启不清空；多进程必须使用同一个本地文件和一致配置。
文件仅保存哈希用户/IP、时间段和计数，不保存 token、prompt 或模型答案。
依赖 Node 24 的 [node:sqlite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)。

每次调用先永久扣除配置的最坏费用上界。供应商拒绝、断线或超时时不退还，
避免“失败但已计费”造成超支；这是保守结算，不是供应商实际账单对账。
运营者必须按模型价格、64KB请求上限、系统提示、输出/推理计费规则确定上界，
并在供应商侧设硬预算。不能随意填写一个金额并认为它限制了真实供应商账单。
修改价格、模型或推理模式后必须重新核对上界。未配置这些值就保持拒绝服务。

只支持单台主机的本地持久磁盘，不支持独立文件的多主机副本、临时盘、NFS共享。
多主机部署需要换成具备原子事务的共享计费服务；不能各建一份 SQLite。
预算数据库丢失、只读、锁超时或异常都会拒绝模型调用。备份预算库时需保持
运行实例一致，不能恢复旧计数后继续当天调用。数据库应存于 dist 以外，设最小
文件访问权限；不要将其加入 Git。每日费用不包含隔日恢复旧库等管理员操作。

仍保留全进程2并发及读取前的IP粗限流。不会信任任意 X-Forwarded-For，
代理后的用户可能共享IP额度；公网网关需单独配置可靠的边缘限流和源地址边界。
模型响应仅接受JSON，流式读取最多128KiB，45秒超时，答案最多12000字符。

## 本地开发

`npm run dev:deepseek` 显式使用 `AI_ACCESS_MODE=local`，同时要求socket回环地址与
Host为localhost/127.0.0.1/IPv6回环，沿用原有同源检查。此模式没有账号和持久
费用控制，仅供本人本机开发。生产脚本不会主动启用该模式。公网运行时必须
清除 `AI_ACCESS_MODE=local`，配置上面的身份与预算变量；Pages保持禁用。

## 验收

本地替身覆盖匿名401、过期/错项目/校验失败令牌、非白名单403、预算缺项503、
跨连接共享计数与预算耗尽429、超大供应商响应502。真实两账号JWT、公网网关、
供应商硬预算和第二物理设备验收仍需在指定测试环境执行，不能由合成JWT代替。
