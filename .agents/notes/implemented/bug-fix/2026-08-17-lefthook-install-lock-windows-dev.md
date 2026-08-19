# Agent Note: Lefthook installer lock identity — Windows path-stat dev is 0

Status: implemented

English | [中文](2026-08-17-lefthook-install-lock-windows-dev.zh.md)

## Problem

`scripts/install-lefthook.mjs` guards the lefthook hooks integration with an exclusive lock file (`.git/dsh-lefthook-install.lock`) whose identity it verifies by comparing `dev` and `ino` between a handle-based `fstat` (captured at create) and path-based `lstat` calls (at acquire verification, EEXIST-race re-verification, and release). On Windows, Node reports `dev` as the volume serial for `fstat` on the open handle but `0` for `lstat` by path on the same file, so the comparison always failed: the installer threw "lock ownership changed", refused to remove its own lock, and left a stale lock that forced manual deletion on every subsequent run. Every `pnpm install` on a Windows host therefore failed at the root postinstall, which also made pnpm's deps-status check re-run install on each `pnpm run`.

Upstream added a 5-second `INSTALL_LOCK_INITIALIZATION_TIMEOUT_MS` to soften the incomplete-record race, but the strict `dev`/`ino` comparisons remain in the script, so the Windows `dev`-zero mismatch still throws on every run.

## Decision

Compare lock-file identity through `ino` always and `dev` only when both sides report non-zero: `sameLockFile(left, right)` returns `left.ino === right.ino && (left.dev === right.dev || left.dev === 0 || right.dev === 0)`. The `ino` (file index) still detects replacement; the `dev` comparison keeps cross-volume detection on platforms where path-based stat reports a real device (POSIX), while a zero dev on either side (the Windows path-stat behavior) disables only the dev half instead of failing the identity check. All four comparison sites (acquire publish verification, EEXIST race re-verification, the initializing-lock record comparison, and release) use the helper.

## Alternatives considered

- **Ignore `dev` entirely on `win32`** — a platform branch duplicates the identity rule instead of expressing it; the zero-dev-on-either-side predicate is the same rule in both spellings.
- **Compare content only (the `<pid> <uuid>` record)** — content equality alone cannot detect a replaced-then-rewritten lock with an identical record, which the inode comparison exists to catch.

## Consequences

The installer completes and releases its lock on Windows hosts (verified on Node 22.16/NTFS: exit 0, hook sync reported, lock removed). POSIX behavior is unchanged: `dev` values match there, so the comparison is exactly as strict as before. The deps-status install loop on Windows is unblocked once the root postinstall succeeds. The change sits on top of the upstream 5-second initialization timeout, which remains in effect for its own race.
