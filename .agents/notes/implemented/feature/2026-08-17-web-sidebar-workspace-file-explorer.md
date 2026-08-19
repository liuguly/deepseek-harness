# Agent Note: Web workspace file explorer — Remote list/read gateway + `sidebar.files` tree + `files` viewer column

Status: implemented

English | [中文](2026-08-17-web-sidebar-workspace-file-explorer.zh.md)

## Problem

The Web GUI shows sessions grouped under workspaces but no project file surface: a user who adds a project folder as a workspace cannot inspect its files inside the harness and must switch to an external editor to view the code the agent is changing. The sidebar has exactly one content region (`sidebar.workspaces`) plus the settings foot; there is no host-side file-browsing RPC beyond the picker's directory-only `host.listDirectory`, which lists only enterable directories and never file contents.

## Decision

Add a two-package capability on the existing Web composition: a host Remote gateway serving directory listings and bounded text reads, a sidebar tree occupant, and a dedicated resizable viewer column in the app frame.

### Host gateway: `dsh-host-workspace-files`

`WorkspaceFilesGateway` registers the `workspaceFiles` Remote namespace (the [plugin-inventory pattern](../../../../packages/host/plugin-inventory/README.md)) with two direct methods: `list(path)` returns one name-sorted directory level (directories and files interleaved, symlinks resolved through `stat`, POSIX-hidden entries flagged, bounded by a `maxEntries` config with a `truncated` cut flag) and `read(path)` returns one regular file as bounded UTF-8 text (window capped by `maxReadBytes`, `truncated` for larger files, `binary` flagged by a NUL-byte heuristic). Both require a fully qualified path — the same fence the directory-picker browse backend applies — and never rebase a relative wire value. The gateway computes every response fresh from the host filesystem; it owns no cache, watch, or cross-call state. Config defaults follow the picker's 1,000-entry bound (GitHub's web-UI truncation) and a 256 KiB read window.

### Client: `dsh-client-ui-workspace-files` — tree + viewer column

Two registrations share one viewing store. The tree fills a new `sidebar.files` hole declared by ui-sidebar (a `single`/`root` slot between the session browser and the settings foot, rendered by the shell's `SidebarRoot`; ui-sidebar gains the hole declaration and owner share `{ wide }` — the same column-state contract its other occupants receive). The viewer fills a new `files` column declared by ui-layout: the four-column AppFrame places it as the second column immediately right of the sidebar, with its own drag handle and a place in the concession chain (details concedes first, then files), plus `ctx.layout.openFiles()`/`closeFiles()` on the shared panel-action face. Clicking a file in the tree selects it into the shared store and opens the column at its contract default width; the viewer renders the selection (header with path and close action, bounded text or binary/truncated/error notices). The store handle is passed to both registers, so the framework instantiates one root-scope instance shared by the two entries.

Both registrations wait on their slot declarations through `ctx.slots.inject(...)` rather than assuming activation order. The tree reads real Host Workspaces through the global `useWorkspaces` hook, defaults the root to the current session's workspace by canonical-cwd match (falling back to the first workspace), lazily loads each directory level on expand, and clears the shared selection when the root changes. Expand and root state are component-local; the collapsed sidebar rail renders nothing (the region has no rail icon seat). The `workspaceFiles` Remote mounts through the [api-remotes client assembly](../../../../packages/api/remotes/README.md) like every other selected capability, so the client imports no Host package.

## Alternatives considered

- **Extend the `HostApi` RPC domain (`host.listDirectory` family)** — that contract is the shared wire surface with a closed `RpcMethodMap`; file content reads are an explorer concern, not a picker concern, and a plugin-owned Remote keeps the capability self-contained and composable (the composition can omit the row to turn the surface off).
- **Serve files over a webserver route** — would need its own trust treatment; the existing `/api` fence and Remote dispatch already cover the browser channel.
- **Reuse `host.listDirectory` and add content to it** — it deliberately lists only enterable directories and returns no file rows; the explorer needs both kinds in one level.
- **Render the explorer inside ui-workspace's region** — the region is the session browser's; a separate hole keeps ownership and collapse behavior explicit.
- **Viewer inside the sidebar region** — the first shipped form stacked a viewer pane under the tree; the sidebar's ~280px width left it too narrow, so the viewer moved to its own frame column (left-right draggable) with the selection promoted to a shared store.
- **Reuse the `details` column for the viewer** — details is a `single`/`session` slot occupied by the conversation's tool-details panel; file viewing is root-scoped and would evict it.
- **Client-side `fetch` of file URLs** — there is no static file server for arbitrary workspace paths, and the trust fence would need widening.

## Consequences

The explorer is read-only browser chrome: nothing reaches a model request, and the gateway's `maxReadBytes` keeps a huge file from crossing the wire whole. The surface is composition-optional (its rows live in the `dsh-web-app` patch; removing them disables the feature). The gateway is deliberately not scoped to workspace paths — the shipped product already lists arbitrary directories and opens arbitrary paths from the browser — so deployments wanting a sandboxed root must front it with their own policy (recorded in the package README). The `files` column is additive to the frame: its contract constants (`FILES_MIN`/`FILES_MAX`/`FILES_DEFAULT`), store actions, and service methods follow the details panel's established pattern, and the concession chain order (details before files) is fixed by contract in `columns.ts`. HMR-safe registration follows the standard slot pattern (`slots.inject` + `ctx.effect`), and both packages carry the required invariant companions with justified empty installers.
