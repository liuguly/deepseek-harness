/**
 * The workbench controller: one snapshot store for viewing state plus the
 * actions over the browser API. Upload files never enter the observable
 * snapshot; the controller keeps them in a private map keyed by queue-item id.
 * @module @deepseek-ai/dsh-client-ui-workbench/store
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ArtifactRecord,
  Difficulty,
  DocumentWithCounts,
  KnowledgeMode,
  SearchKind,
  SearchResult,
  WorkbenchApi,
} from './api.ts'

/** One upload-queue entry (scalar view state only). */
export interface UploadItem {
  id: string
  name: string
  mode: KnowledgeMode
  progress: number
  state: 'uploading' | 'failed' | 'submitted'
  error?: string
}

/** Search pane state. */
export interface SearchState {
  query: string
  kind: SearchKind | 'all'
  difficulties: readonly Difficulty[]
  documentId?: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  results: readonly SearchResult[]
}

/** Whole-workbench snapshot. */
export interface WorkbenchState {
  documents: readonly DocumentWithCounts[]
  documentsStatus: 'idle' | 'loading' | 'ready' | 'error'
  documentsError?: string
  libraryFilter: KnowledgeMode | 'all'
  /** Whether the floating workbench overlay panel is open. */
  panelOpen: boolean
  selectedDocumentId?: string
  artifactsByDocument: Record<string, readonly ArtifactRecord[]>
  variantsByTemplate: Record<string, readonly ArtifactRecord[]>
  generatingArtifactId?: string
  generationError?: string
  uploadQueue: UploadItem[]
  search: SearchState
}

function initialState(): WorkbenchState {
  return {
    documents: [],
    documentsStatus: 'idle',
    libraryFilter: 'all',
    panelOpen: false,
    artifactsByDocument: {},
    variantsByTemplate: {},
    uploadQueue: [],
    search: {
      query: '',
      kind: 'all',
      difficulties: [],
      status: 'idle',
      results: [],
    },
  }
}

/**
 * The workbench controller. Created once in the plugin apply; components
 * receive it through the inject face and read state through the bound
 * `useState` hook.
 */
export class WorkbenchController {
  /** The bare observable the renderer binds as `useState`. */
  readonly store = createSnapshotStore<WorkbenchState>(initialState())

  private readonly queueFiles = new Map<string, { readonly file: Blob; readonly mode: KnowledgeMode }>()
  private nextId = 0

  constructor(private readonly api: WorkbenchApi) {}

  /** Open the floating workbench overlay panel. */
  openPanel(): void {
    this.store.update((draft) => {
      draft.panelOpen = true
    })
  }

  /** Close the floating workbench overlay panel. */
  closePanel(): void {
    this.store.update((draft) => {
      draft.panelOpen = false
    })
  }

