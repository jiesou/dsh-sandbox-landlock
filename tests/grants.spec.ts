import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyGrants, grantDirectory, listGrants, resolveGrantDir, revokeDirectory } from '../src/grants'

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
    commands: {
      register: (command: Record<string, unknown>) => {
        registered.set(`/${command.name as string}`, command)
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
    const session: FakeSession = { header: { cwd: root } }
    const other: FakeSession = { header: { cwd: root } }
    mkdirSync(join(root, 'a'))
    grantDirectory(host, session, 'a')
    grantDirectory(host, session, 'a')
    expect(host.sandboxPolicy.registerWritableRoot).toHaveBeenCalledTimes(1)
    expect(listGrants(session)).toEqual([join(root, 'a')])
    expect(listGrants(other)).toEqual([])
  })

  it('撤销只移除本插件的注册', () => {
    const { host } = fakeHost()
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))
    const session: FakeSession = { header: { cwd: root } }
    grantDirectory(host, session, 'a')
    expect(revokeDirectory(session, 'a')).toBe(join(root, 'a'))
    expect(listGrants(session)).toEqual([])
    expect(() => revokeDirectory(session, 'a')).toThrow(/not granted/u)
  })
})

describe('/grant command', () => {
  it('授予、列出、撤销', () => {
    const { registered } = fakeHost()
    const command = registered.get('/grant') as {
      handler: (invocation: { agent: { session: FakeSession }; rawInput: string }) => { kind: string; text: string }
    }
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))
    const agent = { session: { header: { cwd: root } } }

    expect(command.handler({ agent, rawInput: ' a' })).toEqual({
      kind: 'success',
      text: `Granted write access to ${join(root, 'a')} for this session.`,
    })
    expect(command.handler({ agent, rawInput: ' list' }).text).toContain(join(root, 'a'))
    expect(command.handler({ agent, rawInput: ' revoke a' })).toEqual({
      kind: 'success',
      text: `Revoked write access to ${join(root, 'a')}.`,
    })
    expect(command.handler({ agent, rawInput: ' missing' }).kind).toBe('error')
  })
})

describe('grant tool', () => {
  const tool = () => {
    const { host, registered } = fakeHost()
    return {
      host,
      definition: registered.get('grant') as {
        execute: (
          args: Record<string, unknown>,
          exec: { agent: { session: FakeSession }; callId: string; signal: AbortSignal },
        ) => Promise<{ action: string; path?: string; grants: string[] }>
      },
    }
  }

  it('授权前先问用户，获批后才登记', async () => {
    const { host, definition } = tool()
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))
    const session = { header: { cwd: root } }

    const result = await definition.execute(
      { path: 'a', reason: 'build output' },
      { agent: { session }, callId: 'call-1', signal: new AbortController().signal },
    )

    expect(host.approval.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'grant',
      callId: 'call-1',
      reason: `build output Directory: ${join(root, 'a')}`,
    }))
    expect(result).toMatchObject({ action: 'grant', path: join(root, 'a'), grants: [join(root, 'a')] })
  })

  it('用户拒绝时不登记', async () => {
    const { host, definition } = tool()
    host.approval.request.mockResolvedValueOnce('rejected')
    const root = sandboxDir()
    mkdirSync(join(root, 'a'))

    await expect(definition.execute(
      { path: 'a', reason: 'build output' },
      { agent: { session: { header: { cwd: root } } }, callId: 'call-2', signal: new AbortController().signal },
    )).rejects.toThrow(/did not allow/u)
    expect(host.sandboxPolicy.registerWritableRoot).not.toHaveBeenCalled()
  })

  it('缺少 reason 或 path 时报错，list 不需要审批', async () => {
    const { host, definition } = tool()
    const root = sandboxDir()
    const exec = {
      agent: { session: { header: { cwd: root } } },
      callId: 'call-3',
      signal: new AbortController().signal,
    }
    await expect(definition.execute({ path: 'a' }, exec)).rejects.toThrow(/reason is required/u)
    await expect(definition.execute({ reason: 'x' }, exec)).rejects.toThrow(/path is required/u)
    await expect(definition.execute({ action: 'list' }, exec)).resolves.toMatchObject({ action: 'list', grants: [] })
    expect(host.approval.request).not.toHaveBeenCalled()
  })
})
