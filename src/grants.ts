import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { permissionRequestDisplayReason } from './locales'

/** The session subset grants need: its working directory anchors relative paths. */
export interface GrantSession {
  header: { cwd?: string }
}

interface GrantAgent {
  readonly session: GrantSession
}

interface ToolRunContextLike {
  readonly agent?: { session: GrantSession }
  readonly callId?: string
  readonly signal?: AbortSignal
}

interface ToolArgs {
  readonly path?: string
}

interface ApprovalRequestLike {
  readonly agent: unknown
  readonly toolName: string
  readonly callId?: string
  readonly reason: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly signal?: AbortSignal
}

/** Host services the request tool consumes; every one is looked up when it is used. */
export interface GrantHost {
  readonly sandboxPolicy: { registerWritableRoot(session: unknown, directory: string): () => void }
  readonly approval?: { request(request: ApprovalRequestLike): Promise<string> }
  readonly tools?: {
    register(tool: unknown, options?: { when?: (context: { agent: GrantAgent }) => boolean }): () => void
  }
  /** The sandbox mode this agent's next call would run under. */
  readonly modeOf?: (agent: GrantAgent) => string
  readonly systemPrompt?: {
    section(section: unknown): () => void
    getSectionOrder(name: string): number
  }
  readonly effect?: (callback: () => () => void, label?: string) => unknown
}

export const TOOL_NAME = 'request_write_access'

/** One live Session's grants, keyed by the physical directory they cover. */
const registry = new WeakMap<GrantSession, Map<string, () => void>>()

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Expand `~`, anchor relative paths at the session workspace, and resolve symlinks. */
export function resolveGrantDir(session: GrantSession, input: string): string {
  const raw = input.trim()
  if (raw === '') throw new Error(`${TOOL_NAME}: a directory is required`)
  const expanded = raw === '~'
    ? homedir()
    : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw
  const base = session.header.cwd ?? process.cwd()
  const absolute = isAbsolute(expanded) ? expanded : resolvePath(base, expanded)
  let stats
  try {
    stats = statSync(absolute)
  } catch {
    throw new Error(`${TOOL_NAME}: "${raw}" does not exist`)
  }
  if (!stats.isDirectory()) throw new Error(`${TOOL_NAME}: "${raw}" is not a directory`)
  // The enforcing host rejects symlinked roots, so grants carry the physical path.
  return realpathSync(absolute)
}

/** Register one physical directory for a session's future workspace-write calls; idempotent. */
export function grantDirectory(host: GrantHost, session: GrantSession, input: string): string {
  const dir = resolveGrantDir(session, input)
  const grants = registry.get(session) ?? new Map<string, () => void>()
  if (!grants.has(dir)) {
    grants.set(dir, host.sandboxPolicy.registerWritableRoot(session, dir))
    registry.set(session, grants)
  }
  return dir
}

/** Directories this plugin granted to one session, sorted for stable output. */
export function listGrants(session: GrantSession): string[] {
  const grants = registry.get(session)
  if (grants === undefined) return []
  return [...grants.keys()].sort()
}

function toolDefinition(host: GrantHost): unknown {
  return {
    name: TOOL_NAME,
    description: 'Ask the user to make one directory writable for this session. '
      + 'Under workspace-write only the workspace is writable and everything else is read-only; '
      + 'call this after a write there was denied, then retry.',
    parameters: {
      path: {
        type: 'string',
        description: 'Directory, absolute or relative to the workspace; `~` expands.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { path: string }) => [{
        type: 'text',
        text: `${value.path} is writable for this session.`,
      }],
    },
    async execute(args: ToolArgs, exec: ToolRunContextLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error(`${TOOL_NAME}: this call has no session to grant to`)
      const path = args.path?.trim() ?? ''
      if (path === '') throw new Error(`${TOOL_NAME}: path is required`)
      const dir = resolveGrantDir(session, path)
      const approval = host.approval
      if (approval === undefined) throw new Error(`${TOOL_NAME}: this composition has no approval service`)
      let outcome: string
      try {
        outcome = await approval.request({
          agent: exec.agent,
          toolName: TOOL_NAME,
          ...exec.callId === undefined ? {} : { callId: exec.callId },
          reason: `Write access to ${dir} for this session.`,
          displayReason: permissionRequestDisplayReason(dir),
          ...exec.signal === undefined ? {} : { signal: exec.signal },
        })
      } catch (error: unknown) {
        throw new Error(`${TOOL_NAME}: the approval request failed: ${reasonOf(error)}`)
      }
      if (outcome !== 'allowed-once') {
        throw new Error(`${TOOL_NAME}: the user did not allow writes under ${dir} (${outcome})`)
      }
      grantDirectory(host, session, path)
      return { path: dir }
    },
  }
}

/** Register the request tool and its one-line prompt guidance. */
export function applyGrants(host: GrantHost): void {
  const register = (): (() => void) => {
    const tools = host.tools
    if (tools === undefined) return () => {}
    const dispose = tools.register(toolDefinition(host), {
      // Full access already allows every path; a request would only confuse.
      when: ({ agent }) => host.modeOf?.(agent) !== 'danger-full-access',
    })
    const prompt = host.systemPrompt
    if (prompt !== undefined) {
      prompt.section({
        name: `tool:${TOOL_NAME}`,
        order: prompt.getSectionOrder('TOOL_BASH'),
        text: `A path outside the workspace is read-only: request it with \`${TOOL_NAME}\`, not sandbox_permissions.`,
      })
    }
    return dispose
  }
  if (host.effect === undefined) {
    register()
    return
  }
  host.effect(register, 'sandbox-better permission requests')
}