  /**
   * Refresh the document library; safe to call concurrently.
   */
  async load(): Promise<void> {
    this.store.update((draft) => {
      draft.documentsStatus = 'loading'
      delete draft.documentsError
    })
    try {
      const documents = await this.api.listDocuments()
      this.store.update((draft) => {
        draft.documents = documents
        draft.documentsStatus = 'ready'
      })
    } catch (error) {
      this.store.update((draft) => {
        draft.documentsStatus = 'error'
        draft.documentsError = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Filter the library list by mode.
   * @param mode - the library mode filter, or `'all'`.
   */
  setLibraryFilter(mode: KnowledgeMode | 'all'): void {
    this.store.update((draft) => {
      draft.libraryFilter = mode
    })
  }

  /**
   * Select one document to filter the search pane, or clear the selection.
   * @param documentId - the document id, or `undefined` to clear.
   */
  selectDocument(documentId: string | undefined): void {
    this.store.update((draft) => {
      if (documentId === undefined) delete draft.selectedDocumentId
      else draft.selectedDocumentId = documentId
    })
  }

  /**
   * Load and cache one document's template artifacts.
   * @param documentId - the document id.
   */
  async loadArtifacts(documentId: string): Promise<void> {
    if (this.store.getSnapshot().artifactsByDocument[documentId] !== undefined) return
    const artifacts = await this.api.listDocumentArtifacts(documentId)
    this.store.update((draft) => {
      draft.artifactsByDocument[documentId] = artifacts
    })
  }

  /**
   * Load and cache one template's variants.
   * @param artifactId - the question-template artifact id.
   */
  async loadVariants(artifactId: string): Promise<void> {
    if (this.store.getSnapshot().variantsByTemplate[artifactId] !== undefined) return
    const variants = await this.api.listVariants(artifactId)
    this.store.update((draft) => {
      draft.variantsByTemplate[artifactId] = variants
    })
  }

  /**
   * Queue files for upload in the chosen mode.
   * @param files - the chosen file blobs.
   * @param names - the file names aligned with `files`.
   * @param mode - the ingest mode chosen for this batch.
   */
  addFiles(files: readonly Blob[], names: readonly string[], mode: KnowledgeMode): void {
    const started: Array<Promise<void>> = []
    for (const [index, file] of files.entries()) {
      const id = `upload-${this.nextId += 1}`
      const name = names[index] ?? `file-${index}`
      this.queueFiles.set(id, { file, mode })
      this.store.update((draft) => {
        draft.uploadQueue.push({ id, name, mode, progress: 0, state: 'uploading' })
      })
      started.push(this.runUpload(id, name))
    }
    void Promise.all(started).then(() => this.load())
  }

  private async runUpload(id: string, name: string): Promise<void> {
    const queued = this.queueFiles.get(id)
    if (queued === undefined) return
    try {
      await this.api.upload(queued.file, queued.mode, name, new AbortController().signal, (fraction) => {
        this.store.update((draft) => {
          const item = draft.uploadQueue.find(entry => entry.id === id)
          if (item !== undefined) item.progress = Math.round(fraction * 100)
        })
      })
      this.store.update((draft) => {
        const item = draft.uploadQueue.find(entry => entry.id === id)
        if (item !== undefined) {
          item.state = 'submitted'
          item.progress = 100
        }
      })
    } catch (error) {
      this.store.update((draft) => {
        const item = draft.uploadQueue.find(entry => entry.id === id)
        if (item !== undefined) {
          item.state = 'failed'
          item.error = error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  /**
   * Retry one failed queue item.
   * @param id - the queue-item id.
   */
  retry(id: string): void {
    const queued = this.queueFiles.get(id)
    if (queued === undefined) return
    const item = this.store.getSnapshot().uploadQueue.find(entry => entry.id === id)
    if (item === undefined) return
    this.store.update((draft) => {
      const current = draft.uploadQueue.find(entry => entry.id === id)
      if (current !== undefined) {
        current.state = 'uploading'
        current.progress = 0
        delete current.error
      }
    })
    void this.runUpload(id, item.name).then(() => this.load())
  }

  /**
   * Remove one document after the caller's confirmation.
   * @param id - the document id.
   */
  async removeDocument(id: string): Promise<void> {
    await this.api.removeDocument(id)
    await this.load()
  }

  /**
   * Re-ingest one document from a freshly chosen file.
   * @param id - the document id.
   * @param file - the replacement file content.
   */
  async reingest(id: string, file: Blob): Promise<void> {
    await this.api.reingest(id, file)
    await this.load()
  }

  /**
   * Edit the search query.
   * @param query - the current query text.
   */
  setQuery(query: string): void {
    this.store.update((draft) => {
      draft.search.query = query
    })
  }

  /**
   * Set the kind filter.
   * @param kind - the searched kind, or `'all'`.
   */
  setSearchKind(kind: SearchKind | 'all'): void {
    this.store.update((draft) => {
      draft.search.kind = kind
    })
  }

  /**
   * Toggle one difficulty chip.
   * @param difficulty - the difficulty level to toggle.
   */
  toggleDifficulty(difficulty: Difficulty): void {
    this.store.update((draft) => {
      const current = [...draft.search.difficulties]
      const index = current.indexOf(difficulty)
      if (index === -1) current.push(difficulty)
      else current.splice(index, 1)
      draft.search.difficulties = current
    })
  }

  /**
   * Run the search with the current filters. Multi-select difficulties
   * fan out one request per level and merge the results.
   */
  async runSearch(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    const query = snapshot.search.query
    if (query.trim().length === 0) return
    this.store.update((draft) => {
      draft.search.status = 'loading'
      delete draft.search.error
    })
    try {
      const kind = snapshot.search.kind
      const difficulties = snapshot.search.difficulties
      const documentId = snapshot.selectedDocumentId
      const results = difficulties.length === 0
        ? await this.api.search({
          query,
          ...(kind === 'all' ? {} : { kind }),
          ...(documentId === undefined ? {} : { documentId }),
        })
        : (await Promise.all(difficulties.map(difficulty => this.api.search({
          query,
          ...(kind === 'all' ? {} : { kind }),
          difficulty,
          ...(documentId === undefined ? {} : { documentId }),
        })))).flat()
      const seen = new Set<string>()
      const deduped = results.filter((result) => {
        const key = `${result.kind}:${result.artifactId ?? result.documentId}:${result.seq ?? ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      this.store.update((draft) => {
        draft.search.results = deduped
        draft.search.status = 'ready'
      })
    } catch (error) {
      this.store.update((draft) => {
        draft.search.status = 'error'
        draft.search.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Generate variants from one question template.
   * @param artifactId - the question-template artifact id.
   * @param count - how many variants to generate.
   * @param difficulty - optional target difficulty; defaults to the template's.
   */
  async generateVariants(artifactId: string, count: number, difficulty?: Difficulty): Promise<void> {
    this.store.update((draft) => {
      draft.generatingArtifactId = artifactId
      delete draft.generationError
    })
    try {
      await this.api.generateVariants(artifactId, count, difficulty)
      const variants = await this.api.listVariants(artifactId)
      this.store.update((draft) => {
        draft.variantsByTemplate[artifactId] = variants
        delete draft.generatingArtifactId
      })
    } catch (error) {
      this.store.update((draft) => {
        draft.generationError = error instanceof Error ? error.message : String(error)
        delete draft.generatingArtifactId
      })
    }
  }
}
