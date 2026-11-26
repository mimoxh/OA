# 飞牛 NAS（fnOS）部署与 Windows 数据迁移指南

本指南面向飞牛 NAS（推荐参考硬件：Intel N150 / N100 + 16 GB 内存，x86_64；亦兼容 ARM64 Linux NAS），采用**单容器 + 单端口 + `NEXT_OUTPUT=standalone` + SQLite WAL + 3 持久化目录**架构部署 OA 协作平台。

---

## 1. 架构与资源概览

容器入口（`server/standalone/main.ts`）在单个 Node 22 进程内同时托管：

- **对外单端口网关**（默认 `0.0.0.0:3000`）：
  - `/` → 转发至内部 Next.js `standalone` 服务；
  - `/collab`（WebSocket Upgrade）→ 转发至内部 Hocuspocus 文档协同服务；
  - `/rt`（WebSocket Upgrade）→ 转发至内部 Realtime 实时通信与通话信令服务；
  - `/health` → 探活接口（校验 Next / Collab / Realtime 状态），供 Docker `HEALTHCHECK` 与反向代理使用。
- **内部安全边界**：Next / Collab / Realtime 仅监听 `127.0.0.1` 随机回环端口，内部管理接口（`/publish`、`/restore`、`/broadcast`）及桌面壳控制路由 `/__oa/*` 均不对外暴露。
- **自动初始化与迁移**：启动时自动创建缺失的数据目录、开启 SQLite `WAL` 模式，并在检测到新版本迁移时先用 `VACUUM INTO` 自动备份到 `backups/` 再执行迁移；空库首次访问 `/login` 会自动跳转 `/setup` 创建管理员。

| 硬件/资源维度 | 飞牛 N150 + 16G 实际建议 |
| --- | --- |
| **运行内存** | 日常 1–15 人约 `250–600 MB`；`docker-compose.nas.yml` 默认 `mem_limit: 2g`，留足文档 ZIP 导入/导出（100–200 MB 内存压缩）余量 |
| **运行 CPU** | 空载 < 3%，日常轻载；不建议低功耗 NAS 频繁本地编译，优先在 PC 构建镜像后导入 |
| **持久化存储** | **强烈建议将 `db` 目录放在 SSD 存储池**（如 `/vol1`），`attachments` 与 `uploads` 可放 HDD 大容量盘（如 `/vol2`）；**严禁将 SQLite 数据库目录放在 SMB/NFS 网络共享路径** |
| **外部服务依赖** | 零外部依赖（单机无需启动 Redis / PostgreSQL） |

---

## 2. 构建并导入镜像到飞牛 NAS

### 方式 A（推荐）：电脑端构建 `linux/amd64` 镜像并 `docker save` 导入

在已安装 Docker Desktop 的 Windows / macOS / Linux 开发机上执行（项目根目录）：

```powershell
# 1. 构建 linux/amd64 镜像（飞牛 N150 / N100 / J4125 为 x86_64）
docker build --platform linux/amd64 -t oa-suite:latest .

# 2. 导出为 tar 包（镜像体积约 300~420 MB）
docker save -o oa-suite-amd64.tar oa-suite:latest
```

将 `oa-suite-amd64.tar` 上传到飞牛 NAS 后，任选其一导入：

- **飞牛网页端**：打开「Docker → 镜像 → 本地镜像 → 添加镜像 → 从文件导入」，选择 `oa-suite-amd64.tar`；
- **SSH 命令行**：
  ```bash
  docker load -i /vol1/1000/docker/oa/oa-suite-amd64.tar
  ```

> 若部署在 ARM64 NAS（如 RK3588），将上述 `--platform linux/amd64` 改为 `--platform linux/arm64` 即可。

### 方式 B（可选）：推送私有镜像仓库

如果内网已部署 Gitea / Harbor / Docker Registry，可直接推送并在 `.env.nas` 中把 `OA_IMAGE` 改为仓库镜像名：

```bash
docker buildx build --platform linux/amd64 -t registry.lan/oa/oa-suite:latest --push .
```

### 方式 C（可选）：在飞牛 NAS 本地直接构建

N150 + 16 GB 内存足以完成本地构建（峰值内存约 2 GB，耗时约 3–6 分钟）。将仓库代码放到飞牛本地目录后，取消 `docker-compose.nas.yml` 中 `build:` 三行注释并执行：

```bash
docker compose -f docker-compose.nas.yml --env-file .env.nas up -d --build
```

---

## 3. 飞牛 Docker Compose 配置与目录权限

