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
- One model-facing tool, `request_write_access(path)`. It resolves and
  validates the directory first, then asks the approval seam with a host-written
  sentence, and only `allowed-once` mints the grant. The model supplies no
  justification text: the directory is the whole request.
- No human command: widening a directory is the model's request and the user's
  decision, so the tool is the only surface. Revoking means ending the session
  or switching the permission preset.
- Services are resolved lazily at call time. Capturing `ctx.get('approval')`
  during mount yielded `undefined` — the approval fiber is not necessarily
  active while a sibling plugin registers — and every request then failed with
  "approvals are unavailable in this composition".
- Grants resolve `~` and relative paths against the Session workspace, and store
  the physical path (the enforcing host rejects symlinked roots).
- The registry is plugin-owned (`WeakMap<Session, Map<dir, disposer>>`), so one
  directory is registered once per session, and the system prompt tells the
  model to prefer the request over `sandbox_permissions`.

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

## Addendum: tolerant escalation arguments

`tools/pre-execute` may replace the parsed arguments before dispatch (verified
against a headless run: a rewritten `command` reached the shell). The plugin
uses that only for the escalation pair on bash/pwsh/write/edit — stray or blank
justification, a missing reason, and same-or-narrower targets. Command, path and
content stay untouched so the logged call still matches what the model asked for.
