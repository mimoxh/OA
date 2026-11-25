# 协作平台 OA 桌面端（Tauri v2）

一个 Windows 安装包同时包含客户端与完整服务端。首次启动时选择使用方式，之后可在「服务器与工作空间设置」中随时切换：

- **在本机创建工作空间**：内置 Node 运行时启动服务端（网关 + Next + 协同 + 实时，对外只占一个端口，默认 17300），数据保存在本机，同事在局域网内用客户端或浏览器访问。
- **连接已有服务器**：输入服务器地址（如 `192.168.1.20:17300` 或 `https://oa.example.com`）。

## 能力

- 自绘窗口：无系统边框，左侧导航栏延伸到顶部；顶栏可拖动，含前进 / 后退 / 刷新、全局搜索、服务器状态与窗口按钮。
- 关闭窗口即隐藏到托盘，本机服务器继续为同事提供访问；托盘菜单「退出协作平台」才会停止服务（先保存协同文档再退出）。壳进程异常退出时，作业对象会一并结束服务进程。
- 局域网走 HTTP：桌面端对连接过的 HTTP 地址启用安全上下文（摄像头、麦克风、剪贴板可用），首次连接新地址会自动重启一次客户端。浏览器访问时这些能力受限。
- 首次使用本机服务器时进入 `/setup` 创建管理员，并写入内置角色、会计科目和常用审批流程。
- 数据库升级：安装新版本后启动时自动执行 `migrations/*.sql`，执行前先备份到数据目录的 `backups/`。
- 单实例、未读数同步到标题与托盘、系统原生通知。

## 目录与数据

| 内容 | 位置 |
| --- | --- |
| 客户端配置 | `%APPDATA%\com.oa.suite.desktop\desktop.json` |
| 本机服务器数据（数据库、附件、密钥、备份、日志） | 默认 `%LOCALAPPDATA%\com.oa.suite.desktop\workspace\`，可更改 |
| 服务日志 | 数据目录下 `logs\server.log`（上一次为 `server.prev.log`） |

数据目录可在「本机服务器」页的「数据目录 → 更改…」中修改，配置保存在 `desktop.json` 的 `dataDir`（`null` 表示默认位置）；「恢复默认位置」可改回默认目录。

- 选择空文件夹或已有工作空间数据（含 `oa.db`）的文件夹时直接使用它；选择其他非空文件夹时，会在其中新建 `OA-Workspace` 子文件夹。
- 不允许使用磁盘根目录、程序安装目录内部、与当前目录互相包含的位置，以及没有写权限的位置。
- 新位置为空且当前目录有数据时，可选择「迁移现有数据」（复制数据库、附件、密钥和备份，不含日志）或「使用空的新工作空间」。新位置已有数据时直接切换过去，不做迁移。
- 更换过程中会先停止服务，完成后按原来的状态重新启动。原目录不会被删除，确认无误后可手动清理。

### 服务端配置（数据目录下的 `.env`）

本机服务器启动时会读取数据目录下的 `.env`（可选，修改后重启服务生效）。优先级：系统环境变量 > `.env` > 桌面端默认值。数据库、密钥、端口、监听地址、内部服务地址等由桌面端管理，写在 `.env` 里会被忽略（日志中会列出）。

| 配置 | 桌面端默认值 | 说明 |
| --- | --- | --- |
| `OA_PUBLIC_BASE_URL` | `http://127.0.0.1:<端口>` | Webhook 推送中的回复地址（`reply.endpoint`）。外部 Bot 在其他机器上时改为局域网地址，如 `http://192.168.1.20:17300` |
| `WEBHOOK_ALLOW_PRIVATE_NETWORK` | `true` | 允许向本机、局域网和代理 FakeIP（198.18.0.0/15）地址推送；设为 `false` 改为严格拦截 |
| `WEBHOOK_ALLOWED_HOSTS` | 空 | 严格模式下按主机名放行，逗号分隔，`*.example.com` 匹配所有子域名 |

云元数据地址（`169.254.169.254`、`fd00:ec2::254`、`metadata.google.internal` 等）始终拦截，不受上述配置影响。

## 构建

前置：Rust 工具链、Visual Studio C++ Build Tools、Node（构建机的 Node 会被打进安装包，`better-sqlite3` 按它的 ABI 加载）。

```powershell
pnpm install
pnpm desktop:build          # 打包服务端（next build + esbuild）后执行 tauri build，输出 NSIS 安装包
pnpm desktop:bundle-server  # 只重新打包服务端到 desktop/src-tauri/resources/server
pnpm desktop:check          # 仅校验 Rust 代码（需要先打包过一次服务端）
```

安装包位于 `desktop/src-tauri/target/release/bundle/nsis/`。

## 数据库迁移

修改 `prisma/schema.prisma` 后执行 `node scripts/desktop/migration.mjs`，会与 `desktop/migrations/schema.prisma` 快照对比，生成下一个 `NNNN_*.sql` 并更新快照；`--check` 只检查是否有未生成的迁移。`bundle-server` 会自动执行这一步。迁移文件需要提交到仓库。

## 开发调试

`pnpm desktop:dev` 打开启动页；选择「连接已有服务器」并输入 `http://localhost:3000` 可连到 `pnpm dev`。也可以用环境变量 `OA_SERVER_URL` 直连。
