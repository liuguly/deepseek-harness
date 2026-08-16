// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
// Type-only: pulls this package's LocaleNamespaceMap merge (the
// 'workspaceFiles' namespace) into the aggregate test program.
import type {} from '@deepseek-ai/dsh-client-ui-workspace-files/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { FilesViewerProps } from '../src/client/contract.ts'
import { createFileExplorerStore, type FileViewerState } from '../src/client/stores.ts'
import { FilesViewer } from '../src/client/FilesViewer.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is workspaceFiles ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: FilesViewerProps['t'] = makeTranslate(zh, commonZh)

function mount(initial?: { selected?: { path: string; name: string }; view?: FileViewerState }) {
  const closeFiles = vi.fn()
  const store = createFileExplorerStore().create()
  if (initial?.selected !== undefined) {
    store.actions.select(initial.selected)
    if (initial.view !== undefined) store.actions.setView(initial.view)
  }
  const props: FilesViewerProps = {
    useSessions: (() => { throw new Error('viewer must not read sessions') }) as never,
    useWorkspaces: (() => { throw new Error('viewer must not read workspaces') }) as never,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    closeFiles,
    t,
  }
  const view = render(<FilesViewer {...props} />)
  return { view, store, closeFiles }
}

describe('FilesViewer', () => {
  it('renders the selected file name, its path, and the read content', () => {
    mount({
      selected: { path: '/proj/readme.md', name: 'readme.md' },
      view: { state: 'ready', content: 'hello world', byteLength: 11, truncated: false, binary: false },
    })
    expect(screen.getByText('readme.md')).toBeTruthy()
    expect(screen.getByTitle('/proj/readme.md')).toBeTruthy()
    expect(screen.getByText('hello world')).toBeTruthy()
  })

  it('shows the hint when nothing is selected', () => {
    mount()
    expect(screen.getByText('选择文件查看内容')).toBeTruthy()
  })

  it('shows a binary-file notice instead of text', () => {
    mount({
      selected: { path: '/proj/bin.dat', name: 'bin.dat' },
      view: { state: 'ready', content: '\u0000\u0001', byteLength: 2, truncated: false, binary: true },
    })
    expect(screen.getByText('二进制文件，无法预览')).toBeTruthy()
  })

  it('shows the bounded-prefix notice for truncated reads', () => {
    mount({
      selected: { path: '/proj/long.ts', name: 'long.ts' },
      view: { state: 'ready', content: 'abcd', byteLength: 4, truncated: true, binary: false },
    })
    expect(screen.getByText(/文件过大/)).toBeTruthy()
  })

  it('shows the read failure message', () => {
    mount({
      selected: { path: '/proj/missing.ts', name: 'missing.ts' },
      view: { state: 'error', message: 'no such file' },
    })
    expect(screen.getByText(/无法读取文件/)).toBeTruthy()
  })

  it('clears the selection and closes the panel on the close action', () => {
    const { store, closeFiles } = mount({ selected: { path: '/proj/readme.md', name: 'readme.md' } })
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(closeFiles).toHaveBeenCalledOnce()
    expect(store.getSnapshot().selected).toBeUndefined()
    expect(store.getSnapshot().view.state).toBe('idle')
  })
})
