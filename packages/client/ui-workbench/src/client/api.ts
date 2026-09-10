/**
 * Hand-typed wire for the workbench Fetch routes. The routes are exact
 * `/api/knowledge.*` Fetch routes; the trust fence authenticates the page.
 * Upload uses XHR so the browser reports progress.
 * @module @deepseek-ai/dsh-client-ui-workbench/api
 */

/** Ingest mode chosen at upload time. */
export type KnowledgeMode = 'knowledge' | 'template'

/** The five fixed difficulty codes; localized labels live in the dictionaries. */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'hell' | 'nightmare'

/** Template artifact kinds. */
export type ArtifactKind = 'document_template' | 'question' | 'question_template' | 'variant'

/** Searchable kinds. */
export type SearchKind = 'chunk' | ArtifactKind

/** LLM-distilled metadata shared by template artifacts. */
export interface TemplateMetadata {
  readonly subject: string
  readonly topic: string
  readonly questionType: string
  readonly knowledgePoints: readonly string[]
  readonly keywords: readonly string[]
  readonly gradeLevel?: string
  readonly year?: string
  readonly source?: string
}

/** One registered document. */
export interface KnowledgeDocument {
  readonly id: string
  readonly mode: KnowledgeMode
  readonly title: string
  readonly sourceName: string
  readonly mime: string
  readonly sha256: string
  readonly status: 'staged' | 'parsing' | 'chunking' | 'embedding' | 'generating' | 'ready' | 'failed'
  readonly error?: string
  readonly chunkCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Document with its artifact counts. */
export interface DocumentWithCounts {
  readonly document: KnowledgeDocument
  readonly counts: {
    readonly chunkCount: number
    readonly byKind: Readonly<Record<string, number>>
  }
}

/** One search hit. */
export interface SearchResult {
  readonly kind: SearchKind
  readonly score: number
  readonly documentId: string
  readonly documentTitle: string
  readonly mode: KnowledgeMode
  readonly seq?: number
  readonly artifactId?: string
  readonly parentId?: string
  readonly title?: string
  readonly content?: string
  readonly payload?: unknown
  readonly difficulty?: Difficulty
  readonly metadata?: TemplateMetadata
}

/** One template artifact row. */
export interface ArtifactRecord {
  readonly artifactId: string
  readonly documentId: string
  readonly kind: ArtifactKind
  readonly parentId?: string
  readonly title?: string
  readonly payload: unknown
  readonly difficulty?: Difficulty
  readonly metadata?: TemplateMetadata
}

/** Browser-side workbench API over the exact Fetch routes. */
export interface WorkbenchApi {
  listDocuments(): Promise<DocumentWithCounts[]>
  search(input: {
    readonly query: string
    readonly kind?: SearchKind
    readonly difficulty?: Difficulty
    readonly documentId?: string
    readonly topK?: number
  }): Promise<SearchResult[]>
  removeDocument(id: string): Promise<void>
  reingest(id: string, file: Blob): Promise<void>
  upload(file: Blob, mode: KnowledgeMode, name: string, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<void>
  listDocumentArtifacts(documentId: string): Promise<ArtifactRecord[]>
  listVariants(parentId: string): Promise<ArtifactRecord[]>
  generateVariants(artifactId: string, count: number, difficulty?: Difficulty): Promise<readonly string[]>
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const text = await response.text()
  let body: unknown
  try {
    body = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }
  if (!response.ok) {
    const message = (body as { error?: string } | undefined)?.error ?? `${response.status} ${response.statusText}`
    throw new Error(message)
  }
  return body as T
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return jsonOrThrow<T>(response)
}

/** XHR upload with browser-reported progress; the page thread never aggregates bytes. */
function uploadXhr(path: string, body: Blob, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', path)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else {
        let message = `${request.status} ${request.statusText}`
        try {
          const parsed = JSON.parse(request.responseText) as { error?: string }
          if (typeof parsed.error === 'string') message = parsed.error
        } catch {
          // Non-JSON error body; the status line is the message.
        }
        reject(new Error(message))
      }
    }
    request.onerror = () => reject(new Error('network error during upload'))
    request.onabort = () => reject(new Error('upload aborted'))
    signal.addEventListener('abort', () => request.abort(), { once: true })
    request.send(body)
  })
}

/**
 * Build the default browser API against the shared `/api` channel.
 * @returns the workbench API used by the controller.
 */
export function createWorkbenchApi(): WorkbenchApi {
  return {
    async listDocuments() {
      const response = await fetch('/api/knowledge.documents')
      return jsonOrThrow<{ documents: DocumentWithCounts[] }>(response).then(body => body.documents)
    },
    async search(input) {
      const response = await fetch('/api/knowledge.search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      return jsonOrThrow<{ results: SearchResult[] }>(response).then(body => body.results)
    },
    async removeDocument(id) {
      await postJson('/api/knowledge.documents.delete', { id })
    },
    async reingest(id, file) {
      await uploadXhr(`/api/knowledge.documents.reingest?id=${encodeURIComponent(id)}`, file, new AbortController().signal, () => {})
    },
    async upload(file, mode, name, signal, onProgress) {
      const path = `/api/knowledge.documents.upload?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(name)}`
      await uploadXhr(path, file, signal, onProgress)
    },
    async listDocumentArtifacts(documentId) {
      const response = await fetch(`/api/knowledge.artifacts?documentId=${encodeURIComponent(documentId)}`)
      return jsonOrThrow<{ artifacts: ArtifactRecord[] }>(response).then(body => body.artifacts)
    },
    async listVariants(parentId) {
      const response = await fetch(`/api/knowledge.artifacts?parentId=${encodeURIComponent(parentId)}`)
      return jsonOrThrow<{ artifacts: ArtifactRecord[] }>(response).then(body => body.artifacts)
    },
    async generateVariants(artifactId, count, difficulty) {
      return postJson<{ ids: readonly string[] }>('/api/knowledge.templates.generate', {
        artifactId,
        count,
        ...(difficulty === undefined ? {} : { difficulty }),
      }).then(body => body.ids)
    },
  }
}