1. 在飞牛创建持久化目录（示例以 SSD 卷 `/vol1` 存库、HDD 卷 `/vol2` 存上传文件；如只有单卷均放 `/vol1` 即可）：
   ```bash
   mkdir -p /vol1/1000/docker/oa/db \
            /vol1/1000/docker/oa/attachments \
            /vol2/1000/docker/oa/uploads
   ```
2. 复制 `docker-compose.nas.yml` 与 `.env.nas.example` 到项目编排目录（如 `/vol1/1000/docker/oa/`），将 `.env.nas.example` 重命名为 `.env.nas`，至少修改：
   - `OA_DB_DIR`、`OA_ATTACHMENTS_DIR`、`OA_UPLOADS_DIR`：改为上面创建的真实路径；
   - `AUTH_SECRET`：用 `openssl rand -base64 48` 生成并妥善备份（**从 Windows 迁移时务必沿用原密钥**，见第 6 节）；
   - `OA_PUBLIC_BASE_URL`：改为飞牛 NAS 的局域网或域名访问地址；
   - `SESSION_COOKIE_SECURE`：按第 4 节选择 `false`（局域网 HTTP）或 `true`（HTTPS 反代）。
3. 启动容器：
   - **SSH 命令行**：
     ```bash
     cd /vol1/1000/docker/oa
     docker compose -f docker-compose.nas.yml --env-file .env.nas up -d
     ```
   - **飞牛网页端「Docker → Compose → 新增项目」**：选择上述目录与 `docker-compose.nas.yml` 启动。
4. 验证状态：
   ```bash
   curl -s http://127.0.0.1:3000/health
   # 预期输出：{"ok":true,"services":{"next":true,"collab":true,"realtime":true}}
   ```

### 目录权限说明

- SQLite WAL 模式要求运行用户对 **`db` 整个目录**（不仅是 `oa.db` 文件本身）具有读写权限，以便创建和清理 `oa.db-wal`、`oa.db-shm` 和 `backups/`。
- 容器入口 `scripts/docker/entrypoint.sh` 默认兼容两种模式：
  - **默认（不配 `PUID`/`PGID`）**：以 root 启动，直接兼容飞牛任意挂载目录属主，开箱即用；
  - **指定非 root 属主**：在 `.env.nas` 中设置 `PUID=1000`、`PGID=1000`（与飞牛管理员 UID/GID 对齐），容器启动时会自动 `chown` 三个数据目录并以 `setpriv` 降权运行。

---

## 4. 局域网 HTTP 与 HTTPS 反向代理配置

### 模式 A：纯局域网 HTTP（例如 `http://192.168.1.20:3000`）

- `.env.nas` 中必须设置：
  ```dotenv
  SESSION_COOKIE_SECURE=false
  OA_PUBLIC_BASE_URL=http://192.168.1.20:3000
  ```
- **注意**：浏览器在非 `https://` 且非 `localhost` 地址下会限制麦克风、摄像头（音视频通话）、剪贴板写入与 PWA 桌面通知。Windows 员工可安装项目自带的桌面客户端（`oa-desktop.exe`），选择「连接已有服务器」填入 `http://192.168.1.20:3000`，桌面壳会自动为该局域网 HTTP 地址启用安全上下文。

### 模式 B：套 HTTPS 反向代理（飞牛自带反代 / Lucky / Nginx Proxy Manager）

- `.env.nas` 中设置为：
  ```dotenv
  SESSION_COOKIE_SECURE=true
  OA_PUBLIC_BASE_URL=https://oa.example.com
  COLLAB_PUBLIC_URL=/collab
  REALTIME_PUBLIC_URL=/rt
  ```
- **反向代理必配要点**（无论使用飞牛反代、Lucky 还是 NPM）：
  1. **开启 WebSocket 支持**（`/collab` 与 `/rt` 均走同源 WebSocket Upgrade）；
  2. **透传 `X-Forwarded-Proto` 与 `X-Forwarded-Host`**（容器内置网关已保留上游转发头，使服务端自动签发 `wss://` 地址）；
  3. **最大请求体调至至少 `60m`**（匹配 `next.config.ts` 的 `proxyClientMaxBodySize: "60mb"`，否则大附件上传和 50 MB 文档 ZIP 导入会触发 `413`）；
  4. **代理读写超时建议 `>= 300s`**（避免空闲长连接被反代提前断开）。
