# 添加插件

[English](adding-a-plugin.md) | 中文

在 dsh 中添加插件的端到端有序路线：选择形态、规划布局、编写主体、注册进插件树、构建、测试、验证、收尾。请先阅读[架构](../architecture.md)与 [Cordis 入门](../cordis-primer.md)——扩展点地图与五个核心概念（插件即服务、ctx 即容器、inject 即依赖、类型化事件、基于副作用（effect）的注册）是下文每一步都会用到的词汇。每一步链接其所属参考而非重述；[添加包](adding-a-package.md)负责逐文件包清单，[扩展实操手册](extension-cookbook.md)负责功能 → 机制映射。

## 1. 选择插件形态

形态决定包布局与注册调用。把功能对号入座到它的扩展点：

| 功能 | 插件形态 | 参考 |
|---|---|---|
| 面向模型的工具 | 工具插件：在 `ctx.tools` 注册 `defineTool` | [添加工具](adding-a-tool.md) |
| 策略或拦截 | 钩子插件：监听 `tools/*` / `agent/*` waterfall | [扩展实操手册](extension-cookbook.md#a-hook-plugin-permission-gate-example) |
| 新执行能力 | 能力 seam：Service Definition + Provider + Consumer | [能力 seam](../capability-seams.md) |
| 新模型提供方 | 在 `ctx.llm` 注册 LLM 适配器 | [添加 LLM 适配器](adding-an-llm-adapter.md) |
| 浏览器 UI 功能 | host Remote 提供数据 + client 插件提供 UI | [实操示例](#worked-example-workspace-file-browsing) |
| 外部协议 | 基于 `ctx.agents` 的协议桥 | [扩展实操手册](extension-cookbook.md#an-external-protocol-driver) |

GUI 功能通常是两个包：一个 host 包通过生成的 Typert Remote 提供数据，一个 client 包把 UI 注册进槽位。下面的实操示例端到端走一遍这个形态。

## 2. 规划包布局

把包放在 `packages/<group>/<pkg>/` 下，角色匹配时加入既有分组（`core`、`llm`、`shell`、`fs`、`host`、`client`、`util` 等）。函数插件携带 `name` / `inject` / `Config` / `apply`；服务包默认导出其 `Service` 子类。UI 插件在 `exports["./client"]` 入口后增加 `src/client/` 浏览器半边与 `dsh.client` manifest 声明。遵循[添加包](adding-a-package.md)中的 package.json 不变式、tsconfig references 与 README 要求——每个 harness 包还必须携带 `./invariant` 与 Model Experience 章节。

## 3. 编写插件主体

最小函数插件：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']            // services this plugin waits for
export function apply(ctx: Context): void {
  ctx.effect(() => {
    // every registration is a reversible effect; return its disposer
    return () => { /* undo what the effect installed */ }
  }, 'my-plugin: what this effect installs')
}
```

塑造每个主体的仓库规则：

- **注册是副作用（effect）。** 通过 `ctx.effect()` 或 `ctx.on()` 贡献；每个注册返回 disposer，卸载插件时撤销它安装的一切。这正是 HMR 安全重载可行的原因。
- **函数插件不要默认导出。** Loader 会丢弃默认导出函数插件的 inject 元数据；服务包改为默认导出其 `Service` 子类。
- **声明依赖，而非顺序。** `inject` 列出 fiber 等待的服务；框架负责激活排序。
- **配置经校验，绝不硬编码。** 部署相关选择是 `Config` 字段（schemastery），可从 cordis.yml 修改；协议常量与安全不变式保持固定。
- **可选服务使用 `ctx.get(name)`。** 属性代理对拓扑敏感，而 `ctx.get` 读取全局服务存储。

工具主体、钩子主体与 UI 注册主体各有各的骨架：[工具参考](adding-a-tool.md)、[钩子示例](extension-cookbook.md#a-hook-plugin-permission-gate-example)与下文第 4 步。

## 4. 注册进插件树

插件通过其组合行进入运行中的 dsh。三个注册表面必须一致——缺任何一个都会在更晚的不同位置失败：

| 表面 | 改动 |
|---|---|
| `tsconfig.host.json` / `tsconfig.client.json` | 把包加入对应聚合的 `references` |
| `packages/bundle/web-app/cordis.patch.yml` | 添加 host 行；浏览器半边插件再添加 `dsh.client` 行 |
| `packages/bundle/web-app/package.json` | 在 `dependencies` 声明该包——bare 行必须能通过 bundle 的 manifest 解析 |

host Remote 还要挂进 `@deepseek-ai/dsh-api-remotes` client 组装（`import remote from '<pkg>/remote'`、`ctx.remote.$mount(remote)` 与类型再导出），这样浏览器代码永不导入 Host 包。client UI 插件注册进其它插件声明的槽位，并用 `ctx.slots.inject('owner.slot', () => ctx.slots.register({...}, Component))` 等待该声明——绝不假设激活顺序。

## 5. 构建与类型检查

```sh
pnpm install
pnpm run build:lib:host     # tsc -b tsconfig.host.json + tsdown (generates Typert artifacts)
pnpm run build:lib:client   # tsc -b tsconfig.client.json + tsdown (browser bundles)
pnpm run typecheck
```

host pass 先于 client pass：client 程序要编译针对 host tsdown 生成的 `/remote` 声明。浏览器功能还需构建一次前端 dist（`pnpm run build:web`）再提供服务。

## 6. 测试

遵循[测试策略](../testing.md)。三个层级：

- **包测试**——host 逻辑的单测（网关方法针对临时目录夹具）+ UI 的 jsdom 组件 spec（直接喂 props：`createStore().create()` 加 `bindSnapshotSelector`、stub 框架 hook、locale 座位用 `makeTranslate`）。断言用户可见行为，而非内部实现。
- **装配测试**——产品可见插件需要非单测的真实组合测试：通过 Loader 启动 `cordis.yml` 并断言模型可见、持久或用户可见输出。
- **GUI 套件**——`pnpm run test:gui`（client + host 包）是内循环；`test:coverage` 是 `packages/*/*/src` 下包的 CI 逐文件门槛。

被改动的属主包在同一改动中更新自己的测试与快照；快照更新（`-u`）只用于预期输出变化。

## 7. 真实验证

UI 功能不要只信单测。启动真实服务器并检查表面：

```sh
pnpm dsh --profile web --port 3199
```

- 页面 `window.__DSH_BOOT__` 包含新浏览器行。
- `GET /plugins/@deepseek-ai/dsh-<pkg>/client.js` 提供 bundle（200）且含新组件。
- host Remote 端到端应答：`POST /api/<namespace>/<method>`，信封 `{ type: 'client-request', rpcId, method, payload: { args: {...} } }`。
- `dsh --profile web --dump-config` 显示解析树中的行。

没有浏览器时，装配式 jsdom 启动模式（`apps/web/tests/assembled-boot.ts`）挂载真实构建产物并无头激活整张图。

## 8. 收尾

- **README 双语对。** 包 README（英文 + 中文）记录服务 API、配置、事件、扩展点、Model Experience 章节与已知限制。
- **Agent Note。** 非平凡改动在同一改动中于 `.agents/notes/implemented/` 下携带 Agent Note（feature、bug-fix、architecture 等）——Problem / Decision / Alternatives considered / Consequences。
- **门禁。** `pnpm run doc-sync` 与 `pnpm run hygiene`（knip、publint、workspace 约束、包 invariant、cordis-config 校验、node-next types、运行时闭包）。`verify-cordis-config` 强制组合中每个 bare 行都出现在其 resolver manifest 的依赖里。

<a id="worked-example-workspace-file-browsing"></a>

## 实操示例：工作区文件浏览

该功能是两个包：[`dsh-host-workspace-files`](../../packages/host/workspace-files/README.md) 通过 Typert Remote 提供目录列表与有界文本读取；[`dsh-client-ui-workspace-files`](../../packages/client/ui-workspace-files/README.md) 在 web client 注册侧栏树与查看器列。其 Agent Note 记录了决策（[web 工作区文件浏览器](../../.agents/notes/implemented/feature/2026-08-17-web-sidebar-workspace-file-explorer.md)）。

host 网关是带 `@Remote` 方法的 `TypertRemoteService` 子类（[plugin-inventory](../../packages/host/plugin-inventory/README.md) 模式）：

```ts ignore-check
export class WorkspaceFilesGateway extends TypertRemoteService {
  static Config: z<Config> = z.object({ maxEntries: ..., maxReadBytes: ... })
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'workspaceFiles') }

  @Remote('list')
  async list(path: string): Promise<WorkspaceFileListing> { /* one name-sorted level */ }

  @Remote('read')
  async read(path: string): Promise<WorkspaceFileRead> { /* bounded UTF-8 text */ }
}
export default WorkspaceFilesGateway
```

client 半边把两个组件注册进两个槽位，并在两者之间共享一个查看 store——一个 `apply`、一个 store handle、两次 `slots.inject` 调用：

```ts ignore-check
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sessions', 'workspaces', 'layout']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace-files: dictionaries')
  const store = createFileExplorerStore()
  ctx.slots.inject('sidebar.files', () => ctx.slots.register({
    name: 'sidebar.files', store, locale: NS, inject: treeInjected,
  }, WorkspaceFilesExplorer))
  ctx.slots.inject('files', () => ctx.slots.register({
    name: 'files', store, locale: NS, inject: viewerInjected,
  }, FilesViewer))
}
```

让它到达浏览器的接线：web-app patch 中的 host 行与 client 行、web-app manifest 依赖中的两个包、host/client tsconfig 聚合中的两个包、通过 api-remotes 组装挂载的 Remote，以及由属主声明的两个槽位（ui-sidebar 的 `sidebar.files` 洞、ui-layout 的 `files` 列及其拖动条与 concession 条目）。

## 快速开始

- **工具插件**——[添加工具](adding-a-tool.md) 的第一个示例是最小 `defineTool` 注册；`packages/todo/tool-todo` 是带会话投影单元的完整可配置工具。
- **钩子插件**——[扩展实操手册](extension-cookbook.md#a-hook-plugin-permission-gate-example) 中的权限门禁是任何 `tools/*` / `agent/*` 策略监听器的模板；记住 waterfall 监听器必须调用 `next()` 委托。
- **UI 插件**——聊天表面功能从[添加 Conversation Node](adding-a-conversation-node.md) 开始；侧栏或面板功能从上文的实操示例开始。
