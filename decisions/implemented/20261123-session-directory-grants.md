# 2026-11-23 Session directory grants

## Context

Landlock confinement resolves its rules per command, so a grant only has to be
known before the next `confine`. The harness already owns that state:
`SandboxPolicyService.registerWritableRoot(session, directory)` registers a
directory for one live Session and returns the effect disposer, and
`resolve()` folds it into `additionalWritableRoots` for every consumer (bash and
the file tools). What was missing was a surface: a human could only edit
`writeDirs` in the plugin config and restart, and the model had nothing but the
whole-mode `sandbox_permissions` retry.

The provider also dropped `policy.additionalWritableRoots` on the floor, so even
a host that registered a grant could not reach it from bash.

## Decision

- `grantFlags()` and the file provider's root list both read
  `policy.additionalWritableRoots`.
- `/grant <dir> | /grant list | /grant revoke <dir>` acts for the user.
- A `grant` tool exposes the same operation. It resolves and validates the
  directory first, then asks the approval seam, and only `allowed-once` mints
  the grant. Listing and revoking need no approval: they cannot widen anything.
- Grants resolve `~` and relative paths against the Session workspace, and store
  the physical path (the enforcing host rejects symlinked roots).
- The registry is plugin-owned (`WeakMap<Session, Map<dir, disposer>>`) so
  revoking removes exactly this registration, and the system prompt tells the
  model to prefer `grant` over `sandbox_permissions`.

## Consequences

Grants live as long as the Session: they are not persisted, must be reissued
after resume or fork, and a process already running keeps its resolved
permissions — the harness API's own contract, restated in the README. Writes
under `read-only` remain denied, as `registerWritableRoot` grants nothing there.
Headless compositions without an approval answerer fail closed: the tool reports
`grant: approvals are unavailable in this composition`.

## Verification

Unit tests cover resolution, idempotent grants, per-Session isolation, revoke,
the command grammar, and the approval gate (denied → nothing registered).
Headless E2E: `touch /etc/...` → `权限不够` (EACCES, Landlock), `--add-dir`
root writable, other home directory denied, `grant` tool fails closed.
