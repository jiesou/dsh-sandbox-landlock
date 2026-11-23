# dsh-sandbox-better

A Landlock-only sandbox for DSH, plus a model tool that asks for one writable directory at a time.

[简体中文](README.md)

The default `workspace-write` mode lets the agent write only inside the workspace; everything else is read-only. The only escape hatch used to be `sandbox_permissions`, which widens the whole session to full access just to write into one directory.

This plugin does two things:

1. **Replaces the process sandbox backend** with plain Landlock (`landlock-run`), no namespaces. uid, file ownership and `/proc` look exactly like the host, so git and ssh never trip over a mapped uid.
2. **Gives the model a per-directory request**: the `request_write_access` tool. You approve it on the card ("Allow for this session"), the plugin calls the official `SandboxPolicyService.registerWritableRoot`, and that directory becomes writable for this session's bash and file tools. The grant dies with the session; the sandbox mode never changes.

## Install

From GitHub:

```sh
dsh plugin --profile web add github:<owner>/dsh-sandbox-better
```

From a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-sandbox-better
```

Restart the web surface afterwards — both the bundle layer and the client manifest are read at boot.

Requirements: Linux with Landlock, DSH `>=0.2.2-rc.2` (the release that exposes `registerWritableRoot`).

## Where writable directories come from

Two sources, neither of them plugin config:

**Session scope** — the model calls `request_write_access(path=...)` and you approve:

```
tool: request_write_access { path: "~/Documents/dev/other-repo" }
card: Allow writes under /var/home/chen/Documents/dev/other-repo?
      [Allow for this session] [Reject]
```

The grant applies to the current session only. End the session, or switch the permission preset, to drop it — the plugin keeps no file and no persistent state.

**Deployment scope** — directories shared by every session live on the `sandbox-policy` row:

```yaml
- id: sandbox-policy
  config:
    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
    workspaceRoot: !!js process.cwd()
    additionalWritableRoots:
      - /var/home/chen/.cache
      - /var/home/chen/.npm
```

That is the official contract: writable under `workspace-write`, nothing under `read-only`, irrelevant under `danger-full-access`.

## Configuration

```yaml
- id: sandbox-better
  name: dsh-sandbox-better
  config:
    devicePaths:
      - /dev/ttyUSB*
      - /dev/ptmx
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `devicePaths` | `string[]` | `[]` | Device nodes granted read-write, globs allowed; expanded per command, so replugged devices work on the next one |
| `launcherPath` | `string` | auto-detect | Explicit `landlock-run` binary |

The old `writeDirs` key is gone: deployment-wide directories belong in `sandbox-policy.additionalWritableRoots`, session directories come from `request_write_access`.

## Tool and approval card

- The tool is `request_write_access` with a single `path` parameter (absolute, or relative to the workspace; `~` expands).
- The card is rendered by this plugin: title "Allow writes under `<path>`?", actions "Allow for this session" / "Reject". It exists because `conversation.composer` is a chain slot — the stock approval card's factory slot refuses a second registration and its button text is hardcoded.
- Every other approval (bash/write escalation) still uses the stock card; this plugin claims only its own requests.
- Under `danger-full-access` the tool is not registered into the step at all (`when` condition), so the model never sees a request that no longer means anything.

## Tolerant escalation arguments

Models frequently lose track of their current mode and write the permission fields wrong. Before dispatch the plugin rewrites only those two fields, for `bash` / `pwsh` / `write` / `edit`:

| Model sent | Handled as |
| --- | --- |
| `justification` without `sandbox_permissions` | dropped |
| widening target without a reason / blank reason | `Agent did not attach a justification.` |
| a known target that is same or narrower | both fields dropped; the call runs under the current mode |
| a value outside the mode vocabulary (`full`, `workspace_write`, …) | left alone, the harness reports `invalid arguments` |

`command`, `path` and `content` are never touched, so the call card and the audit log still show what the model asked for.

## Verify

```sh
# Active sandbox: EACCES (Landlock), not EROFS (bwrap)
touch /etc/probe          # touch: cannot touch '/etc/probe': Permission denied

# A deployment-level directory stays writable
touch ~/.cache/probe      # ok
```

For a session grant, ask the model to write outside the workspace: it reports the denial, calls `request_write_access`, and succeeds after you approve.

## Limitations

- No private PID namespace / `/proc`: host processes stay visible.
- Landlock metadata gap: `chmod` / `chown` / `utime` / `setxattr` on owned files are not governed.
- Grants are runtime-only: they are not written to the session log, must be re-requested after resume or fork, and processes already running keep their permissions.
- Linux only: the stock providers are disabled by `cordis.patch.yml` on Linux alone, so other platforms keep the official backends. The request tool itself is backend-agnostic (it only touches `sandbox-policy`), so bwrap/Seatbelt users get the same UX — this package just does not ship those runners.

## Development

```sh
pnpm install
pnpm run check   # typecheck + build + test
```

`lib/` is the build output and is committed so `github:` installs need no build step.

## License

[MIT](LICENSE)
