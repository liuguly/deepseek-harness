# @deepseek-ai/dsh-host-workspace-files

[English](README.md) | 中文

面向 GUI 客户端提供工作区文件浏览的 Host 网关。`WorkspaceFilesGateway` 在 `workspaceFiles` Remote 命名空间注册两个直接方法，通过 Node 标准库读写宿主文件系统（与目录选择 browse 后端依赖的按操作系统适配一致）。它在宿主端不渲染任何内容，因此同进程与远程浏览器部署都能使用。浏览器半边是 [dsh-client-ui-workspace-files](../../client/ui-workspace-files/README.md)；从同一行 cordis.yml 挂载两者即可把浏览器界面与这个后端组合起来。

## 服务

`list(path)` 返回一层目录：按名称排序的行（目录与文件交错），受 `maxEntries` 配置约束，超出以 `truncated` 标记。符号链接通过 `stat` 解析为目标类型；损坏与循环链接被静默跳过——浏览器只显示可打开的内容。`read(path)` 返回一个普通文件的有界 UTF-8 文本：读取窗口以 `maxReadBytes` 为上限，更大的文件返回前缀并以 `truncated` 标记，窗口内出现 NUL 字节则以 `binary` 标记，客户端据此拒绝误导性的文本渲染。非普通文件目标会被拒绝。两个方法都要求完全限定的路径（与 browse 后端相同的围栏），绝不会把相对或空白的 wire 值静默重定位到宿主 cwd 之下。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxEntries` | 1000 | 单层列表的完整结果上限；更大的目录返回按名称排序的前缀并置 `truncated`。 |
| `maxReadBytes` | 262144 | 单次文件读取的窗口字节数；更大的文件返回前缀并置 `truncated`。 |

## 扩展点

无：该网关是通过生成的 `workspaceFiles` Remote 消费的叶子能力。客户端包通过 `@deepseek-ai/dsh-api-remotes` 组装消费它，而不是导入 Host 实现。

## 安全姿态

该网关是单用户本地宿主服务，与其它浏览器 RPC 一样位于同一 `/api` 信任围栏之后。它刻意不把读取限定在工作区目录内：已交付产品本就允许浏览器列出任意目录（`host.listDirectory`）与打开任意路径（`host.openPath`），整文件系统浏览是既有的资源管理器姿态。`maxReadBytes` 上限确保大文件不会整块跨越 wire。

## Model Experience

无，该 Host-only 网关不注册提示词、工具、消息或提供方请求。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制与延后工作

- **无工作区路径围栏**——浏览器可列出并读取任意完全限定的宿主路径；需要沙箱根目录的部署必须自行在前端加策略。
- **读取是文本投影**——二进制检测是对读取窗口的 NUL 字节启发式；不含 NUL 的二进制编码文件会渲染为有损文本。
- **无监视或刷新推送**——树在每次调用时反映文件系统状态；外部改动在下次展开或读取时出现。
- **无搜索、无多选、无重命名或删除**——网关只负责列出与读取；变更操作仍由 agent 自己的文件系统工具承担。
- **仅点态列表**——每次调用都重新读取目录；无缓存、历史或订阅。