- **手机 App** 的 release 包只信任系统 CA，必须使用公共 CA 证书（如 Let's Encrypt 自动续期），内网场景可用 DNS-01 验证，详见 `docs/mobile/deployment.md`。
- **手机 App 下载页** `/download/android`：在 `.env.nas` 设置 `OA_MOBILE_DIR`（宿主机目录，只读挂载到容器 `/data/mobile`），用 `pnpm mobile:publish --dir <该目录>` 发布安装包，见 `docs/mobile/BUILD.md` §5。不设置时使用 `./nas-data/mobile`，目录为空时下载页显示「管理员还没有发布 Android 安装包」。

Nginx / NPM 高级配置参考片段：

```nginx
client_max_body_size 60m;

location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}
```

---

## 5. 对接局域网 Orca Bot / 外部 Webhook 机器人

OA 与 Orca Bot 完全通过 **HTTP Webhook** 双向通信，不强依赖 NAS 宿主机安装 Orca CLI。

1. 在 `.env.nas` 中确认：
   - `OA_PUBLIC_BASE_URL` 填写 Orca Bot 所在电脑能够访问到的飞牛地址（如 `http://192.168.1.20:3000` 或 `https://oa.example.com`），不要填 `127.0.0.1`；
   - `WEBHOOK_ALLOW_PRIVATE_NETWORK=true`（允许向局域网 IP 推送出站事件；若需更严格的白名单可改为 `false` 并配 `WEBHOOK_ALLOWED_HOSTS`）。
2. 在 OA「设置 → Webhook 机器人」中，将 Outbound URL 指向局域网内运行 Orca 的电脑地址，确保电脑防火墙放行对应端口且网络双向可达（跨网段可用 Tailscale / ZeroTier）。
3. **关于 `ORCA_CLI_PATH` / `ORCA_USER_DATA_DIR` / `ORCA_MODEL_CATALOG_PATH`**：
   - 飞牛容器内未安装 Orca 客户端时，**保持留空即可**；
   - `GET /api/im/webhooks/orca-catalog` 会在找不到 `orca` CLI 或 `agent-model-catalog.db` 时毫秒级优雅降级为内置预设（无报错、无超时阻塞），界面仍支持手动输入任意基座、模型 ID 及 Effort 档位（如 `low` / `high` / `max` / `ultra`）。

---

## 6. Windows 本机数据迁移到飞牛 NAS

### 6.1 跨平台兼容性核查结论（代码实测）

