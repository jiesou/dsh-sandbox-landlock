import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'

/** The session subset grants need: its working directory anchors relative paths. */
export interface GrantSession {
  header: { cwd?: string }
}

interface Grant {
  readonly dir: string
  readonly dispose: () => void
}

interface CommandInvocationLike {
  readonly agent: { session: GrantSession }
  readonly rawInput: string
}

interface CommandResultLike {
  readonly kind: 'success' | 'error'
  readonly text: string
}

interface ToolRunContextLike {
  readonly agent?: { session: GrantSession }
  readonly callId?: string
  readonly signal?: AbortSignal
}

interface ToolArgs {
  readonly action?: 'grant' | 'revoke' | 'list'
  readonly path?: string
  readonly reason?: string
}

interface ApprovalRequestLike {
  readonly agent: unknown
  readonly toolName: string
  readonly callId?: string
  readonly reason: string
  readonly signal?: AbortSignal
}

/** Host services grants consume, all optional except the policy that owns the grant registry. */
export interface GrantHost {
  sandboxPolicy: { registerWritableRoot(session: unknown, directory: string): () => void }
  approval?: { request(request: ApprovalRequestLike): Promise<string> }
  tools?: { register(tool: unknown): () => void }
  commands?: { register(command: unknown): () => void }
  systemPrompt?: {
    section(section: unknown): () => void
    getSectionOrder(name: string): number
  }
  effect?: (callback: () => () => void, label?: string) => unknown
}

const USAGE = 'Usage: /grant <dir> | /grant list | /grant revoke <dir>'

/** One live Session's grants, keyed by the canonical directory they cover. */
const registry = new WeakMap<GrantSession, Map<string, Grant>>()

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Expand `~`, anchor relative paths at the session workspace, and resolve symlinks. */
export function resolveGrantDir(session: GrantSession, input: string): string {
  const raw = input.trim()
  if (raw === '') throw new Error('grant: a directory is required')
  const expanded = raw === '~'
    ? homedir()
    : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw
  const base = session.header.cwd ?? process.cwd()
  const absolute = isAbsolute(expanded) ? expanded : resolvePath(base, expanded)
  let stats
  try {
    stats = statSync(absolute)
  } catch {
    throw new Error(`grant: "${raw}" does not exist`)
  }
  if (!stats.isDirectory()) throw new Error(`grant: "${raw}" is not a directory`)
  // The enforcing host rejects symlinked roots, so grants carry the physical path.
  return realpathSync(absolute)
}

function grantResolved(host: GrantHost, session: GrantSession, dir: string): string {
  const grants = registry.get(session) ?? new Map<string, Grant>()
  if (!grants.has(dir)) {
    grants.set(dir, { dir, dispose: host.sandboxPolicy.registerWritableRoot(session, dir) })
    registry.set(session, grants)
  }
  return dir
}

/** Grant one directory to the session's future workspace-write calls; idempotent. */
export function grantDirectory(host: GrantHost, session: GrantSession, input: string): string {
  return grantResolved(host, session, resolveGrantDir(session, input))
}

/** Withdraw one session grant; only this registration is removed. */
export function revokeDirectory(session: GrantSession, input: string): string {
  const dir = resolveGrantDir(session, input)
  const grants = registry.get(session)
  const grant = grants?.get(dir)
  if (grants === undefined || grant === undefined) {
    throw new Error(`grant: "${dir}" is not granted in this session`)
  }
  grant.dispose()
  grants.delete(dir)
  if (grants.size === 0) registry.delete(session)
  return dir
}

/** Directories this plugin granted to one session, sorted for stable output. */
export function listGrants(session: GrantSession): string[] {
  const grants = registry.get(session)
  if (grants === undefined) return []
  return [...grants.values()].map((grant) => grant.dir).sort()
}

function formatGrants(session: GrantSession): string {
  const grants = listGrants(session)
  if (grants.length === 0) return 'No directory grants in this session. Use /grant <dir> to add one.'
  return `Directory grants in this session:\n${grants.map((dir) => `- ${dir}`).join('\n')}`
}

