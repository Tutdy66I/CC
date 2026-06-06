# 任务：创建一个 React TodoList 组件

## 要求

在 `react-app/src/components/` 下创建 `TodoList.tsx` 和 `TodoList.css`。

### 功能
1. 顶部一个输入框 + "添加" 按钮
2. 下方列表展示所有待办项，每项有：
   - 复选框（勾选=完成，文字加删除线 + 变灰）
   - 删除按钮（点击删除该项）
3. 底部显示 "共 X 项，Y 项未完成"
4. 空输入不允许添加
5. 数据用 `useState` 管理，不需要持久化

### 道具 (Props)
- 无，组件完全自包含

### 技术要点
- TypeScript 严格模式
- 函数组件 + hooks
- CSS 文件与组件同目录
- 样式干净简约，用 CSS 变量（参考 index.css 里的 `--text`, `--text-secondary`, `--bg` 等）
- 每个待办项要有 `id: string`, `text: string`, `done: boolean`

### 集成到 App
- 在 `App.tsx` 中导入 `<TodoList />`，放在 `</section>` 后、`<ContactForm />` 之前
- 替换 App.tsx 中已有的 counter 按钮那一整段（保留 hero 图片部分）
