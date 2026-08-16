/**
 * `workspaceFiles` namespace dictionaries: the explorer region (root picker,
 * file tree, viewer) inside the sidebar. Runtime failure messages (wire error
 * strings) pass through untranslated by policy.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.files': '文件',
  'root.label': '工作区',
  'root.none': '暂无工作区',
  'root.loading': '正在加载工作区…',
  'tree.empty': '空目录',
  'tree.hidden': '显示隐藏文件',
  'tree.hiddenAria': '显示或隐藏以点开头的文件',
  'tree.loading': '正在加载…',
  'tree.error': '无法读取目录：{message}',
  'tree.truncated': '仅显示前 {n} 项',
  'viewer.hint': '选择文件查看内容',
  'viewer.loading': '正在读取…',
  'viewer.error': '无法读取文件：{message}',
  'viewer.binary': '二进制文件，无法预览',
  'viewer.truncated': '文件过大，仅显示前 {n} 字节',
  'viewer.close': '关闭',
  'aria.tree': '工作区文件树',
  'aria.folder': '文件夹 {name}',
  'aria.file': '文件 {name}',
  'aria.expand': '展开 {name}',
  'aria.collapse': '收起 {name}',
}

/** English dictionary mirroring {@link zh}. */
export const en: Record<keyof typeof zh, string> = {
  'section.files': 'Files',
  'root.label': 'Workspace',
  'root.none': 'No workspaces yet',
  'root.loading': 'Loading workspaces…',
  'tree.empty': 'Empty directory',
  'tree.hidden': 'Show hidden files',
  'tree.hiddenAria': 'Show or hide dot-prefixed files',
  'tree.loading': 'Loading…',
  'tree.error': 'Cannot read directory: {message}',
  'tree.truncated': 'Showing first {n} entries',
  'viewer.hint': 'Select a file to view its content',
  'viewer.loading': 'Reading…',
  'viewer.error': 'Cannot read file: {message}',
  'viewer.binary': 'Binary file, preview unavailable',
  'viewer.truncated': 'File too large, showing first {n} bytes',
  'viewer.close': 'Close',
  'aria.tree': 'Workspace file tree',
  'aria.folder': 'Folder {name}',
  'aria.file': 'File {name}',
  'aria.expand': 'Expand {name}',
  'aria.collapse': 'Collapse {name}',
}

/** The key set of this namespace (derived from the source-of-truth zh dictionary). */
export type WorkspaceFilesKey = keyof typeof zh
