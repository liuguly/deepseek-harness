# Adding a plugin

English | [中文](adding-a-plugin.zh.md)

The ordered end-to-end route for adding a plugin to dsh: choose the form, plan the layout, write the body, register into the tree, build, test, verify, and finish. Read [the architecture](../architecture.md) and the [Cordis primer](../cordis-primer.md) first — the extension-point map and the five core concepts (plugin as service, ctx as container, inject as dependency, typed events, effect-based registration) are the vocabulary every step below uses. Each step links its owning reference instead of restating it; [adding-a-package](adding-a-package.md) owns the file-by-file package checklist, and [the extension cookbook](extension-cookbook.md) owns the feature → mechanism map.

## 1. Choose the plugin form

The form decides the package layout and the registration call. Match the feature to its extension point:

| Feature | Plugin form | Reference |
|---|---|---|
| Model-facing tool | Tool plugin registering `defineTool` on `ctx.tools` | [adding-a-tool](adding-a-tool.md) |
| Policy or interception | Hook plugin listening on `tools/*` / `agent/*` waterfalls | [extension-cookbook](extension-cookbook.md#a-hook-plugin-permission-gate-example) |
| New execution capability | Capability seam: Service Definition + Provider + Consumer | [capability seams](../capability-seams.md) |
| New model provider | LLM adapter registered on `ctx.llm` | [adding-an-llm-adapter](adding-an-llm-adapter.md) |
| Browser UI feature | Host Remote for data + client plugin for UI | [worked example](#worked-example-workspace-file-browsing) |
| External protocol | Protocol bridge over `ctx.agents` | [extension-cookbook](extension-cookbook.md#an-external-protocol-driver) |

A GUI feature is commonly two packages: a host package serving data over a generated Typert Remote, and a client package registering UI into a slot. The worked example below walks that shape end to end.

## 2. Plan the package layout

Place the package under `packages/<group>/<pkg>/`, joining an existing group when one matches the role (`core`, `llm`, `shell`, `fs`, `host`, `client`, `util`, ...). A function plugin ships `name` / `inject` / `Config` / `apply`; a service package default-exports its `Service` subclass. A UI plugin adds a `src/client/` browser half behind the `exports["./client"]` entry and a `dsh.client` manifest declaration. Follow [adding-a-package](adding-a-package.md) for the package.json invariants, tsconfig references, and README requirements — every harness package must also carry `./invariant` and its Model Experience section.

## 3. Write the plugin body

The minimal function plugin:

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

House rules that shape every body:

- **Registrations are effects.** Contribute through `ctx.effect()` or `ctx.on()`; each registration returns a disposer, and unloading the plugin unwinds everything it installed. This is what makes HMR-safe reload work.
- **No default export for function plugins.** The Loader discards the inject metadata of a function plugin that default-exports; service packages default-export their `Service` subclass instead.
- **Declare dependencies, not order.** `inject` names the services the fiber waits for; the framework sequences activation. Optional services use `ctx.get(name)`.
- **Config is validated, never hardcoded.** Deployment-varying choices are `Config` fields (schemastery) changeable from cordis.yml; protocol constants and security invariants stay fixed.
- **Optional services use `ctx.get(name)`.** The property proxy is topology-sensitive while `ctx.get` reads the global service store.

A tool body, a hook body, and the UI registration body each have their own skeleton: [the tool reference](adding-a-tool.md), [the hook example](extension-cookbook.md#a-hook-plugin-permission-gate-example), and step 4 below.

## 4. Register into the tree

A plugin reaches a running dsh through its composition rows. Three registration surfaces must agree — missing any one fails at a different, later point:

| Surface | Change |
|---|---|
| `tsconfig.host.json` / `tsconfig.client.json` | Add the package to the matching aggregate's `references` |
| `packages/bundle/web-app/cordis.patch.yml` | Add a host row, and a `dsh.client` row for a browser-half plugin |
| `packages/bundle/web-app/package.json` | Declare the package in `dependencies` — bare rows must resolve through the bundle's manifest |

A host Remote additionally mounts through the `@deepseek-ai/dsh-api-remotes` client assembly (`import remote from '<pkg>/remote'`, `ctx.remote.$mount(remote)`, and a type re-export), so browser code never imports a Host package. A client UI plugin registers into a slot declared by another plugin and waits on that declaration with `ctx.slots.inject('owner.slot', () => ctx.slots.register({...}, Component))` — never assume activation order.

## 5. Build and typecheck

```sh
pnpm install
pnpm run build:lib:host     # tsc -b tsconfig.host.json + tsdown (generates Typert artifacts)
pnpm run build:lib:client   # tsc -b tsconfig.client.json + tsdown (browser bundles)
pnpm run typecheck
```

The host pass runs before the client pass: the client program compiles against the generated `/remote` declarations the host tsdown emits. For a browser feature, rebuild the frontend dist once (`pnpm run build:web`) before serving.

## 6. Test

Follow [the testing policy](../testing.md). The three tiers:

- **Package tests** — unit tests for host logic (gateway methods against temp-dir fixtures) and jsdom component specs for UI (feed props directly: `createStore().create()` plus `bindSnapshotSelector`, stub framework hooks, `makeTranslate` for the locale seat). Assert user-visible behavior, not internals.
- **Assembly tests** — a product-visible plugin needs a non-unit REAL-composition test that boots a `cordis.yml` through the Loader and asserts model-visible, durable, or user-visible output.
- **GUI suite** — `pnpm run test:gui` (client + host packages) is the inner loop; `test:coverage` is the CI per-file gate for packages under `packages/*/*/src`.

A changed owner package updates its own tests and snapshots in the same change; snapshot updates (`-u`) are only for intentional output changes.

## 7. Verify live

Do not trust unit tests alone for a UI feature. Start the real server and check the surface:

```sh
pnpm dsh --profile web --port 3199
```

- The page's `window.__DSH_BOOT__` contains the new browser row.
- `GET /plugins/@deepseek-ai/dsh-<pkg>/client.js` serves the bundle (200) with the new component.
- A host Remote answers end to end: `POST /api/<namespace>/<method>` with the envelope `{ type: 'client-request', rpcId, method, payload: { args: {...} } }`.
- `dsh --profile web --dump-config` shows the rows in the resolved tree.

Without a browser, the assembled-jsdom boot pattern (`apps/web/tests/assembled-boot.ts`) mounts the real built bundles and activates the whole graph headlessly.

## 8. Finish

- **README pair.** The package README (English + Chinese) documents the service API, config, events, extension points, the Model Experience section, and Known Limitations.
- **Agent Note.** A non-trivial change carries an Agent Note in the same change under `.agents/notes/implemented/` (feature, bug-fix, architecture, ...) — Problem / Decision / Alternatives considered / Consequences.
- **Gates.** `pnpm run doc-sync` and `pnpm run hygiene` (knip, publint, workspace constraints, package invariants, cordis-config verification, node-next types, runtime closure). `verify-cordis-config` enforces that every bare row in a composition appears in its resolver manifest's dependencies.

## Worked example: workspace file browsing

The shipped feature is two packages: [`dsh-host-workspace-files`](../../packages/host/workspace-files/README.md) serves directory listings and bounded text reads over a Typert Remote; [`dsh-client-ui-workspace-files`](../../packages/client/ui-workspace-files/README.md) registers a sidebar tree and a viewer column in the web client. Its Agent Note records the decisions ([web workspace file explorer](../../.agents/notes/implemented/feature/2026-08-17-web-sidebar-workspace-file-explorer.md)).

The host gateway is a `TypertRemoteService` subclass with `@Remote` methods (the [plugin-inventory](../../packages/host/plugin-inventory/README.md) pattern):

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

The client half registers two components into two slots and shares one viewing store between them — one `apply`, one store handle, two `slots.inject` calls:

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

The wiring that made it reach the browser: host and client rows in the web-app patch, both packages in the web-app manifest dependencies, both packages in the host/client tsconfig aggregates, the Remote mounted through the api-remotes assembly, and the two owning slots declared by their owners (ui-sidebar's `sidebar.files` hole, ui-layout's `files` column with its drag handle and concession entry).

## Quick starts

- **Tool plugin** — the minimal `defineTool` registration is the first example in [adding-a-tool](adding-a-tool.md); `packages/todo/tool-todo` is a complete configurable tool with a session-projection unit.
- **Hook plugin** — the permission gate in [extension-cookbook](extension-cookbook.md#a-hook-plugin-permission-gate-example) is the template for any `tools/*` / `agent/*` policy listener; remember waterfall listeners must call `next()` to delegate.
- **UI plugin** — start from [adding-a-conversation-node](adding-a-conversation-node.md) for chat-surface features, or from the worked example above for a sidebar or panel feature.
