# Orca 模型目录同步（NAS / Docker 部署）

Webhook 机器人的「运行配置」（基座 / 模型 / 思考强度）需要 Orca 的真实目录。OA 与 Orca 装在同一台电脑时，OA 直接读取本机 Orca；OA 部署在飞牛 NAS 等 Docker 容器中时，容器里没有 Orca，需要由运行 Orca 的电脑把目录推送给 OA。

## 1. 目录来源优先级

`GET /api/im/webhooks/orca-catalog` 按以下顺序取数据（`src/lib/im/orca-catalog-sync.ts` 的 `resolveOrcaCatalog`）：

| 优先级 | 来源 | 条件 | 界面显示 |
| --- | --- | --- | --- |
| 1 | 本机 Orca | `orca agent installed --json` 可执行 | 来源：本机 Orca |
| 2 | 已同步快照 | 本机没有 Orca CLI，数据库里有同步快照 | 来源：已同步目录（主机 · 同步时间，N 分钟前） |
| 3 | 常用预设 | 以上都没有 | 来源：常用预设，并提示去设置页复制同步命令 |

三种来源都会合并管理员手动维护的「自定义常用模型」。

- 多台电脑同步时，每台电脑各存一份快照（按主机名区分，最多 10 台）。同一基座取最近一次同步中包含它的那台电脑的模型列表；任一电脑检测到该基座即视为已安装。
- 快照超过 7 天没有更新时，界面会提示重新同步。
- OA 与 Orca 同机时，读取成功后会把本机目录也记成一份快照（内容变化才写库），之后 CLI 暂时不可用也能用最近一次的真实目录。
- `ORCA_CATALOG_LOCAL=off` 关闭本机探测，只使用快照和预设。容器内没有 Orca 时不需要设置；本地联调时可用它模拟 NAS 环境。

## 2. 首次配置（管理员）

1. 打开 OA「设置 · Webhook 机器人」，找到「Orca 模型目录」区块，点「生成同步密钥」。
2. 在「同步密钥与命令」里选择运行 Orca 的电脑的系统（Windows PowerShell / macOS / Linux / OA 仓库内），点「复制」。命令中的 OA 地址是你当前访问 OA 用的地址（例如 `http://192.168.124.220:3001`）。
3. 在运行 Orca 的电脑上粘贴执行。需要 Node 22.5 或更高版本（内置 `node:sqlite`），不需要安装其他依赖。
4. 回到 OA 点「刷新」，状态会变成「已同步」，聊天面板的模型选择器底部显示来源和同步时间。

Windows 命令示例（密钥用 `<同步密钥>` 代替）：

```powershell
curl.exe -fsSL "http://192.168.124.220:3001/api/im/webhooks/orca-catalog/sync-script" -o "$env:USERPROFILE\oa-orca-sync.mjs"; node "$env:USERPROFILE\oa-orca-sync.mjs" --url "http://192.168.124.220:3001" --token "<同步密钥>"
```

在 OA 仓库内可以直接运行：

```powershell
pnpm orca:sync-catalog --url http://192.168.124.220:3001 --token <同步密钥>
```

成功时输出类似：

```text
[OA 目录同步] 主机：MimoDesktop
  · Orca CLI：检测到 7 个基座（默认 dsh）
  · 模型目录：C:\Users\me\AppData\Roaming\orca\agent-model-catalog.db（读取成功，6 个基座，跳过 2 个 ID 不合法的模型）
  · 汇总：7 个基座，269 个模型
  · 推送到 http://192.168.124.220:3001：成功（HTTP 200）· OA 已记录 7 个基座 / 269 个模型 · 同步时间 2026-11-28 15:20:00
完成，用时 1.2 秒
```

## 3. 同步脚本 `scripts/orca/sync-catalog.mjs`

单文件、零依赖，可以脱离 OA 仓库运行。OA 服务器在 `GET /api/im/webhooks/orca-catalog/sync-script` 提供下载（脚本不含密钥，无需登录）。

| 参数 | 环境变量 | 说明 |
| --- | --- | --- |
| `--url <地址>` | `OA_URL` | OA 访问地址，可省略 `http://` |
| `--token <密钥>` | `OA_CATALOG_TOKEN` | 同步密钥；也可用任一已启用 Webhook 机器人的回调 Token |
| `--label <名称>` | `OA_CATALOG_LABEL` | 主机显示名称，例如「办公室电脑」 |
| `--host <主机名>` | `OA_CATALOG_HOST` | 来源主机标识，默认本机主机名；同一主机再次同步会覆盖上一次 |
| `--dry-run` | | 只读取并打印，不推送 |
| `--out <文件>` | | 导出快照 JSON，可在设置页「手动导入快照」上传 |
| `--catalog <路径>` | `ORCA_MODEL_CATALOG_PATH` | Orca 模型目录路径 |
| `--orca <路径>` | `ORCA_CLI_PATH` | `orca` 可执行文件路径 |
| `--timeout <秒>` | | 推送超时，默认 20 秒 |

退出码：`0` 成功；`1` 参数错误；`2` 没有读到任何基座或模型；`3` 推送失败（连不上、密钥无效、校验失败）。

