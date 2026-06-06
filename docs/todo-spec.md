# TodoList 组件 — 已完成 ✅

## 实现文件

- `react-app/src/components/TodoList.tsx`
- `react-app/src/components/TodoList.css`

## 功能
1. ✅ 顶部一个输入框 + "添加" 按钮
2. ✅ 下方列表展示所有待办项，每项有：
   - 复选框（勾选=完成，文字加删除线 + 变灰）
   - 删除按钮（点击删除该项）
3. ✅ 底部显示 "共 X 项，Y 项未完成"
4. ✅ 空输入不允许添加
5. ✅ 数据用 `useState` 管理，不需要持久化

## Props
- 无，组件完全自包含

## 技术要点
- ✅ TypeScript 严格模式（`useRef` 代替模块级 `let`）
- ✅ 函数组件 + hooks
- ✅ CSS 文件与组件同目录
- ✅ 样式自包含，硬编码颜色值 + dark mode 支持
- ✅ 每个待办项有 `id: string`, `text: string`, `done: boolean`

## 集成
- ✅ `App.tsx` 顶部导航栏可切换 Blog / Todos
- ✅ Blog 和 Todos 在同一 App 中共存
