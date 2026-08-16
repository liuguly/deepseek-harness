/**
 * Workspace files tree: the sidebar file-browser region. A workspace root
 * picker (defaulting to the current session's workspace by canonical cwd,
 * else the first workspace) feeds a lazily-expanded file tree. Clicking a
 * file selects it into the shared viewing store and opens the layout's
 * files panel, which renders the read in its own resizable column — this
 * region keeps only the tree. Expand/root state is component-local; the
 * selection and viewer state live in the shared store (stores.ts). The
 * collapsed rail renders nothing (the region has no rail icon seat of its
 * own).
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronRightOutline14, IconCodeOutline16, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceFileEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFilesExplorerProps } from './contract.ts'
import css from './WorkspaceFilesExplorer.module.css'

/** One loaded directory level: name-sorted entries plus the gateway's cut flag. */
interface LevelState {
  entries: readonly WorkspaceFileEntry[]
  truncated: boolean
  /** Listing failure message (wire text passes through untranslated). */
  error?: string
}

/** Message text of an unknown thrown value (wire errors are Error instances). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render one level of the file tree. Directories toggle expansion (loading
 * their level lazily); files select and open in the viewer panel.
 */
function FileTree({
  entries, depth, expanded, levels, showHidden, selected, onToggle, onOpen, t,
}: {
  entries: readonly WorkspaceFileEntry[]
  depth: number
  expanded: readonly string[]
  levels: Readonly<Record<string, LevelState>>
  showHidden: boolean
  selected: string | undefined
  onToggle: (entry: WorkspaceFileEntry) => void
  onOpen: (entry: WorkspaceFileEntry) => void
  t: WorkspaceFilesExplorerProps['t']
}) {
  const visible = showHidden ? entries : entries.filter(entry => !entry.hidden)
  return (
    <>
      {visible.map(entry => {
        const indent = { paddingLeft: `${8 + depth * 14}px` }
        if (entry.kind === 'directory') {
          const isExpanded = expanded.includes(entry.path)
          const level = levels[entry.path]
          return (
            <div key={entry.path}>
              <button
                type="button"
                className={clsx(css.row, isExpanded && css.rowActive)}
                style={indent}
                aria-label={isExpanded
                  ? t('aria.collapse', { name: entry.name })
                  : t('aria.expand', { name: entry.name })}
                title={level?.error}
                onClick={() => { onToggle(entry) }}
              >
                <IconChevronRightOutline14 className={clsx(css.chevron, isExpanded && css.chevronOpen)} size={12} />
                {isExpanded
                  ? <IconFolderOpen16 className={css.folderIcon} size={14} />
                  : <IconFolderClose16 className={css.folderIcon} size={14} />}
                <span className={css.rowName}>{entry.name}</span>
              </button>
              {isExpanded && (
                <div className={css.children}>
                  {level === undefined
                    ? <div className={css.levelNotice} style={indent}>{t('tree.loading')}</div>
                    : level.error !== undefined
                      ? <div className={css.levelNotice} style={indent}>{t('tree.error', { message: level.error })}</div>
                      : level.entries.length === 0
                        ? <div className={css.levelNotice} style={indent}>{t('tree.empty')}</div>
                        : (
                            <>
                              <FileTree
                                entries={level.entries}
                                depth={depth + 1}
                                expanded={expanded}
                                levels={levels}
                                showHidden={showHidden}
                                selected={selected}
                                onToggle={onToggle}
                                onOpen={onOpen}
                                t={t}
                              />
                              {level.truncated && (
                                <div className={css.levelNotice} style={indent}>
                                  {t('tree.truncated', { n: level.entries.length })}
                                </div>
                              )}
                            </>
                          )}
                </div>
              )}
            </div>
          )
        }
        return (
          <button
            key={entry.path}
            type="button"
            className={clsx(css.row, selected === entry.path && css.rowSelected)}
            style={indent}
            aria-label={t('aria.file', { name: entry.name })}
            onClick={() => { onOpen(entry) }}
          >
            <IconCodeOutline16 className={css.fileIcon} size={14} />
            <span className={css.rowName}>{entry.name}</span>
          </button>
        )
      })}
    </>
  )
}

/**
 * Render the tree region.
 * @param props - composed slot props (contract.ts).
 * @returns the tree element tree, or nothing in the collapsed rail.
 */
