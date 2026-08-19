/**
 * Shared explorer viewing store: the selected file row and the viewer pane
 * state machine, shared between the `sidebar.files` tree entry and the
 * `files` viewer entry (one handle passed to both registers — the framework
 * instantiates one root-scope instance per handle). The tree entry drives
 * writes through the baked actions; the viewer entry renders the same state.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Viewer pane state machine. */
export type FileViewerState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; content: string; byteLength: number; truncated: boolean; binary: boolean }
  | { state: 'error'; message: string }

/** One selected file row: the fully qualified path plus its display name. */
export interface SelectedFile {
  path: string
  name: string
}

/** Explorer viewing state: the selection and the viewer pane. */
export interface FileExplorerState {
  /** The selected file row, absent before any selection. */
  selected: SelectedFile | undefined
  /** Viewer pane state (idle before any selection). */
  view: FileViewerState
}

/** Annotation twin of the actions literal below. */
export type FileExplorerActions = {
  /** Select a file: pins the row and starts the loading view. */
  select: (draft: FileExplorerState, entry: SelectedFile) => void
  /** Publish the next viewer state (the read outcome). */
  setView: (draft: FileExplorerState, view: FileViewerState) => void
  /** Clear the selection back to the idle view. */
  clear: (draft: FileExplorerState) => void
}

/**
 * Create the explorer viewing store handle. State is transient: the sidebar
 * shell keeps both entries mounted across collapse, and closing the viewer
 * clears the selection.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFileExplorerStore(): EngineStoreHandle<FileExplorerState, FileExplorerActions> {
  return defineStore({
    init: (): FileExplorerState => ({ selected: undefined, view: { state: 'idle' } }),
    actions: {
      select: (d, entry) => { d.selected = entry; d.view = { state: 'loading' } },
      setView: (d, view) => { d.view = view },
      clear: (d) => { d.selected = undefined; d.view = { state: 'idle' } },
    },
  })
}
