// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
// Type-only: pulls this package's LocaleNamespaceMap merge (the
// 'workspaceFiles' namespace) into the aggregate test program.
import type {} from '@deepseek-ai/dsh-client-ui-workspace-files/client'
import type {
  SessionId, SessionListState, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  WorkspaceFileEntry, WorkspaceFileListing, WorkspaceFileRead,
} from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { WorkspaceFilesExplorerProps } from '../src/client/contract.ts'
import { createFileExplorerStore } from '../src/client/stores.ts'
import { WorkspaceFilesExplorer } from '../src/client/WorkspaceFilesExplorer.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is workspaceFiles ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: WorkspaceFilesExplorerProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

function workspace(id: string, path: string): WorkspaceView {
  return {
    workspaceId: wid(id), path, title: id, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Stub selector hook: applies the selector to one fixed snapshot. */
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function sessions(current?: SessionId): SessionListState {
  return {
    ids: current === undefined ? [] : [current],
    byId: current === undefined ? {} : {
      [current]: {
        id: current, displayTitle: 'Session', cwd: '/proj', running: false, blank: false,
        updatedAt: 0,
      },
    },
    current,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

function workspaceState(items: readonly WorkspaceView[]): WorkspaceListState {
  return {
    items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
    recentWorkspaceId: items[0]?.workspaceId,
  }
}

function entry(name: string, path: string, kind: 'file' | 'directory' = 'file'): WorkspaceFileEntry {
  return { name, path, kind, hidden: name.startsWith('.') }
}

function level(root: string): WorkspaceFileListing {
  return {
    path: root,
    entries: [entry('.gitignore', `${root}/.gitignore`), entry('src', `${root}/src`, 'directory'), entry('readme.md', `${root}/readme.md`)],
    truncated: false,
  }
}

function mount(options: {
  wide?: boolean
  withCurrentSession?: boolean
  listImpl?: (path: string) => Promise<WorkspaceFileListing>
  readImpl?: (path: string) => Promise<WorkspaceFileRead>
} = {}) {
  const list = vi.fn(options.listImpl ?? (async (path: string): Promise<WorkspaceFileListing> => level(path)))
  const read = vi.fn(options.readImpl ?? (async (path: string): Promise<WorkspaceFileRead> => ({
    path, content: 'hello world', byteLength: 11, truncated: false, binary: false,
  })))
  const openFiles = vi.fn()
  const store = createFileExplorerStore().create()
  const props: WorkspaceFilesExplorerProps = {
    wide: options.wide ?? true,
    useSessions: hook(sessions(options.withCurrentSession ? sid('s1') : undefined)),
    useWorkspaces: hook(workspaceState([workspace('w1', '/proj'), workspace('w2', '/other')])),
    list, read, openFiles,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t,
  }
  const view = render(<WorkspaceFilesExplorer {...props} />)
  return { view, list, read, openFiles, store }
}

describe('WorkspaceFilesExplorer', () => {
  it('lists the first workspace root and opens a file into the shared store', async () => {
    const { list, read, openFiles, store } = mount()
    await waitFor(() => expect(list).toHaveBeenCalledWith('/proj'))
    fireEvent.click(await screen.findByRole('button', { name: '文件 readme.md' }))
    await waitFor(() => expect(read).toHaveBeenCalledWith('/proj/readme.md'))
    expect(openFiles).toHaveBeenCalledOnce()
    const state = store.getSnapshot()
    expect(state.selected).toEqual({ path: '/proj/readme.md', name: 'readme.md' })
    expect(state.view).toMatchObject({ state: 'ready', content: 'hello world' })
  })

  it('defaults the root to the current session workspace by canonical cwd', async () => {
    const { list } = mount({ withCurrentSession: true })
    await waitFor(() => expect(list).toHaveBeenCalledWith('/proj'))
  })

  it('expands a directory lazily and collapses it again', async () => {
    const { list } = mount()
    fireEvent.click(await screen.findByRole('button', { name: '展开 src' }))
    await waitFor(() => expect(list).toHaveBeenCalledWith('/proj/src'))
    fireEvent.click(await screen.findByRole('button', { name: '收起 src' }))
  })

  it('hides dot-prefixed entries until the hidden toggle is on', async () => {
    mount()
    await waitFor(() => expect(screen.queryByRole('button', { name: '文件 .gitignore' })).toBeNull())
    fireEvent.click(screen.getByRole('checkbox', { name: '显示或隐藏以点开头的文件' }))
    expect(await screen.findByRole('button', { name: '文件 .gitignore' })).toBeTruthy()
  })

  it('publishes a read failure into the shared viewer state', async () => {
    const { store } = mount({
      readImpl: async () => { throw new Error('no such file') },
    })
    fireEvent.click(await screen.findByRole('button', { name: '文件 readme.md' }))
    await waitFor(() => {
      const state = store.getSnapshot()
      expect(state.view).toMatchObject({ state: 'error', message: 'no such file' })
    })
  })

  it('surfaces a listing failure in the tree', async () => {
    mount({
      listImpl: async () => { throw new Error('no such directory') },
    })
    expect(await screen.findByText(/无法读取目录/)).toBeTruthy()
  })

  it('renders nothing in the collapsed rail', () => {
    const { view } = mount({ wide: false })
    expect(view.container.childElementCount).toBe(0)
  })
})
