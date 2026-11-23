# dsh-sandbox-landlock

A Landlock process-sandbox provider for DSH: no namespaces, uid and file ownership stay exactly as on the host.

[简体中文](README.md)

DSH's default Linux backend is bwrap. It builds the sandbox out of namespaces and read-only binds, which means a different uid view, a private `/proc` and device nodes that do not match the host — the usual reason git, ssh and serial tools misbehave inside the sandbox.

This plugin uses Landlock alone (the DSH wrapper around [`landlock-run`](https://github.com/Zouuup/landrun)): the kernel adjudicates every file open, and nothing is remounted. A denial surfaces as `EACCES`, not bwrap's `EROFS`.

It owns **enforcement only**. The model-facing tool that asks for one writable directory lives in [dsh-sandbox-better](https://github.com/jiesou/dsh-sandbox-better), which is backend-agnostic.

## Install

```sh
dsh plugin --profile web add github:jiesou/dsh-sandbox-landlock
# or from a local checkout
dsh plugin --profile web add /path/to/dsh-sandbox-landlock
```

Restart the web surface afterwards. Requirements: Linux with Landlock, DSH `>=0.2.2-rc.2`.

## What it can write

Exactly the official `sandbox-policy`, with no directory list of its own:

- `read-only`: `/dev/null` only;
- `workspace-write`: the session workspace, `/tmp`, `sandbox-policy.additionalWritableRoots`, and anything registered for the session through `registerWritableRoot` (that is what dsh-sandbox-better's `request_write_access` does);
- `danger-full-access`: consumers spawn directly and never reach this provider.

## Configuration

```yaml
- id: sandbox-landlock
  name: dsh-sandbox-landlock
  config:
    devicePaths:
      - /dev/ttyUSB*
      - /dev/ptmx
      - /dev/dri/renderD*
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `devicePaths` | `string[]` | `[]` | Device nodes granted read-write, globs allowed; expanded per command, so a replugged device works on the next one |
| `launcherPath` | `string` | auto-detect | Explicit `landlock-run` binary |

`devicePaths` expands per command rather than snapshotting at mount: Landlock rules bind inodes, and a replugged serial port gets a new one. A missing device is dropped, so the launcher never fails closed (exit 125) on it.

## Enforcement boundary

- The file tools follow the same Landlock semantics: the plugin replaces the `dsh-fs-sandbox` provider and checks every write against the same resolved policy.
- `cordis.patch.yml` disables the stock providers on Linux only (`disabled: !!js process.platform === 'linux'`); other platforms keep the official backends.
- When the functional probe reports `unusable`, the plugin refuses to mount and says why (fail-closed) instead of silently running unsandboxed.

## Limitations

- No private PID namespace / `/proc`: host processes stay visible.
- Landlock metadata gap: `chmod` / `chown` / `utime` / `setxattr` on owned files are not governed.
- Provided on Linux only.

## Development

```sh
pnpm install
pnpm run check   # typecheck + build + test
```

`lib/` is the build output and is committed so `github:` installs need no build step.

## License

[MIT](LICENSE)
