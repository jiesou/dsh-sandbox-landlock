# dsh-sandbox-better

DSH 的 Landlock 沙箱，外加一个「按需申请可写目录」的模型工具。

[English](README.en.md)

默认的 `workspace-write` 只允许写 workspace，其它地方一律只读。模型写不进去时，以前只有 `sandbox_permissions` 这一档整档提权——它把整个会话放宽到全权限，只为了写一个目录。

本插件做两件事：

1. **替换进程沙箱后端**：只用 Landlock（`landlock-run`），不开 namespace。uid、文件属主、`/proc` 与主机完全一致，git/ssh 不会因为 uid 映射而抽风。
2. **给模型一个按目录申请的口子**：`request_write_access` 工具。你在审批卡上点「本会话允许」，插件调用官方的 `SandboxPolicyService.registerWritableRoot`，该目录对本会话后续的 bash 与文件工具生效；会话结束即失效，沙箱模式始终不变。

## 安装

从 GitHub 安装：

```sh
dsh plugin --profile web add github:<owner>/dsh-sandbox-better
```

或从本地检出安装：

```sh
dsh plugin --profile web add /path/to/dsh-sandbox-better
```

装完重启 web（bundle 层与 client 清单都在启动时读取）。

要求：Linux（内核带 Landlock）、DSH `>=0.2.2-rc.2`（`registerWritableRoot` 从该版本起提供）。

## 可写目录从哪来

只有两个来源，都不在插件配置里：

**会话级**——模型调用 `request_write_access(path=...)`，你批准：

```
tool: request_write_access { path: "~/Documents/dev/other-repo" }
审批卡: 允许写入 /var/home/chen/Documents/dev/other-repo？
        [本会话允许] [拒绝]
```

批准后只对当前会话有效。想撤销就结束会话或切权限预设——插件不提供持久化，也不写任何配置文件。

**部署级**——所有会话共享的目录写在 `sandbox-policy` 行里：

```yaml
- id: sandbox-policy
  config:
    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
    workspaceRoot: !!js process.cwd()
    additionalWritableRoots:
      - /var/home/chen/.cache
      - /var/home/chen/.npm
```

这一层是官方语义：`workspace-write` 下这些目录可写，`read-only` 下不授予，`danger-full-access` 下无所谓。

## 配置项

```yaml
- id: sandbox-better
  name: dsh-sandbox-better
  config:
    devicePaths:
      - /dev/ttyUSB*
      - /dev/ptmx
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `devicePaths` | `string[]` | `[]` | 需要读写权限的设备节点，支持通配符；每条命令 confine 时展开，拔插后下条命令自动生效 |
| `launcherPath` | `string` | 自动探测 | 显式指定 `landlock-run` 二进制 |

旧版的 `writeDirs` 已移除：部署级目录统一走 `sandbox-policy.additionalWritableRoots`，会话级走 `request_write_access`。

## 工具与审批卡

- 工具名 `request_write_access`，只有一个参数 `path`（绝对路径，或相对 workspace，`~` 会展开）。
- 审批卡是本插件自渲染的：标题是「允许写入 `<路径>`？」，按钮是「本会话允许」/「拒绝」。只因 `conversation.composer` 是 chain slot 才做得到——官方审批卡的工厂 slot 不允许二次注册，按钮文字也写死。
- 其它工具的审批（bash/write 的提权）仍走官方那张卡，本插件只认领自己的请求。
- `danger-full-access` 下工具整体不注册进该步（`when` 条件），模型不会看到一个已经没有意义的申请入口。

## 宽容层

模型经常搞不清自己处在什么模式，于是把提权参数写歪。插件在派发前只改写这两个字段（`bash` / `pwsh` / `write` / `edit`）：

| 模型传的 | 处理 |
| --- | --- |
| 只有 `justification`，没有 `sandbox_permissions` | 删掉 |
| 升权但没理由 / 理由是空白 | 补 `Agent did not attach a justification.` |
| 词表内、但同级或更窄的目标 | 两个字段都删掉，按当前模式跑 |
| 词表外的值（`full`、`workspace_write`…） | 不碰，交给宿主报 `invalid arguments` |

`command`、`path`、`content` 一律不动，所以调用卡片和审计日志仍是模型原始参数。

## 验证

```sh
# 沙箱生效：EACCES（Landlock），不是 EROFS（bwrap）
touch /etc/probe          # touch: cannot touch '/etc/probe': Permission denied

# 部署级目录可写
touch ~/.cache/probe      # ok
```

会话级授权的验证：让模型写工作区外的目录，它会先报 `权限不够`，随后调用 `request_write_access`，你批准后重试成功。

## 局限

- 没有私有 PID namespace / `/proc`：沙箱内能看到主机进程。
- Landlock 元数据缺口：对自有文件的 `chmod` / `chown` / `utime` / `setxattr` 不受管控。
- 授权是运行时的：不写入会话日志，恢复或 fork 会话后需要重新申请；已在运行的进程保持原权限。
- 只有 Linux：`cordis.patch.yml` 里的 stock provider 只在 Linux 上禁用，其它平台保持官方实现。申请工具本身与后端无关（它只碰 `sandbox-policy`），所以换成 bwrap/Seatbelt 也能用，只是本包不提供那些后端。

## 开发

```sh
pnpm install
pnpm run check   # typecheck + build + test
```

`lib/` 是构建产物，随仓库提交，供 `github:` 一行安装使用。

## License

[MIT](LICENSE)
