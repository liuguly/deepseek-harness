/**
 * Files viewer panel: the layout's `files` column occupant. Renders the
 * shared viewing store's selection and read state — a header with the file
 * name and a close action, then the bounded text content (or the binary /
 * truncated / error notices). The column width is owned by the frame (the
 * user drags the column boundary); this component fills the column.
 */
import type { FilesViewerProps } from './contract.ts'
import css from './FilesViewer.module.css'

/**
 * Render the viewer panel.
 * @param props - composed slot props (contract.ts).
 * @returns the viewer element tree.
 */
export function FilesViewer({
  useStore, actions, closeFiles, t,
}: FilesViewerProps) {
  const selected = useStore(state => state.selected)
  const view = useStore(state => state.view)

  const close = (): void => {
    actions.clear()
    closeFiles()
  }

  return (
    <section className={css.root} aria-label={t('section.files')}>
      <header className={css.header}>
        <div className={css.titles}>
          <span className={css.title}>{selected?.name ?? t('section.files')}</span>
          {selected !== undefined && <span className={css.path} title={selected.path}>{selected.path}</span>}
        </div>
        <button
          type="button"
          className={css.close}
          aria-label={t('viewer.close')}
          onClick={close}
        >
          {t('viewer.close')}
        </button>
      </header>
      <div className={css.body}>
        {view.state === 'idle' && <div className={css.notice}>{t('viewer.hint')}</div>}
        {view.state === 'loading' && <div className={css.notice}>{t('viewer.loading')}</div>}
        {view.state === 'error' && <div className={css.notice}>{t('viewer.error', { message: view.message })}</div>}
        {view.state === 'ready' && (
          <>
            {view.binary
              ? <div className={css.notice}>{t('viewer.binary')}</div>
              : <pre className={css.content}>{view.content}</pre>}
            {view.truncated && (
              <div className={css.notice}>{t('viewer.truncated', { n: view.byteLength })}</div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
