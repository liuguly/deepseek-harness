/**
 * The knowledge workbench surfaces: the settings section, the sidebar opener,
 * and the frame-wide overlay panel. Components receive everything through the
 * inject face (controller, bound snapshot hook, translate) and never touch
 * ctx; the settings section and the overlay share one controller and store.
 * @module @deepseek-ai/dsh-client-ui-workbench/WorkbenchSection
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { Difficulty, KnowledgeMode, SearchKind, SearchResult } from './api.ts'
import type { WorkbenchKey } from './locales.ts'
import type { UploadItem, WorkbenchController, WorkbenchState } from './store.ts'
import styles from './workbench.module.css'

/** Injected dependencies of the workbench surfaces (slot `inject`). */
export interface WorkbenchSectionInjected {
  /** The workbench controller created in the plugin apply. */
  controller: WorkbenchController
  hooks: {
    /** Snapshot bound by the UI renderer as useState. */
    state: WorkbenchController['store']
  }
  /** Section copy. */
  t: (key: WorkbenchKey) => string
}

/** Props delivered by the slot outlet (inject face spread flat). */
export type WorkbenchSectionProps = Partial<InjectFace<WorkbenchSectionInjected>>

/** The inject face of the sidebar opener, which reads no snapshot. */
export type WorkbenchSidebarActionProps = Partial<InjectFace<Pick<WorkbenchSectionInjected, 'controller' | 't'>>>

const KIND_FILTERS: readonly (SearchKind | 'all')[] = ['all', 'chunk', 'document_template', 'question', 'question_template', 'variant']
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'hell', 'nightmare']

function difficultyKey(difficulty: Difficulty): WorkbenchKey {
  return `difficulty${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}` as WorkbenchKey
}

function kindKey(kind: SearchKind): WorkbenchKey {
  return `kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}` as WorkbenchKey
}

function statusKey(status: string): WorkbenchKey {
  return `status${status.charAt(0).toUpperCase()}${status.slice(1)}` as WorkbenchKey
}

/** The `settings.section` occupant for the knowledge workbench. */
export function WorkbenchSection(props: WorkbenchSectionProps): ReactNode {
  const { controller, useState: useStateSnapshot, t } = props
  if (controller === undefined || useStateSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useStateSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: {
  controller: WorkbenchController
  useSnapshot: (selector: (state: WorkbenchState) => WorkbenchState) => WorkbenchState
  t: (key: WorkbenchKey) => string
}): ReactNode {
  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>
      <WorkbenchBody controller={controller} useSnapshot={useSnapshot} t={t} />
    </div>
  )
}

/** The sidebar-foot opener for the floating workbench panel. */
export function WorkbenchSidebarAction(props: WorkbenchSidebarActionProps): ReactNode {
  const { controller, t } = props
  if (controller === undefined || t === undefined) return null
  return (
    <button className={styles.sidebarAction} type="button" onClick={() => controller.openPanel()}>
      {t('nav')}
    </button>
  )
}

/** The `shell.overlay` occupant: the frame-wide workbench panel. */
export function WorkbenchOverlay(props: WorkbenchSectionProps): ReactNode {
  const { controller, useState: useStateSnapshot, t } = props
  if (controller === undefined || useStateSnapshot === undefined || t === undefined) return null
  const open = useStateSnapshot(snapshot => snapshot.panelOpen)
  if (!open) return null
  return (
    <div className={styles.overlayLayer}>
      <div className={styles.overlayBackdrop} onClick={() => controller.closePanel()} />
      <div className={styles.overlayPanel} role="dialog" aria-modal="true" aria-label={t('title')}>
        <div className={styles.overlayHead}>
          <h2 className={styles.title}>{t('title')}</h2>
          <button className={styles.linkButton} type="button" onClick={() => controller.closePanel()}>{t('closePanel')}</button>
        </div>
        <div className={styles.overlayBody}>
          <WorkbenchBody controller={controller} useSnapshot={useStateSnapshot} t={t} />
        </div>
      </div>
    </div>
  )
}