- **文档附件（`DocumentAttachment`）**：数据库仅存 UUID `id` 与展示文件名，落盘路径固定为 `<ATTACHMENT_DIR>/<uuid>`，文档正文存站内 URL `/api/docs/attachments/<uuid>`，**完全无路径分隔符差异**。
- **IM 上传文件（`Attachment`）**：`makeStorageKey()`（`src/lib/storage/index.ts`）固定使用 `/` 生成 `im/YYYY/MM/<uuid><ext>`；`LocalStorageDriver`（`src/lib/storage/local.ts`）与 `S3StorageDriver`（`src/lib/storage/s3.ts`）均先将任何 `\` 归一化为 `/` 再解析路径，**从 Windows 直接拷到 Linux 即可无缝读取**。
- **历史库自动基线迁移**：容器启动脚本（`server/desktop/migrate.ts`）同时兼容以下两种来源的 SQLite 库：
  - `oa-desktop.exe` 桌面端数据（已有 `_oa_migrations` 表）；
  - Windows 命令行 `pnpm db:push` 数据（无 `_oa_migrations` 表时自动比对结构基线并补登，无需手动建表；有新增迁移时先自动备份再升级）。

### 6.2 来源 A：从 Windows 桌面端（`oa-desktop.exe`）迁移

1. **彻底退出桌面端**：右键 Windows 系统托盘图标，点击**「退出协作平台」**（注意：直接点右上角关闭窗口只会隐藏到托盘，服务仍在运行）。彻底退出后 Hocuspocus 会刷盘并完成 SQLite WAL checkpoint。
2. **定位数据目录**：
   - 客户端配置文件位于：`%APPDATA%\com.oa.suite.desktop\desktop.json`；
   - 默认数据目录为：`%LOCALAPPDATA%\com.oa.suite.desktop\workspace\`；
   - 若曾在桌面端「本机服务器 → 数据目录」修改过位置，以 `desktop.json` 中的 `dataDir` 字段为准。
3. **按如下映射复制到飞牛 NAS**（无需复制 `logs/`）：

   | Windows 桌面端目录内容 | 飞牛 NAS 对应目录 | 说明 |
   | --- | --- | --- |
   | `oa.db`（以及若仍存在的 `oa.db-wal`、`oa.db-shm`） | `${OA_DB_DIR}/oa.db`（含同名 `-wal`/`-shm`） | 主数据库；若存在 `-wal`/`-shm` 务必与 `oa.db` 同目录一起复制 |
   | `secret.key` | `${OA_DB_DIR}/secret.key`（或将其内容填入 `.env.nas` 的 `AUTH_SECRET`） | **关键**：保持原密钥不变，否则已有 Webhook 机器人加密凭据无法解密 |
   | `backups/`（可选） | `${OA_DB_DIR}/backups/` | 历史自动备份 |
   | `attachments/*` | `${OA_ATTACHMENTS_DIR}/` | 文档附件（UUID 文件列表） |
   | `uploads/*` | `${OA_UPLOADS_DIR}/` | IM 聊天图片与文件（保留 `im/YYYY/MM/...` 目录结构） |

4. 若你选择了直接把 `secret.key` 复制到 `${OA_DB_DIR}/secret.key`，请将 `.env.nas` 中的 `AUTH_SECRET` 注释掉或填入完全相同的字符串（`AUTH_SECRET` 环境变量优先级高于 `secret.key`）。
5. 启动飞牛容器并完成 6.4 验收后，在 Windows 桌面端打开「服务器与工作空间设置」，切换为**「连接已有服务器」**，填入飞牛地址（如 `http://192.168.1.20:3000` 或 `https://oa.example.com`）即可把原桌面端转为纯客户端使用。

### 6.3 来源 B：从 Windows 命令行模式（`pnpm dev` / `pnpm start`）迁移

1. 停止正在运行的 `pnpm dev` / `pnpm start` 进程。
2. 查看项目根目录 `.env`，复制以下 4 项到飞牛 NAS：
   - **数据库**：`DATABASE_URL` 指向的 SQLite 文件（默认 `prisma/dev.db`，以及若存在的 `dev.db-wal`、`dev.db-shm`）→ 重命名为 `${OA_DB_DIR}/oa.db`（对应的 `-wal`/`-shm` 需同步重命名为 `oa.db-wal`/`oa.db-shm`，或先执行一次 `sqlite3 dev.db "PRAGMA wal_checkpoint(TRUNCATE);"` 合并后再只拷单文件）；
   - **密钥**：原 `.env` 中的 `AUTH_SECRET` → 原样填入 `.env.nas` 的 `AUTH_SECRET`；
   - **文档附件**：原 `ATTACHMENT_DIR`（默认 `storage/attachments/`）内全部文件 → `${OA_ATTACHMENTS_DIR}/`；
   - **IM 上传**：原 `STORAGE_LOCAL_DIR`（默认 `data/uploads/`）内全部目录文件 → `${OA_UPLOADS_DIR}/`。
3. 启动飞牛容器。首次启动时日志会显示已识别并基线化已有数据库，不丢失任何业务数据。

### 6.4 迁移后验收清单

- [ ] `GET /health` 返回 `{"ok":true,"services":{"next":true,"collab":true,"realtime":true}}`
- [ ] 使用原管理员账号成功登录（不跳转 `/setup`）
- [ ] 打开历史文档可正常实时编辑（WebSocket `/collab` 正常），内嵌图片/文档附件可正常预览下载
- [ ] 打开 IM 历史会话可正常收发实时消息（WebSocket `/rt` 正常），历史图片/文件可正常加载
- [ ] 若原环境配置过 Webhook 机器人，进入「设置 → Webhook 机器人」确认无「凭据解密失败」提示，并执行一次「测试连接」

---

## 7. 日常备份与版本升级

- **在线热备份数据库**（无需停机，推荐加入飞牛定时任务）：
  ```bash
  docker exec oa-suite node -e '
    const Database = require("better-sqlite3");
    const db = new Database("/data/db/oa.db");
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    db.exec(`VACUUM INTO "/data/db/backups/oa-manual-${stamp}.db"`);
    db.close();
  '
  ```
- **备份范围**：定期同步 `${OA_DB_DIR}/backups/`、`${OA_ATTACHMENTS_DIR}/`、`${OA_UPLOADS_DIR}/` 与 `.env.nas`（含 `AUTH_SECRET`）到异地/网盘。
- **版本升级**：导入新版本 `oa-suite:latest` 镜像后执行 `docker compose -f docker-compose.nas.yml --env-file .env.nas up -d`。容器重启前会优雅刷盘协同文档，重启后若存在新迁移 SQL 会先自动备份到 `backups/` 再执行升级。
