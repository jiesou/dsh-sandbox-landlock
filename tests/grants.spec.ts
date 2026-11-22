import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TOOL_NAME, applyGrants, grantDirectory, listGrants, resolveGrantDir } from '../src/grants'

interface FakeSession {
  header: { cwd: string }
}

function sandboxDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsb-grant-'))
}

function fakeHost() {
  const registered = new Map<string, Record<string, unknown>>()
  const host = {
    sandboxPolicy: { registerWritableRoot: vi.fn(() => () => {}) },
    approval: { request: vi.fn(async () => 'allowed-once') },
    tools: {
      register: (tool: Record<string, unknown>) => {
        registered.set(tool.name as string, tool)
        return () => {}
      },
    },
  }
  applyGrants(host)
  return { host, registered }
}

describe('resolveGrantDir', () => {
  it('锚定会话工作目录、解析 ~ 与符号链接', () => {
    const root = sandboxDir()
    mkdirSync(join(root, 'sub'))
    const session: FakeSession = { header: { cwd: root } }
    expect(resolveGrantDir(session, 'sub')).toBe(join(root, 'sub'))
  })

  it('拒绝不存在的路径与文件', () => {
    const root = sandboxDir()
    const session: FakeSession = { header: { cwd: root } }
    expect(() => resolveGrantDir(session, 'missing')).toThrow(/does not exist/u)
    expect(() => resolveGrantDir(session, '')).toThrow(/directory is required/u)
  })
})

describe('grants registry', () => {
  it('授予一次、重复授予幂等、按会话隔离', () => {
    const { host } = fakeHost()
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))
    const session: FakeSession = { header: { cwd: root } }
    const other: FakeSession = { header: { cwd: root } }
    grantDirectory(host, session, 'a')
    grantDirectory(host, session, 'a')
    expect(host.sandboxPolicy.registerWritableRoot).toHaveBeenCalledTimes(1)
    expect(listGrants(session)).toEqual([join(root, 'a')])
    expect(listGrants(other)).toEqual([])
  })
})

describe('sandbox_permission_request tool', () => {
  const tool = () => {
    const { host, registered } = fakeHost()
    return {
      host,
      definition: registered.get(TOOL_NAME) as {
        execute: (
          args: Record<string, unknown>,
          exec: { agent: { session: FakeSession }; callId: string; signal: AbortSignal },
        ) => Promise<{ path: string; granted: boolean }>
      },
    }
  }

  it('授权前先问用户，获批后才登记', async () => {
    const { host, definition } = tool()
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))

    const result = await definition.execute(
      { path: 'a' },
      { agent: { session: { header: { cwd: root } } }, callId: 'call-1', signal: new AbortController().signal },
    )

    expect(host.approval.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: TOOL_NAME,
      callId: 'call-1',
      reason: `Write access to ${join(root, 'a')} for this session.`,
    }))
    expect(result).toEqual({ path: join(root, 'a'), granted: true })
  })

  it('用户拒绝时不登记', async () => {
    const { host, definition } = tool()
    host.approval.request.mockResolvedValueOnce('rejected')
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))

    await expect(definition.execute(
      { path: 'a' },
      { agent: { session: { header: { cwd: root } } }, callId: 'call-2', signal: new AbortController().signal },
    )).rejects.toThrow(/did not allow/u)
    expect(host.sandboxPolicy.registerWritableRoot).not.toHaveBeenCalled()
  })

  it('缺少 path 或没有审批服务时报错', async () => {
    const { host, definition } = tool()
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))
    const exec = {
      agent: { session: { header: { cwd: root } } },
      callId: 'call-3',
      signal: new AbortController().signal,
    }
    await expect(definition.execute({}, exec)).rejects.toThrow(/path is required/u)

    const withoutApproval = { ...host, approval: undefined }
    const registered = new Map<string, Record<string, unknown>>()
    applyGrants({
      ...withoutApproval,
      tools: {
        register: (tool: Record<string, unknown>) => {
          registered.set(tool.name as string, tool)
          return () => {}
        },
      },
    })
    const bare = registered.get(TOOL_NAME) as { execute: typeof definition.execute }
    await expect(bare.execute({ path: 'a' }, exec)).rejects.toThrow(/no approval service/u)
  })
})