function commandDefinition(host: GrantHost): unknown {
  return {
    name: 'grant',
    description: 'Allow writes under one directory for this session',
    input: { hint: '<dir> | list | revoke <dir>' },
    handler(invocation: CommandInvocationLike): CommandResultLike {
      const raw = invocation.rawInput.trim()
      const session = invocation.agent.session
      if (raw === '' || raw === 'list') return { kind: 'success', text: formatGrants(session) }
      if (raw === 'revoke' || raw.startsWith('revoke ')) {
        const target = raw.slice('revoke'.length).trim()
        if (target === '') return { kind: 'error', text: USAGE }
        try {
          return { kind: 'success', text: `Revoked write access to ${revokeDirectory(session, target)}.` }
        } catch (error: unknown) {
          return { kind: 'error', text: reasonOf(error) }
        }
      }
      try {
        return { kind: 'success', text: `Granted write access to ${grantDirectory(host, session, raw)} for this session.` }
      } catch (error: unknown) {
        return { kind: 'error', text: reasonOf(error) }
      }
    },
  }
}

function toolDefinition(host: GrantHost): unknown {
  return {
    name: 'grant',
    description: 'Allow writes under one directory for this session, or list and revoke the grants this session holds. '
      + 'Call it when a command or file write fails because a path outside the session workspace is read-only; '
      + 'the user is asked to approve each new directory.',
    parameters: {
      action: { type: 'string', enum: ['grant', 'revoke', 'list'], description: 'What to do. Defaults to grant.' },
      path: {
        type: 'string',
        description: 'Directory, absolute or relative to the session workspace; `~` expands. Required for grant and revoke.',
      },
      reason: {
        type: 'string',
        description: 'One sentence for the user explaining why this directory needs write access. Required for grant.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'grants', 'message'],
        properties: {
          action: { type: 'string', enum: ['grant', 'revoke', 'list'] },
          path: { type: 'string' },
          grants: { type: 'array', items: { type: 'string' } },
          message: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { message: string }) => [{ type: 'text', text: value.message }],
    },
    async execute(args: ToolArgs, exec: ToolRunContextLike) {
      const action = args.action ?? 'grant'
      const session = exec.agent?.session
      if (session === undefined) throw new Error('grant: this call has no session to grant to')
      if (action === 'list') return { action, grants: listGrants(session), message: formatGrants(session) }
      const path = args.path?.trim() ?? ''
      if (path === '') throw new Error(`grant: path is required for action "${action}"`)
      if (action === 'revoke') {
        const dir = revokeDirectory(session, path)
        return { action, path: dir, grants: listGrants(session), message: `Revoked write access to ${dir}.` }
      }
      if (action !== 'grant') throw new Error(`grant: unknown action "${action}"`)
      const reason = args.reason?.trim() ?? ''
      if (reason === '') throw new Error('grant: reason is required when asking for a directory')
      const dir = resolveGrantDir(session, path)
      if (host.approval === undefined) throw new Error('grant: approvals are unavailable in this composition')
      let outcome: string
      try {
        outcome = await host.approval.request({
          agent: exec.agent,
          toolName: 'grant',
          ...exec.callId === undefined ? {} : { callId: exec.callId },
          reason: `${reason} Directory: ${dir}`,
          ...exec.signal === undefined ? {} : { signal: exec.signal },
        })
      } catch (error: unknown) {
        throw new Error(`grant: the approval request failed: ${reasonOf(error)}`)
      }
      if (outcome !== 'allowed-once') {
        throw new Error(`grant: the user did not allow write access to ${dir} (${outcome})`)
      }
      grantResolved(host, session, dir)
      return { action, path: dir, grants: listGrants(session), message: `Granted write access to ${dir} for this session.` }
    },
  }
}

/**
 * Register `/grant` and the `grant` tool. The command acts for the user; the
 * tool asks first, because widening a policy is the user's decision.
 */
export function applyGrants(host: GrantHost): void {
  const register = (): (() => void) => {
    const disposers: Array<() => void> = []
    if (host.commands !== undefined) disposers.push(host.commands.register(commandDefinition(host)))
    if (host.tools !== undefined) {
      disposers.push(host.tools.register(toolDefinition(host)))
      if (host.systemPrompt !== undefined) {
        host.systemPrompt.section({
          name: 'tool:grant',
          order: host.systemPrompt.getSectionOrder('TOOL_BASH'),
          text: 'When a path outside the session workspace is not writable, call the `grant` tool for that directory '
            + 'instead of retrying with sandbox_permissions; the wider sandbox mode stays off.',
        })
      }
    }
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }
  if (host.effect === undefined) {
    register()
    return
  }
  host.effect(register, 'sandbox-better grants')
}