export function WorkspaceFilesExplorer({
  wide, useWorkspaces, useSessions, list, read, openFiles, useStore, actions, t,
}: WorkspaceFilesExplorerProps) {
  const workspaces = useWorkspaces(state => state.items)
  const sessions = useSessions(state => state)
  const selected = useStore(state => state.selected)

  const [rootPath, setRootPath] = useState<string | undefined>(undefined)
  const [levels, setLevels] = useState<Readonly<Record<string, LevelState>>>({})
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [showHidden, setShowHidden] = useState(false)

  // Root default: the current session's workspace (canonical cwd match), else
  // the first workspace; once picked, a root stays until it disappears.
  useEffect(() => {
    if (rootPath !== undefined && workspaces.some(workspace => workspace.path === rootPath)) return
    const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
    const byCwd = current?.cwd === undefined ? undefined : workspaces.find(workspace => workspace.path === current.cwd)
    const next = byCwd ?? workspaces[0]
    setRootPath(next?.path)
  }, [rootPath, workspaces, sessions])

  // Loading the root level resets the tree; the shared selection is cleared
  // so a stale file never lingers in the viewer panel.
  useEffect(() => {
    if (rootPath === undefined) return
    setLevels({})
    setExpanded([])
    actions.clear()
    let cancelled = false
    void (async () => {
      try {
        const listing = await list(rootPath)
        if (cancelled) return
        setLevels({ [rootPath]: { entries: listing.entries, truncated: listing.truncated } })
      } catch (error) {
        if (cancelled) return
        setLevels({ [rootPath]: { entries: [], truncated: false, error: messageOf(error) } })
      }
    })()
    return () => { cancelled = true }
  }, [rootPath, list, actions])

  const toggleDirectory = (entry: WorkspaceFileEntry): void => {
    if (expanded.includes(entry.path)) {
      setExpanded(expanded.filter(path => path !== entry.path))
      return
    }
    setExpanded([...expanded, entry.path])
    if (levels[entry.path] !== undefined) return
    void (async () => {
      try {
        const listing = await list(entry.path)
        setLevels(previous => ({ ...previous, [entry.path]: { entries: listing.entries, truncated: listing.truncated } }))
      } catch (error) {
        setLevels(previous => ({
          ...previous,
          [entry.path]: { entries: [], truncated: false, error: messageOf(error) },
        }))
      }
    })()
  }

  const openFile = (entry: WorkspaceFileEntry): void => {
    openFiles()
    actions.select({ path: entry.path, name: entry.name })
    void (async () => {
      try {
        const result = await read(entry.path)
        actions.setView({
          state: 'ready',
          content: result.content,
          byteLength: result.byteLength,
          truncated: result.truncated,
          binary: result.binary,
        })
      } catch (error) {
        actions.setView({ state: 'error', message: messageOf(error) })
      }
    })()
  }

  if (!wide) return null
  const rootLevel = rootPath === undefined ? undefined : levels[rootPath]
  return (
    <section className={css.root} aria-label={t('section.files')}>
      <header className={css.header}>
        <span className={css.title}>{t('section.files')}</span>
        <label className={css.hiddenToggle} title={t('tree.hidden')}>
          <input
            type="checkbox"
            checked={showHidden}
            aria-label={t('tree.hiddenAria')}
            onChange={(event) => { setShowHidden(event.target.checked) }}
          />
          <span>{t('tree.hidden')}</span>
        </label>
      </header>
      <div className={css.rootPicker}>
        <label className={css.pickerLabel}>
          <span>{t('root.label')}</span>
          {workspaces.length === 0
            ? <span className={css.pickerEmpty}>{t('root.none')}</span>
            : (
                <select
                  className={css.picker}
                  value={rootPath ?? ''}
                  aria-label={t('root.label')}
                  onChange={(event) => { setRootPath(event.target.value) }}
                >
                  {workspaces.map(workspace => (
                    <option key={workspace.workspaceId} value={workspace.path}>{workspace.title}</option>
                  ))}
                </select>
              )}
        </label>
      </div>
      <div className={css.tree} role="tree" aria-label={t('aria.tree')}>
        {rootLevel === undefined
          ? <div className={css.levelNotice}>{t('tree.loading')}</div>
          : rootLevel.error !== undefined
            ? <div className={css.levelNotice}>{t('tree.error', { message: rootLevel.error })}</div>
            : rootLevel.entries.length === 0
              ? <div className={css.levelNotice}>{t('tree.empty')}</div>
              : (
                  <FileTree
                    entries={rootLevel.entries}
                    depth={0}
                    expanded={expanded}
                    levels={levels}
                    showHidden={showHidden}
                    selected={selected?.path}
                    onToggle={toggleDirectory}
                    onOpen={openFile}
                    t={t}
                  />
                )}
        {rootLevel !== undefined && rootLevel.truncated && (
          <div className={css.levelNotice}>{t('tree.truncated', { n: rootLevel.entries.length })}</div>
        )}
      </div>
    </section>
  )
}
