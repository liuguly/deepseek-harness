# @deepseek-ai/dsh-client-ui-workspace-files

English | [中文](README.zh.md)

Workspace files explorer plugin, browser half: two registrations sharing one viewing store.

- **WorkspaceFilesExplorer** fills the sidebar shell's `sidebar.files` hole (declared by [ui-sidebar](../ui-sidebar/README.md)): a workspace root picker and a lazily-expanded file tree. Clicking a file selects it into the shared store and opens the files panel through `ctx.layout`.
- **FilesViewer** fills the layout's `files` column (declared by [ui-layout](../ui-layout/README.md)): the resizable viewer panel in the second column, immediately right of the sidebar. The user drags the column boundary left-right to size it; the panel renders the selected file's bounded text (with binary / truncated / error notices) and a close action.

Both registrations pass one store handle (`createFileExplorerStore`), so the framework instantiates one root-scope viewing store shared by the two entries. Tree data rides the `workspaceFiles` Remote through the api-remotes assembly; its node counterpart is [dsh-host-workspace-files](../../host/workspace-files/README.md). Mounting both from one cordis.yml row composes the surfaces with that backend.

The root picker lists real Host Workspaces through the global `useWorkspaces` hook and defaults to the current session's workspace (canonical cwd match), falling back to the first workspace. Expand and root state are component-local; the collapsed rail renders nothing (the region has no rail icon seat of its own).

The node half is an empty `apply`: it exists so the plugin appears in the host cordis.yml and Loader, while the browser half ships through `exports["./client"]` and is discovered through the `dsh.client` manifest declaration.

## Model Experience

None, as the file explorer is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Read-only explorer** — listing and viewing only; mutations stay with the agent's own filesystem tools.
- **No watch or refresh push** — the tree reflects the filesystem at each expand; external edits appear on the next expand or read.
- **Text projection only** — binary files show a preview-unavailable notice (NUL-byte heuristic from the gateway).
- **Hidden files are a client-side filter** — the gateway always returns hidden entries and flags them, so the toggle changes only what the tree renders.
- **Viewer selection is transient** — a root change clears the selection, and closing the panel clears it too; there is no tab or history across selections.
