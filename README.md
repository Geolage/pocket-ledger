# Pocket Ledger (小账本)

一个本地优先的个人收支记账应用：记录收入与支出、查看月度概览和消费趋势、设置分类预算。所有数据只保存在浏览器 `localStorage`，不连接银行账户，也不发起任何网络请求。

Pocket Ledger is a local-first personal income and expense tracker built with React, TypeScript and Vite. Demo data and user data stay in the browser; there is no backend, account connection or network request.

## 功能

- 记录收入/支出，支持分类、日期和备注，金额按分计算
- 编辑、删除记录；删除前必须二次确认
- 本月收入、支出、结余和预算剩余概览
- 消费分类环形图与每日支出趋势
- 按类型、分类、关键词筛选账单
- 分类预算、超支提示和预算进度
- L1 淡青瓷、L2 淡雾蓝、L3 淡灰绿三套主题
- 演示数据恢复、清空本地数据、旧存储键自动迁移
- 桌面与手机响应式布局

## 技术栈

- React 19、TypeScript、Vite 8、Tailwind CSS 4
- Radix UI / shadcn 风格组件、Lucide 图标
- Vite 静态构建，零后端、零外部请求
- 浏览器 `localStorage` 持久化
- Node 内置 test + Playwright 端到端测试

## 本地运行

需要 Node 22.13+（22.x）或 Node 24+；测试还需要本机安装 Google Chrome。

```sh
npm ci
npm run dev
```

构建与预览：

```sh
npm run build
npm run preview
```

## 测试

```sh
npm run test:unit   # 领域计算与校验：10 项
npm run test:e2e    # 桌面与手机交互：10 条
npm test            # 依次运行两部分
```

Playwright 使用 4175 端口和独立的浏览器上下文，不会读写本机现有账本数据。

## 数据与范围

- 存储键：`pocket-ledger.v1`；旧键 `xiaozhanben.v1` 会在首次读取时自动迁移。
- 演示账本使用固定种子生成，金额、商户和人物均为虚构；设置页可恢复演示数据或清空。
- 不提供登录、云同步或账户连接；金额和预算仅存在本机。
- 项目仅用于展示界面与交互，不构成理财或投资建议。

## 目录

- `src/`：应用、领域计算、主题、存储和业务组件
- `components/ui/`：项目实际使用的 shadcn 风格基础组件
- `scripts/`：Node 领域测试和构建脚本
- `e2e/`：Playwright 桌面/手机回归
- `vendor/`：带许可证的模板样式文件

## Attribution

Frontend starter and vendored shadcn stylesheet attribution are recorded in `PROVENANCE.md` and `vendor/`.

## License

[MIT](LICENSE) © 2026 Geolage Wu
