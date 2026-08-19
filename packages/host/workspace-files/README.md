# @deepseek-ai/dsh-host-workspace-files

English | [中文](README.zh.md)

Host gateway serving workspace file browsing to GUI clients. `WorkspaceFilesGateway` registers the `workspaceFiles` Remote namespace with two direct methods over the host filesystem, using Node's stdlib (the same per-OS adaptation the directory-picker browse backend relies on). Nothing renders on the host display, so the gateway serves in-process and remote browser deployments equally. The browser half is [dsh-client-ui-workspace-files](../../client/ui-workspace-files/README.md); mounting both from one cordis.yml row composes the explorer surface with this backend.

## Service

`list(path)` returns one directory level: name-sorted rows (directories and files interleaved), bounded by the `maxEntries` config with `truncated` flagging a cut. Symlinks resolve to their target kind through `stat`; broken and cyclic links are skipped silently — the browser shows what can be opened. `read(path)` returns one regular file as bounded UTF-8 text: the read window is capped at `maxReadBytes`, larger files return a prefix with `truncated`, and a NUL byte in the window flags `binary` so the client can refuse a misleading text render. Non-regular targets reject. Both methods require a fully qualified path (the same fence the browse backend applies) and never rebase a relative or empty wire value under the host cwd.

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxEntries` | 1000 | Complete-result bound of one listing level; larger levels return the name-sorted head with `truncated`. |
| `maxReadBytes` | 262144 | Read window of one file read; larger files return a prefix with `truncated`. |

## Extension points

None: the gateway is a leaf capability consumed through the generated `workspaceFiles` Remote. Client packages consume it through the `@deepseek-ai/dsh-api-remotes` assembly rather than importing the Host implementation.

## Security posture

The gateway is a single-user local host service under the same `/api` trust fence as every other browser RPC. It deliberately does not scope reads to workspace directories: the shipped product already lists arbitrary directories (`host.listDirectory`) and opens arbitrary paths (`host.openPath`) from the browser, and whole-filesystem browsing is the established explorer posture. The `maxReadBytes` bound keeps a huge file from crossing the wire whole.

## Model Experience

None, as this Host-only gateway registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No workspace-path fence** — the browser may list and read any fully qualified host path; deployments wanting a sandboxed root must front the gateway with their own policy.
- **Reads are text projections** — binary detection is a NUL-byte heuristic over the read window; an encoded binary file without NULs renders as lossy text.
- **No watch or refresh push** — the tree reflects the filesystem at each call; external edits appear on the next expand or read.
- **No search, no multi-select, no rename or delete** — the gateway lists and reads; mutations stay with the agent's own filesystem tools.
- **Point-in-time listing only** — each call reads the directory fresh; there is no cache, history, or subscription.
