# Agent Note: Web 工作区文件浏览器——Remote list/read 网关 + `sidebar.files` 树 + `files` 查看器列

Status: implemented

[English](2026-08-17-web-sidebar-workspace-file-explorer.md) | 中文

## 问题

Web GUI 把会话按工作区分组展示，但没有项目文件表面：把项目文件夹添加为工作区后，用户无法在 harness 内查看其文件，必须切到外部编辑器才能看到 agent 正在改动的代码。侧栏只有一个内容区域（`sidebar.workspaces`）加设置脚座；除选择器那套只列目录的 `host.listDirectory`（只列出可进入的目录、从不返回文件内容）之外，也没有 host 侧文件浏览 RPC。

## 决策

在现有 Web 组合上增加一个双包能力：host Remote 网关提供目录列表与有界文本读取，侧栏树占位组件，以及应用框架中一个专用的可缩放查看器列。

### Host 网关：`dsh-host-workspace-files`

`WorkspaceFilesGateway` 注册 `workspaceFiles` Remote 命名空间（[plugin-inventory 模式](../../../../packages/host/plugin-inventory/README.md)），含两个直接方法：`list(path)` 返回一层名称排序的目录（目录与文件交错、符号链接经 `stat` 解析、POSIX 隐藏条目打标、受 `maxEntries` 配置约束并以 `truncated` 标记截断）与 `read(path)` 返回一个普通文件的有界 UTF-8 文本（窗口以 `maxReadBytes` 为上限、大文件置 `truncated`、以 NUL 字节启发式置 `binary`）。两者都要求完全限定路径——与目录选择 browse 后端相同的围栏——且绝不把相对 wire 值重定位。网关每次调用都从宿主文件系统现算响应；它不拥有缓存、监视或跨调用状态。配置默认值沿用选择器的 1000 条上限（GitHub Web UI 截断线）与 256 KiB 读取窗口。

### Client：`dsh-client-ui-workspace-files`——树 + 查看器列

两个注册共享一个查看 store。树填充 ui-sidebar 新声明的 `sidebar.files` 洞（`single`/`root` 槽位，位于会话浏览器与设置脚座之间，由 shell 的 `SidebarRoot` 渲染；ui-sidebar 新增洞声明与 `{ wide }` owner share——与其其它占位组件相同的列状态契约）。查看器填充 ui-layout 新声明的 `files` 列：四列 AppFrame 把它放在紧挨主侧栏右侧的第二列，自带拖动条并在 concession 链中占位（details 先让，然后 files），同时 `ctx.layout.openFiles()`/`closeFiles()` 进入共享面板动作面。点击树中的文件会把它选入共享 store 并以契约默认宽度打开该列；查看器渲染该选择（带路径与关闭动作的头部、有界文本或二进制/截断/错误提示）。store handle 传给两个 register，框架因此实例化一个根作用域实例供两个 entry 共享。

两个注册都通过 `ctx.slots.inject(...)` 等待各自的槽位声明，而不是假设激活顺序。树通过全局 `useWorkspaces` hook 读取真实 Host 工作区，默认取当前会话的工作区（规范 cwd 匹配；否则取第一个工作区），按需在展开时加载每个目录层，并在根切换时清空共享选择。展开与根状态为组件局部状态；折叠的侧栏 rail 不渲染任何内容（该区域没有 rail 图标位）。`workspaceFiles` Remote 像其它选中的能力一样通过 [api-remotes client 组装](../../../../packages/api/remotes/README.md) 挂载，因此 client 不导入任何 Host 包。

## 备选方案

- **扩展 `HostApi` RPC 域（`host.listDirectory` 家族）**——该契约是共享 wire 表面，带封闭的 `RpcMethodMap`；文件内容读取是文件浏览器关注点，而非目录选择器关注点，插件自有 Remote 让能力自包含且可组合（组合可以省略该行使表面关闭）。
- **用 webserver 路由提供文件**——需要自己的信任处理；现有 `/api` 围栏与 Remote 分派已覆盖浏览器通道。
- **复用 `host.listDirectory` 并给它加内容**——它刻意只列出可进入的目录且不返回文件行；文件浏览器需要一层里同时有两种。
- **把文件浏览器渲染进 ui-workspace 的区域**——该区域是会话浏览器；独立洞让归属与折叠行为显式。
- **查看器放在侧栏区域内**——首个发布形态在树下叠了一个查看窗格；侧栏约 280px 的宽度让它太窄，因此查看器移到自己的框架列（可左右拖动），选择提升为共享 store。
- **把 `details` 列复用给查看器**——details 是 `single`/`session` 槽位，已被对话的工具详情面板占用；文件查看是根作用域，会把它挤掉。
- **客户端 `fetch` 文件 URL**——没有为任意工作区路径提供的静态文件服务器，而且需要加宽信任围栏。

## 影响

文件浏览器是只读浏览器外壳：没有任何内容到达模型请求，网关的 `maxReadBytes` 阻止大文件整体跨 wire。表面可组合（其行位于 `dsh-web-app` patch 中；移除即禁用功能）。网关刻意不按工作区路径限定范围——已交付产品本就允许浏览器列出任意目录、打开任意路径——因此需要沙箱根的部署必须自行前置策略（记录在包 README 中）。

`files` 列对框架是增量的：其契约常量（`FILES_MIN`/`FILES_MAX`/`FILES_DEFAULT`）、store 动作与服务方法沿用 details 面板的既有模式，concession 链顺序（details 先于 files）由 `columns.ts` 契约固定。HMR 安全注册遵循标准槽位模式（`slots.inject` + `ctx.effect`），两个包都携带理由充分的空安装器 invariant 伴侣。
