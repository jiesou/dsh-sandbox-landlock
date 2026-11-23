# dsh-sandbox-landlock

DSH 的 Landlock 进程沙箱 provider：不用 namespace，uid 与文件属主保持主机原样。

[English](README.en.md)

DSH 默认的 Linux 后端是 bwrap：它靠 namespace 与只读 bind 造出「另一个文件系统视图」，代价是沙箱内的 uid、`/proc`、设备节点与主机不一致，git、ssh、串口工具经常因此出问题。

本插件只用 Landlock（[`landlock-run`](https://github.com/Zouuup/landrun) 的 DSH 封装）：内核在每次打开文件时裁决，不换视图。路径被拒时报 `EACCES`，而不是 bwrap 的 `EROFS`。

它只负责**强制执行**。按目录申请可写权限的模型工具在 [dsh-sandbox-better](https://github.com/jiesou/dsh-sandbox-better)，那个插件与后端无关。

## 安装

```sh
dsh plugin --profile web add github:jiesou/dsh-sandbox-landlock
# 或本地
dsh plugin --profile web add /path/to/dsh-sandbox-landlock
```

装完重启 web。要求 Linux（内核带 Landlock）、DSH `>=0.2.2-rc.2`。

## 它能写哪里

和官方 `sandbox-policy` 完全一致，插件不自带目录清单：

- `read-only`：只有 `/dev/null`；
- `workspace-write`：会话 workspace、`/tmp`、`sandbox-policy.additionalWritableRoots`，以及会话内通过 `registerWritableRoot` 授予的目录（即 dsh-sandbox-better 的 `request_write_access`）；
- `danger-full-access`：消费方直接 spawn，不经过本 provider。

## 配置

```yaml
- id: sandbox-landlock
  name: dsh-sandbox-landlock
  config:
    devicePaths:
      - /dev/ttyUSB*
      - /dev/ptmx
      - /dev/dri/renderD*
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `devicePaths` | `string[]` | `[]` | 需要读写的设备节点，支持通配符；每条命令 confine 时展开，拔插后下条命令自动生效 |
| `launcherPath` | `string` | 自动探测 | 显式指定 `landlock-run` 二进制 |

`devicePaths` 是每命令展开而不是挂载时快照：Landlock 规则绑 inode，串口重新插拔后 inode 会变。设备缺席时自动剔除，不会触发 launcher 的 fail-closed（exit 125）。

## 强制执行的边界

- 文件工具同样走 Landlock 语义：插件替换了 `dsh-fs-sandbox` 的 provider，写入前按同一份 policy 检查根目录。
- `cordis.patch.yml` 只在 Linux 上禁用 stock provider（`disabled: !!js process.platform === 'linux'`），其它平台保留官方实现。
- 探针不可用时插件不挂载并打印原因（fail-closed），不会悄悄退化成无沙箱。

## 局限

- 没有私有 PID namespace / `/proc`：沙箱内能看到主机进程。
- Landlock 元数据缺口：对自有文件的 `chmod` / `chown` / `utime` / `setxattr` 不受管控。
- 只在 Linux 上提供后端。

## 开发

```sh
pnpm install
pnpm run check   # typecheck + build + test
```

`lib/` 是构建产物，随仓库提交，供 `github:` 一行安装。

## License

[MIT](LICENSE)
