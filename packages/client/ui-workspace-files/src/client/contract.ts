/**
 * ui-workspace-files contracts. Two registrations share this package:
 *
 * - WorkspaceFilesExplorer fills the sidebar shell's `sidebar.files` hole (the
 *   file-tree region): root picker, lazily-expanded tree, and the open action
 *   that selects a file into the shared viewing store and opens the files
 *   panel.
 * - FilesViewer fills the layout's `files` column (the separate resizable
 *   viewer panel beside the conversation): it renders the shared store's
 *   selection and read state, and closes the panel.
 *
 * Both registrations pass one store handle (createFileExplorerStore), so the
 * framework instantiates one root-scope viewing store shared by both entries.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the runtime's standard-kit merges (GlobalStandardProps:
// useSessions/useWorkspaces) into programs resolving PropsRuntime.
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the api-remotes assembly's merge — the generated
// `remote.workspaceFiles` namespace and the workspace-files payload types the
// assembly re-exports, so no Host package enters this browser program.
import type {
  WorkspaceFileListing, WorkspaceFileRead,
} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.files' entry) and
// ui-layout's SlotMap merge (the 'files' entry) so the PropsRuntime shares
// below resolve.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createFileExplorerStore } from './stores.ts'

/**
 * Registrant-private injected share of the tree entry (arrives via the
 * register inject factory). The Remote wrappers surface the Host gateway's
 * business errors as thrown Errors with the wire message; openFiles opens the
 * layout's files panel.
 */
export interface WorkspaceFilesInjected {
  /** List one directory level (name-sorted, bounded by the gateway config). */
  list: (path: string) => Promise<WorkspaceFileListing>
  /** Read one regular file as bounded UTF-8 text. */
  read: (path: string) => Promise<WorkspaceFileRead>
  /** Open the files panel through the layout service. */
  openFiles: () => void
}

/**
 * Full tree props: the runtime share (owner `wide` flag + global
 * useWorkspaces/useSessions seats), the injected Remote wrappers, the shared
 * viewing store, and the locale seat. Expand/root state is component-local.
 */
export type WorkspaceFilesExplorerProps =
  PropsRuntime<'sidebar.files'>
  & WorkspaceFilesInjected
  & PropsStore<ReturnType<typeof createFileExplorerStore>>
  & PropsLocale<'workspaceFiles'>

/**
 * Registrant-private injected share of the viewer entry: closing the panel
 * rides the layout service.
 */
export interface FilesViewerInjected {
  /** Close the files panel through the layout service. */
  closeFiles: () => void
}

/**
 * Full viewer props: the runtime share, the shared viewing store (selection +
 * read state), the injected close action, and the locale seat.
 */
export type FilesViewerProps =
  PropsRuntime<'files'>
  & PropsStore<ReturnType<typeof createFileExplorerStore>>
  & FilesViewerInjected
  & PropsLocale<'workspaceFiles'>