function WorkbenchBody({ controller, useSnapshot, t }: {
  controller: WorkbenchController
  useSnapshot: (selector: (state: WorkbenchState) => WorkbenchState) => WorkbenchState
  t: (key: WorkbenchKey) => string
}): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  useEffect(() => { void controller.load() }, [controller])
  return (
    <>
      <UploadBar controller={controller} state={state} t={t} />
      <div className={styles.columns}>
        <DocumentLibrary controller={controller} state={state} t={t} />
        <SearchPane controller={controller} state={state} t={t} />
      </div>
    </>
  )
}

function UploadBar({ controller, state, t }: {
  controller: WorkbenchController
  state: WorkbenchState
  t: (key: WorkbenchKey) => string
}): ReactNode {
  const [mode, setMode] = useState<KnowledgeMode>('knowledge')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submit = (files: FileList | null): void => {
    if (files === null || files.length === 0) return
    controller.addFiles([...files], [...files].map(file => file.name), mode)
  }
  return (
    <div className={styles.uploadBar}>
      <div
        className={dragging ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          submit(event.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
      >
        <span>{t('dropHint')}</span>
        <button className={styles.primaryButton} type="button" onClick={event => event.stopPropagation()}>{t('chooseFiles')}</button>
        <input
          ref={inputRef}
          className={styles.fileInput}
          type="file"
          multiple
          onChange={(event) => {
            submit(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
      <div className={styles.modeRow} role="radiogroup" aria-label={t('title')}>
        <label className={styles.modeOption}>
          <input type="radio" name="workbench-mode" checked={mode === 'knowledge'} onChange={() => setMode('knowledge')} />
          <span>{t('modeKnowledge')}</span>
        </label>
        <label className={styles.modeOption}>
          <input type="radio" name="workbench-mode" checked={mode === 'template'} onChange={() => setMode('template')} />
          <span>{t('modeTemplate')}</span>
        </label>
      </div>
      {state.uploadQueue.length > 0 && (
        <ul className={styles.queue}>
          {state.uploadQueue.map(item => <QueueRow key={item.id} item={item} controller={controller} t={t} />)}
        </ul>
      )}
    </div>
  )
}

function QueueRow({ item, controller, t }: {
  item: UploadItem
  controller: WorkbenchController
  t: (key: WorkbenchKey) => string
}): ReactNode {
  return (
    <li className={styles.queueItem}>
      <span className={styles.queueName}>{item.name}</span>
      <span>{item.mode === 'knowledge' ? t('modeKnowledge') : t('modeTemplate')}</span>
      {item.state === 'uploading' && <progress className={styles.progress} value={item.progress} max={100} aria-label={t('uploadQueue')} />}
      <span className={item.state === 'failed' ? styles.stateFailed : styles.stateOk}>
        {item.state === 'uploading' ? `${item.progress}%`
          : item.state === 'failed' ? `${t('statusFailed')}${item.error === undefined ? '' : `: ${item.error}`}`
            : t('statusStaged')}
      </span>
      {item.state === 'failed' && (
        <button className={styles.linkButton} type="button" onClick={() => controller.retry(item.id)}>{t('retry')}</button>
      )}
    </li>
  )
}

function DocumentLibrary({ controller, state, t }: {
  controller: WorkbenchController
  state: WorkbenchState
  t: (key: WorkbenchKey) => string
}): ReactNode {
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined)
  const reingestInput = useRef<HTMLInputElement>(null)
  const [reingestId, setReingestId] = useState<string | undefined>(undefined)
  const filtered = state.documents.filter(entry => state.libraryFilter === 'all' || entry.document.mode === state.libraryFilter)
  return (
    <div className={styles.library}>
      <div className={styles.paneHead}>
        <h3 className={styles.paneTitle}>{t('libraryTitle')}</h3>
        <button className={styles.linkButton} type="button" onClick={() => void controller.load()}>{t('refresh')}</button>
      </div>
      <div className={styles.filterRow} role="radiogroup" aria-label={t('libraryTitle')}>
        {(['all', 'knowledge', 'template'] as const).map(value => (
          <button
            key={value}
            type="button"
            className={state.libraryFilter === value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => controller.setLibraryFilter(value)}
          >
            {value === 'all' ? t('filterAll') : value === 'knowledge' ? t('modeKnowledge') : t('modeTemplate')}
          </button>
        ))}
      </div>
      {state.documentsStatus === 'loading' && <p className={styles.hint}>{t('loading')}</p>}
      {state.documentsStatus === 'error' && <p className={styles.errorText}>{`${t('loadFailed')}: ${state.documentsError ?? ''}`}</p>}
      <ul className={styles.docList}>
        {filtered.map(entry => (
          <li key={entry.document.id} className={styles.docItem}>
            <button
              type="button"
              className={state.selectedDocumentId === entry.document.id ? `${styles.docButton} ${styles.docButtonActive}` : styles.docButton}
              onClick={() => {
                const next = state.selectedDocumentId === entry.document.id ? undefined : entry.document.id
                controller.selectDocument(next)
                if (next !== undefined) void controller.loadArtifacts(next)
              }}
            >
              <span className={styles.docTitle}>{entry.document.title}</span>
              <span className={styles.docMeta}>
                {entry.document.mode === 'knowledge' ? t('modeKnowledge') : t('modeTemplate')}
                {' · '}
                {statusLabel(entry.document.status, t)}
                {' · '}
                {entry.document.mode === 'knowledge' ? `${entry.counts.chunkCount} ${t('chunksUnit')}` : countsLabel(entry.counts.byKind, t)}
              </span>
              {entry.document.error !== undefined && <span className={styles.errorText}>{entry.document.error}</span>}
            </button>
            <div className={styles.docActions}>
              <button
                className={styles.linkButton}
                type="button"
                onClick={() => setReingestId(entry.document.id)}
              >{t('reingest')}</button>
              <button
                className={styles.linkButton}
                type="button"
                onClick={() => setConfirmingId(entry.document.id)}
              >{t('delete')}</button>
            </div>
            {confirmingId === entry.document.id && (
              <div className={styles.confirmRow}>
                <span>{t('confirmDelete')}</span>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => {
                    setConfirmingId(undefined)
                    void controller.removeDocument(entry.document.id)
                  }}
                >{t('delete')}</button>
                <button className={styles.linkButton} type="button" onClick={() => setConfirmingId(undefined)}>{t('filterAll')}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <input
        ref={reingestInput}
        className={styles.fileInput}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file !== undefined && reingestId !== undefined) void controller.reingest(reingestId, file)
          event.target.value = ''
          setReingestId(undefined)
        }}
      />
      {reingestId !== undefined && (() => { reingestInput.current?.click(); return null })()}
      {state.selectedDocumentId !== undefined && <p className={styles.hint}>{t('selectDocumentHint')}</p>}
    </div>
  )
}

function countsLabel(byKind: Readonly<Record<string, number>>, t: (key: WorkbenchKey) => string): string {
  const parts: string[] = []
  const labels: Readonly<Record<string, WorkbenchKey>> = {
    document_template: 'kindDocumentTemplate',
    question: 'kindQuestion',
    question_template: 'kindQuestionTemplate',
    variant: 'kindVariant',
  }
  for (const [kind, key] of Object.entries(labels)) {
    const count = byKind[kind] ?? 0
    if (count > 0) parts.push(`${count} ${t(key)}`)
  }
  return parts.length === 0 ? t('variantsEmpty') : parts.join(' · ')
}

function statusLabel(status: string, t: (key: WorkbenchKey) => string): string {
  return t(statusKey(status))
}

function SearchPane({ controller, state, t }: {
  controller: WorkbenchController
  state: WorkbenchState
  t: (key: WorkbenchKey) => string
}): ReactNode {
  const search = state.search
  return (
    <div className={styles.searchPane}>
      <h3 className={styles.paneTitle}>{t('searchTitle')}</h3>
      <form
        className={styles.searchRow}
        onSubmit={(event) => {
          event.preventDefault()
          void controller.runSearch()
        }}
      >
        <input
          className={styles.searchInput}
          type="search"
          value={search.query}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchTitle')}
          onChange={event => controller.setQuery(event.target.value)}
        />
        <button className={styles.primaryButton} type="submit">{t('searchButton')}</button>
      </form>
      <div className={styles.filterRow} role="radiogroup" aria-label={t('searchTitle')}>
        {KIND_FILTERS.map(kind => (
          <button
            key={kind}
            type="button"
            className={search.kind === kind ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => controller.setSearchKind(kind)}
          >
            {kind === 'all' ? t('kindAll') : t(kindKey(kind))}
          </button>
        ))}
      </div>
      <div className={styles.filterRow} role="group" aria-label={t('difficulty')}>
        <span className={styles.filterLabel}>{t('difficulty')}</span>
        {DIFFICULTIES.map(difficulty => (
          <button
            key={difficulty}
            type="button"
            className={search.difficulties.includes(difficulty) ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            aria-pressed={search.difficulties.includes(difficulty)}
            onClick={() => controller.toggleDifficulty(difficulty)}
          >
            {t(difficultyKey(difficulty))}
          </button>
        ))}
      </div>
      {search.status === 'loading' && <p className={styles.hint}>{t('loading')}</p>}
      {search.status === 'error' && <p className={styles.errorText}>{`${t('searchFailed')}: ${search.error ?? ''}`}</p>}
      {search.status === 'ready' && search.results.length === 0 && <p className={styles.hint}>{t('noResults')}</p>}
      <ul className={styles.resultList}>
        {search.results.map((result, index) => (
          <ResultCard key={`${result.kind}-${result.artifactId ?? result.documentId}-${result.seq ?? index}`} result={result} controller={controller} t={t} />
        ))}
      </ul>
    </div>
  )
}

function ResultCard({ result, controller, t }: {
  result: SearchResult
  controller: WorkbenchController
  t: (key: WorkbenchKey) => string
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const variants = result.artifactId === undefined ? undefined : controller.store.getSnapshot().variantsByTemplate[result.artifactId]
  const payload = expanded ? ((result.payload ?? undefined) as Record<string, unknown> | undefined) : undefined
  return (
    <li className={styles.resultCard}>
      <div className={styles.resultHead}>
        <span className={styles.score}>{result.score.toFixed(2)}</span>
        <span className={styles.kindLabel}>{t(kindKey(result.kind))}</span>
        {result.difficulty !== undefined && <span className={styles.badge}>{t(difficultyKey(result.difficulty))}</span>}
        <span className={styles.docSource}>{`${t('source')}: ${result.documentTitle}`}</span>
      </div>
      {result.title !== undefined && <p className={styles.resultTitle}>{result.title}</p>}
      {result.kind === 'chunk' && result.content !== undefined && <p className={styles.content}>{result.content}</p>}
      {result.metadata !== undefined && <MetadataTags result={result} t={t} />}
      {result.kind === 'question_template' && (
        <div className={styles.variantRow}>
          <button className={styles.linkButton} type="button" onClick={() => setExpanded(value => !value)}>{t('detailToggle')}</button>
          <VariantGenerator controller={controller} artifactId={result.artifactId} t={t} />
        </div>
      )}
      {result.kind !== 'question_template' && result.payload !== undefined && (
        <button className={styles.linkButton} type="button" onClick={() => setExpanded(value => !value)}>{t('detailToggle')}</button>
      )}
      {expanded && payload !== undefined && <PayloadDetail payload={payload} t={t} />}
      {expanded && result.kind === 'question_template' && result.artifactId !== undefined && (
        <div className={styles.variantsBlock}>
          <h4 className={styles.blockTitle}>{t('variants')}</h4>
          {variants === undefined && <p className={styles.hint}>{t('loading')}</p>}
          {variants !== undefined && variants.length === 0 && <p className={styles.hint}>{t('variantsEmpty')}</p>}
          {variants?.map(variant => (
            <div key={variant.artifactId} className={styles.variantItem}>
              <span>{String((variant.payload as { stem?: string }).stem ?? '')}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}

function VariantGenerator({ controller, artifactId, t }: {
  controller: WorkbenchController
  artifactId: string | undefined
  t: (key: WorkbenchKey) => string
}): ReactNode {
  const [count, setCount] = useState(3)
  const [difficulty, setDifficulty] = useState<Difficulty | 'default'>('default')
  if (artifactId === undefined) return null
  const state = controller.store.getSnapshot()
  if (state.generatingArtifactId === artifactId) return <span className={styles.hint}>{t('generating')}</span>
  return (
    <span className={styles.generator}>
      <label className={styles.generatorField}>
        {t('variantCount')}
        <input
          className={styles.countInput}
          type="number"
          min={1}
          max={10}
          value={count}
          onChange={event => setCount(Math.max(1, Math.min(10, Number(event.target.value))))}
        />
      </label>
      <select
        className={styles.select}
        aria-label={t('variantDifficulty')}
        value={difficulty}
        onChange={event => setDifficulty(event.target.value as Difficulty | 'default')}
      >
        <option value="default">{t('variantDifficultyDefault')}</option>
        {DIFFICULTIES.map(value => <option key={value} value={value}>{t(difficultyKey(value))}</option>)}
      </select>
      <button
        className={styles.primaryButton}
        type="button"
        onClick={() => {
          void controller.loadVariants(artifactId).then(() => controller.generateVariants(
            artifactId,
            count,
            difficulty === 'default' ? undefined : difficulty,
          ))
        }}
      >{t('generateVariants')}</button>
      {state.generationError !== undefined && <span className={styles.errorText}>{state.generationError}</span>}
    </span>
  )
}

function MetadataTags({ result, t }: {
  result: SearchResult
  t: (key: WorkbenchKey) => string
}): ReactNode {
  const metadata = result.metadata
  if (metadata === undefined) return null
  const entries: Array<[WorkbenchKey, string]> = [
    ['metadataSubject', metadata.subject],
    ['metadataTopic', metadata.topic],
    ['metadataQuestionType', metadata.questionType],
    ...(metadata.gradeLevel === undefined ? [] : [['metadataGradeLevel', metadata.gradeLevel] as [WorkbenchKey, string]]),
    ...(metadata.year === undefined ? [] : [['metadataYear', metadata.year] as [WorkbenchKey, string]]),
    ...(metadata.source === undefined ? [] : [['metadataSource', metadata.source] as [WorkbenchKey, string]]),
  ]
  return (
    <div className={styles.metadataRow}>
      {entries.map(([key, value]) => (
        <span key={key} className={styles.tag}>{`${t(key)}: ${value}`}</span>
      ))}
      <span className={styles.tag}>{`${t('metadataKeywords')}: ${metadata.keywords.join('、')}`}</span>
    </div>
  )
}

function PayloadDetail({ payload, t }: {
  payload: Record<string, unknown>
  t: (key: WorkbenchKey) => string
}): ReactNode {
  return (
    <dl className={styles.payload}>
      <div>
        <dt>{t('variables')}</dt>
        <dd>{JSON.stringify(payload.variables ?? [], null, 1)}</dd>
      </div>
      <div>
        <dt>{t('constraints')}</dt>
        <dd>{JSON.stringify(payload.constraints ?? [])}</dd>
      </div>
      <div>
        <dt>{t('solutionStrategy')}</dt>
        <dd>{typeof payload.solutionStrategy === 'string' ? payload.solutionStrategy : ''}</dd>
      </div>
      <div>
        <dt>{t('generationRules')}</dt>
        <dd>{JSON.stringify(payload.generationRules ?? [])}</dd>
      </div>
      <div>
        <dt>{t('sampleQuestions')}</dt>
        <dd>{JSON.stringify(payload.sampleQuestions ?? [])}</dd>
      </div>
    </dl>
  )
}
