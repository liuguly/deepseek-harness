# Agent Note: Lefthook 安装器锁同一性——Windows 路径 stat 的 dev 为 0

Status: implemented

[English](2026-08-17-lefthook-install-lock-windows-dev.md) | 中文

## 问题

`scripts/install-lefthook.mjs` 用独占锁文件（`.git/dsh-lefthook-install.lock`）保护 lefthook 钩子集成，并通过比较「基于句柄的 `fstat`（创建时捕获）」与「基于路径的 `lstat`」之间的 `dev` 和 `ino` 来校验锁身份（在获取校验、EEXIST 竞态复验与释放处）。在 Windows 上，Node 对打开句柄的 `fstat` 报告 `dev` 为卷序列号，而对同一文件按路径 `lstat` 报告 `0`，因此比较永远失败：安装器抛出「锁归属已变」，拒绝删除自己的锁，并留下陈旧锁，迫使每次后续运行都要手动删除。于是 Windows 主机上的每次 `pnpm install` 都在根 postinstall 失败，这也让 pnpm 的依赖状态检查在每次 `pnpm run` 时重跑 install。

上游已将 `INSTALL_LOCK_INITIALIZATION_TIMEOUT_MS` 提高到 5 秒以缓解「记录不完整」竞态，但脚本中的严格 `dev`/`ino` 比较仍然保留，因此 Windows 的 `dev` 为零的失配每次运行仍会抛出。

## 决策

锁文件同一性始终比较 `ino`，`dev` 仅在双方都非零时比较：`sameLockFile(left, right)` 返回 `left.ino === right.ino && (left.dev === right.dev || left.dev === 0 || right.dev === 0)`。`ino`（文件索引）仍能检测替换；`dev` 比较在按路径 stat 报告真实设备的平台（POSIX）上保留跨卷检测，而任一侧的零 `dev`（Windows 路径 stat 行为）只禁用 dev 半边，而不是让身份检查失败。四个比较点（获取发布校验、EEXIST 竞态复验、initializing-lock 记录比较、释放）都使用该辅助函数。

## 备选方案

- **在 `win32` 上完全忽略 `dev`**——平台分支是在复述身份规则而非表达它；「任一侧零 dev」谓词是同一规则的两种拼写。
- **只比较内容（`<pid> <uuid>` 记录）**——内容相等无法检测「被替换后又以相同记录重写」的锁，这正是 inode 比较要抓的情况。

## 影响

安装器在 Windows 主机上完成并释放其锁（已在 Node 22.16/NTFS 上验证：exit 0、钩子同步已报告、锁已移除）。POSIX 行为不变：那里的 `dev` 值一致，因此比较严格度与之前完全相同。一旦根 postinstall 成功，Windows 上的依赖状态安装循环即解除。本变更位于上游 5 秒初始化超时之上，该超时对其自身的竞态仍然生效。
