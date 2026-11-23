import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { apply, normalizeDirs } from '../src/index'
import { homedir } from 'node:os'

const workspace = mkdtempSync(join(tmpdir(), 'dsb-spec-workspace-'))
const extra = mkdtempSync(join(tmpdir(), 'dsb-spec-extra-'))

const provided = new Map<string, unknown>()
let confine!: (
  commandArgv: readonly string[],
  policy: { mode: string; workspaceRoot: string; additionalWritableRoots?: readonly string[] },
) => { argv: string[]; enforcement: string; denialSignatures: string[]; runnerFailureRules: Array<Record<string, unknown>> }

beforeAll(async () => {
  await apply({ provide: (id, service) => { provided.set(id, service) } }, {})
  confine = (provided.get('sandbox') as { confine: typeof confine }).confine
})

describe('normalizeDirs', () => {
  it('展开 ~、去重、剔除空项', () => {
    expect(normalizeDirs(['~/.npm', `${homedir()}/.npm`, '', '~/.cache']))
      .toEqual([`${homedir()}/.npm`, `${homedir()}/.cache`])
  })
})

describe('workspace-write', () => {
  const policy = {
    mode: 'workspace-write',
    workspaceRoot: workspace,
    additionalWritableRoots: [extra, `${extra}/`],
  }
  let wrapped: ReturnType<typeof confine>

  beforeAll(() => {
    wrapped = confine(['bash', '-c', 'echo hi'], policy)
  })

  it('launcher 在最前，--ro 只授予 /，原 argv 完整保留', () => {
    expect(wrapped.argv[0].endsWith('landlock-run')).toBe(true)
    expect(wrapped.argv.some((x, i) => x === '--ro' && wrapped.argv[i + 1] !== '/')).toBe(false)
    const sep = wrapped.argv.indexOf('--')
    expect(wrapped.argv.slice(sep + 1)).toEqual(['bash', '-c', 'echo hi'])
  })

  it('官方 additionalWritableRoots 进入 rw 面且去重', () => {
    expect(wrapped.argv).toContain(realpathSync(workspace))
    expect(wrapped.argv).toContain(realpathSync(extra))
    expect(wrapped.argv.filter((x) => x === realpathSync(extra))).toHaveLength(1)
    expect(wrapped.argv).toContain('/tmp')
  })

  it('分类事实对齐官方 LANDLOCK 方言：真实探针判定 + EACCES + exit 125 契约', () => {
    expect(['full', 'partial']).toContain(wrapped.enforcement)
    expect(wrapped.denialSignatures).toEqual(['permission denied'])
    expect(wrapped.runnerFailureRules[0]).toMatchObject({
      allowedExitCodes: [125],
      fatalSignatures: ['landlock-run: '],
      informationalLines: ['landlock-run: partial enforcement (older Landlock ABI)'],
    })
  })
})

describe('缺失目录', () => {
  it('不存在的授权根被剔除（launcher 对打不开的授权根 exit 125），存在的保留', () => {
    const missing = join(tmpdir(), 'dsb-spec-definitely-missing')
    expect(existsSync(missing)).toBe(false)
    const wrapped = confine(['bash', '-c', 'echo hi'], {
      mode: 'workspace-write',
      workspaceRoot: workspace,
      additionalWritableRoots: ['/tmp', missing],
    })
    expect(wrapped.argv).not.toContain(missing)
    expect(wrapped.argv).toContain('/tmp')
  })
})

describe('devicePaths', () => {
  const devDir = mkdtempSync(join(tmpdir(), 'dsb-spec-devices-'))
  const present = ['ttyUSB0', 'ttyUSB1'].map((name) => {
    const path = join(devDir, name)
    writeFileSync(path, '')
    return path
  })
  const nested = join(devDir, 'ttyUSB-hub')
  mkdirSync(nested, { recursive: true })

  it('通配符在每次 confine 时展开，命中的设备进 rw 面', async () => {
    const provided3 = new Map<string, unknown>()
    await apply(
      { provide: (id, service) => { provided3.set(id, service) } },
      { devicePaths: [`${devDir}/ttyUSB*`, '/dev/null'] },
    )
    const confine3 = (provided3.get('sandbox') as { confine: typeof confine }).confine
    const wrapped3 = confine3(['bash', '-c', 'echo hi'], { mode: 'workspace-write', workspaceRoot: workspace })
    for (const path of present) expect(wrapped3.argv).toContain(path)
    expect(wrapped3.argv).not.toContain(nested)
    expect(wrapped3.argv.filter((x) => x === '/dev/null')).toHaveLength(1)
  })

  it('缺席的设备不进授权面（launcher 对打不开的授权根 exit 125）', async () => {
    const provided3 = new Map<string, unknown>()
    await apply(
      { provide: (id, service) => { provided3.set(id, service) } },
      { devicePaths: [`${devDir}/ttyACM*`] },
    )
    const confine3 = (provided3.get('sandbox') as { confine: typeof confine }).confine
    const wrapped3 = confine3(['bash', '-c', 'echo hi'], { mode: 'workspace-write', workspaceRoot: workspace })
    expect(wrapped3.argv.some((x) => x.startsWith(`${devDir}/ttyACM`))).toBe(false)
  })

  it('read-only 模式不授设备', () => {
    const ro = confine(['bash', '-c', 'echo hi'], { mode: 'read-only', workspaceRoot: workspace })
    for (const path of present) expect(ro.argv).not.toContain(path)
  })
})

describe('read-only', () => {
  it('只有 /dev/null 可写，不收 /tmp、workspace、additionalWritableRoots', () => {
    const ro = confine(['bash', '-c', 'echo hi'], {
      mode: 'read-only',
      workspaceRoot: workspace,
      additionalWritableRoots: [extra],
    })
    expect(ro.argv).not.toContain(workspace)
    expect(ro.argv).not.toContain('/tmp')
    expect(ro.argv).not.toContain(extra)
    const rwAt = ro.argv.indexOf('--rw')
    expect(rwAt).toBeGreaterThan(-1)
    expect(ro.argv[rwAt + 1]).toBe('/dev/null')
    expect(ro.argv.filter((x) => x === '--rw')).toHaveLength(1)
  })
})