脚本只读：执行 `orca agent installed --json`，并以只读方式打开 `agent-model-catalog.db`（兼容 WAL，不阻塞 Orca 写入；只读打开失败时复制到临时目录读取）。解析规则与 OA 服务端 `src/lib/im/orca-catalog.ts` 一致，`tests/webhook/orca-catalog-sync.test.ts` 会校验两边结果相同。

### 定时自动同步

在 Orca 中新建定时自动化（例如每 30 分钟，或每天开机后），让它执行上面复制的那条命令。也可以用 Windows 任务计划程序 / macOS launchd / cron 定时执行。Orca 升级或新增模型后，下一次同步就会更新到 OA。

## 4. 同步接口

`POST /api/im/webhooks/orca-catalog/sync`

- 鉴权（满足其一）：
  - `Authorization: Bearer <同步密钥>` 或 `X-OA-Catalog-Token: <同步密钥>`；
  - 任一已启用 Webhook 机器人的回调 Token（机器人停用后失效）；
  - 已登录管理员的同源会话（设置页导入使用，跨站请求会被拒绝）。
- 同步密钥在数据库中只保存哈希和用 `AUTH_SECRET` 加密的密文，管理员可在设置页查看、复制、重置；重置后旧密钥立即失效。
- 请求体上限 1 MB；JSON 严格校验（未知字段报错），最多 64 个基座、每个基座 500 个模型、总计 5000 个模型；模型 ID / 思考强度沿用出站 `metadata` 的格式校验。
- 成功返回：

```json
{ "ok": true, "via": "token", "host": "mimodesktop", "label": null, "agentCount": 7, "modelCount": 269, "syncedAt": "2026-11-28T07:20:00.000Z", "unchanged": false, "customModelCount": 1 }
```

- 失败返回 `{ "error": "中文说明" }`：401 密钥缺失或无效，403 非管理员或跨站，413 超过大小上限，400 JSON 或字段不合法（指出字段路径，例如 `agents[0].models[3].id：模型 ID 只能包含…`）。

快照格式（`version: 1`，`--out` 导出的文件即此格式）：

```json
{
  "version": 1,
  "source": { "host": "MimoDesktop", "label": "办公室电脑", "platform": "win32", "generator": "oa-orca-sync/1" },
  "generatedAt": "2026-11-28T07:20:00.000Z",
  "defaultAgent": "dsh",
  "agents": [
    {
      "id": "claude",
      "name": "Claude Code",
      "installed": true,
      "isDefault": false,
      "modelSource": "discovered",
      "models": [{ "id": "claude-opus-5-5", "label": "Opus 5.5", "description": null, "isDefault": true, "efforts": [{ "value": "max", "label": "Max" }], "effortsKnown": true, "defaultEffort": "max" }],
      "configured": { "model": "claude-opus-5-5", "effort": "max" }
    }
  ]
}
```

## 5. 手动维护

设置页「Orca 模型目录」区块还提供：

- **已同步主机**：每台电脑的基座数、模型数、同步时间和方式，可删除某台电脑的快照。
- **手动导入快照**：电脑无法直连 OA 时，用 `--out` 导出 JSON，再在设置页粘贴或选择文件导入。
- **自定义常用模型**：按基座补充目录中没有的模型（可填显示名称、思考强度和默认强度）。自定义模型单独存表，排在该基座模型列表最前；推送同步不会覆盖或删除它们。与同步目录中已有的模型同 ID 时，沿用同步数据并标记为「自定义」。

## 6. 数据与迁移

新增三张表（`prisma/schema.prisma`，迁移文件 `desktop/migrations/0005_schema_202611280717.sql`）：

| 表 | 内容 |
| --- | --- |
| `OrcaCatalogSnapshot` | 每台主机一行：主机名（唯一）、显示名称、规范化后的目录 JSON、基座数、模型数、同步方式、同步时间 |
| `OrcaCustomModel` | 自定义模型：基座 + 模型 ID（联合唯一）、显示名称、思考强度列表、默认强度 |
| `OrcaCatalogSyncKey` | 同步密钥：哈希、前缀、密文、最近使用时间 |

迁移只新建表，不改已有表。容器和桌面一体包启动时自动执行：已有数据库先用 `VACUUM INTO` 备份到 `backups/`，再补齐 0005；再次启动不会重复执行。开发环境执行 `pnpm db:push`。

## 7. 常见问题

- **提示「同步密钥无效」**：密钥已被重置，或复制时不完整。回到设置页重新复制命令。
- **提示「无法连接 …」**：确认电脑能打开 OA 地址（同一局域网、NAS 防火墙放行端口）。命令里的地址取自你打开设置页时的地址，用 `127.0.0.1` 打开时请改成 NAS 的局域网地址。
- **提示「未找到 orca 命令」**：脚本仍会读取模型目录并同步，只是缺少「已安装 / 默认基座」信息。可以用 `--orca` 指定路径，Windows 默认在 `%LOCALAPPDATA%\Programs\orca\resources\bin\orca.exe`。
- **跳过了几个模型**：Orca 目录中有 ID 含空格等无法通过出站校验的模型，它们在 OA 中本来就无法选择。
- **AUTH_SECRET 更换后无法查看密钥**：点「重置」生成新密钥，并更新各电脑上的同步命令。
