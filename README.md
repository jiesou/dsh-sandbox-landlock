# dsh-sandbox-better

Landlock-only sandbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): every confined command runs under the bundled `landlock-run` launcher, so the kernel mediates file access at operation time. No namespaces — uid, ownership and `/proc` stay exactly as on the host, which is what makes git/ssh and device access behave.

It also adds what the stock shim lacks: **one directory at a time, granted while the session runs, only when the model asks and you approve**.

```text
> the generated files should land in ~/Documents/assets/renders
request_write_access(path="~/Documents/assets/renders")
```

The request goes through the harness approval seam: you see the directory, and only an approval mints the grant. It is registered through `SandboxPolicyService.registerWritableRoot`, so it applies to the session's next confined call (bash and the file tools alike), and it never widens the sandbox mode.

## Install

```sh
dsh plugin --profile web add github:<owner>/dsh-sandbox-better
# or from a local checkout
dsh plugin --profile web add /path/to/dsh-sandbox-better
```

Restart the web surface afterwards (bundle layer). Requirements: Linux with Landlock, DSH `>=0.2.2-rc.2` (the release that exposes `registerWritableRoot`).

## Verify

`touch /etc/x` inside the sandbox → `Permission denied` (EACCES) = active.
`Read-only file system` (EROFS) = still the stock bwrap provider.

Ask the agent to write outside the workspace; it reports the denial, calls
`request_write_access` for that directory, and retries only after you
approve. Grants last for the session and need a new request after resume or fork.

## Config

| Key | Default | Meaning |
|---|---|---|
| `writeDirs` | see `cordis.patch.yml` | Extra writable dirs for every session under `workspace-write`, `~` expanded |
| `devicePaths` | `[]` | Serial-port style device nodes, glob expanded per command; hotplug-safe |
| `launcherPath` | auto-detect | Explicit path to the `landlock-run` binary |

Launcher resolution, grant argv and the functional probe come from the official `@deepseek-ai/node-addon-landlock-run` JS seam (located next to the dsh install and imported by absolute path — no dependency edge). At mount the vendor `--probe` verdict becomes the reported enforcement (`full`/`partial`); `unusable` aborts mounting (fail-closed).

The provider also subclasses the upstream `dsh-fs-local` implementation, so the file tools enforce the same roots as bash: the session workspace, `/tmp`, this plugin's `writeDirs`, and every `additionalWritableRoots` entry — which is where session grants land. The stock `dsh-fs-sandbox` provider is disabled by the companion patch.

## Trade-offs

- No private PID namespace / `/proc`: host processes stay visible.
- Landlock metadata gap: `chmod/chown/utime/setxattr` on owned files are not governed.
- Grants are runtime-only: they are not saved in the session log and must be re-issued after resume or fork (the harness API's own contract). There is no revoke surface; end the session, or switch the permission preset, to drop them.
- Grants apply to the next call; a process already running keeps its resolved permissions.
- Off Linux: no sandbox service provided.

## Devices

`devicePaths` entries are read-write grants (`--rw`), resolved per command rather than at mount: Landlock rules bind the inode, not the path, so a replugged serial port gets a new inode and a mount-time snapshot would silently stop matching. Globs are expanded and directory hits dropped on every `confine`, so a port that appears later works on the next command and one that disappears never reaches the launcher (an unopenable grant root is exit 125 — the whole command would not run). `/dev/serial/by-id/*` may be listed too: `O_PATH` follows the symlink, granting exactly the device it currently points at.

## 中文

面向 DSH 的 Landlock 沙箱 provider：不走 bwrap/namespace，uid 与文件属主保持主机原样；抓不住路径的场合靠 `landlock-run` 在每次执行时按 inode 施加规则。除沙箱本体外，它补上「按目录、按会话」的授权：模型写不进去时调 `request_write_access`，你在审批框里看到具体目录，批准后该目录立即可写，沙箱模式始终不动。

## License

MIT
