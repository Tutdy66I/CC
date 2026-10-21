# GitHub Pages 部署

目标仓库 `Tutdy66I/CC`，发布地址为 `https://tutdy66i.github.io/CC/`。
SignalLab 直达地址：`https://tutdy66i.github.io/CC/#/signallab`。

## 发布流程

仓库 Settings → Pages 的 Source 设为 GitHub Actions。
推送 master 后，`.github/workflows/ci.yml` 依次运行：

1. `verify`：全部单元/HTTP、Lint、TypeScript、生产构建、桌面/移动 E2E 和基准等价检查。
2. `pages-build`：以 `/CC/` 路径重新构建静态版；运行六项桌面/移动 Pages 冒烟测试，然后仅上传 `react-app/dist`。
3. `pages-deploy`：将通过验证的 artifact 发布到 github-pages 环境。PR 不部署。

静态版不包含服务端源码、加密密钥文件、环境变量文件或开发缓存。
Pages 构建只设置公开的 `VITE_STATIC_HOST=true`、资源路径与站点域名；不传入模型凭据。

## 功能边界

GitHub Pages 是静态托管，不能运行 Node API。
BPSK、QPSK、BER Worker 扫描、图表、报告下载、博客与本地待办可直接运行。
AI 助教与 RSS 外部订阅抓取需要独立 Node 后端；静态版显示说明，助教提问直接给出明确提示而不发送无效 API 请求。
现有 Node 版本的 AI/RSS 实现保留，默认构建不启用静态标记，仍使用原先同源 API。
不会将模型密钥嵌入前端来替代后端。

## 本地复现（PowerShell）

在 react-app 目录运行：

```powershell
$env:DEPLOY_BASE_PATH = '/CC/'
$env:VITE_STATIC_HOST = 'true'
$env:SITE_DOMAIN = 'tutdy66i.github.io/CC'
npm.cmd run build
npm.cmd run test:pages
```

验证实际站点：`$env:PAGES_URL = 'https://tutdy66i.github.io/CC/'` 后运行 `npm.cmd run test:pages`。
此时使用线上地址，不启动本地 preview。测试只运行本地实验、下载和静态提示，不调用模型。

返回正常 Node 构建前，删除上述四个本次部署变量或恢复原值，然后重新运行 build。
`Icon` 使用 `import.meta.env.BASE_URL`，确保公共 SVG 在仓库子路径下正确加载；Worker 和分块 JS 由 Vite base 自动处理。

参考：[GitHub 自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、
[Vite GitHub Pages 部署](https://vite.dev/guide/static-deploy.html#github-pages)。
