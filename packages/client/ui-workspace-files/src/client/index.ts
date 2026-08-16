/**
 * Workspace files explorer plugin, browser half. Two registrations share one
 * viewing store: the tree fills the sidebar shell's `sidebar.files` hole
 * (declared by ui-sidebar), and the FilesViewer fills the layout's `files`
 * column (declared by ui-layout) — the separate resizable viewer panel beside
 * the conversation. Clicking a file in the tree selects it into the shared
 * store and opens the panel through `ctx.layout`. Data rides the
 * `workspaceFiles` Remote through the api-remotes assembly. Export
 * discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the api-remotes assembly's merge (ctx.remote + the
// generated `remote.workspaceFiles` namespace).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-layout's Context merge (ctx.layout).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FilesViewerInjected, WorkspaceFilesInjected } from './contract.ts'
import { createFileExplorerStore } from './stores.ts'
import { FilesViewer } from './FilesViewer.tsx'
import { WorkspaceFilesExplorer } from './WorkspaceFilesExplorer.tsx'
import { en, zh, type WorkspaceFilesKey } from './locales.ts'

export type {
  FilesViewerInjected, FilesViewerProps, WorkspaceFilesExplorerProps, WorkspaceFilesInjected,
} from './contract.ts'
export type { WorkspaceFilesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace files tree region and viewer panel copy. */
    workspaceFiles: WorkspaceFilesKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workspaceFiles'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-sidebar's and ui-layout's applies, whose activation order relative to
 * this one is NOT constrained: dsh.client.inject edges are informational and
 * the owners provide no waitable service, so apply waits on each declaration
 * through `slots.inject()` instead of assuming order.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sessions', 'workspaces', 'layout']

/**
 * Register the tree and the viewer once their slot declarations are on the
 * ledger. Both registrations pass the same store handle, so the framework
 * instantiates one root-scope viewing store shared by the two entries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace-files: dictionaries')

  const store = createFileExplorerStore()
  const list: WorkspaceFilesInjected['list'] = async (path) => {
    const result = await ctx.remote.workspaceFiles.list(path)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const read: WorkspaceFilesInjected['read'] = async (path) => {
    const result = await ctx.remote.workspaceFiles.read(path)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const treeInjected = (): WorkspaceFilesInjected => ({
    list,
    read,
    openFiles: () => { ctx.layout.openFiles() },
  })
  const viewerInjected = (): FilesViewerInjected => ({
    closeFiles: () => { ctx.layout.closeFiles() },
  })

  ctx.slots.inject('sidebar.files', () => ctx.slots.register({
    name: 'sidebar.files',
    store,
    locale: NS,
    inject: treeInjected,
  }, WorkspaceFilesExplorer))

  ctx.slots.inject('files', () => ctx.slots.register({
    name: 'files',
    store,
    locale: NS,
    inject: viewerInjected,
  }, FilesViewer))
}
