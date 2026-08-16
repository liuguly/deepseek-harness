# @deepseek-ai/dsh-client-ui-workspace-files

[English](README.md) | 中文

工作区文件浏览器插件，浏览器半边：两个注册共享一个查看 store。

- **WorkspaceFilesExplorer** 填充侧栏 shell 的 `sidebar.files` 洞（[ui-sidebar](../ui-sidebar/README.md) 声明）：工作区根选择器 + 按需展开的文件树。点击文件会把它选入共享 store，并通过 `ctx.layout` 打开文件面板。
- **FilesViewer** 填充布局的 `files` 列（[ui-layout](../ui-layout/README.md) 声明）：紧挨主侧栏右侧的第二列中的可缩放查看面板。用户左右拖动列边界调整宽度；面板渲染所选文件的有界文本（含二进制/截断/错误提示）与关闭操作。

两个注册都传入同一个 store handle（`createFileExplorerStore`），框架因此实例化一个根作用域查看 store 供两个 entry 共享。树数据通过 api-remotes 组装走 `workspaceFiles` Remote；它的 node 半边是 [dsh-host-workspace-files](../../host/workspace-files/README.md)；从同一行 cordis.yml 挂载两者即可把界面与后端组合起来。

根选择器通过全局 `useWorkspaces` hook 列出真实 Host 工作区，默认取当前会话的工作区（规范 cwd 匹配），否则取第一个工作区。展开与根状态为组件局部状态；折叠成 rail 时不渲染任何内容（该区域没有自己的 rail 图标位）。

node 半边是空 `apply`：它让插件出现在宿主 cordis.yml 与 Loader 中（加载与生命周期跟随宿主），浏览器半边通过 `exports["./client"]` 分发，并由 `dsh.client` manifest 声明发现。

## Model Experience

无，文件浏览器是浏览器外壳；这里没有任何内容到达模型请求。

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

- **只读浏览器**——只列出与查看；变更操作仍由 agent 自己的文件系统工具承担。
- **无监视或刷新推送**——树在每次展开时反映文件系统状态；外部改动在下次展开或读取时出现。
- **仅文本投影**——二进制文件显示「无法预览」提示（来自网关的 NUL 字节启发式）。
- **隐藏文件是客户端过滤**——网关始终返回隐藏条目并标记它们，因此开关只改变树的渲染结果。
- **查看选择是瞬态的**——切换根会清空选择，关闭面板也会清空；没有跨选择的标签页或历史。
