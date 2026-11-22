# 开发约定

一体化办公协作平台：文档 + OA + CRM + ERP（含财务）+ WMS + TMS + PMS。

## 技术栈

- Next.js 16（App Router，Turbopack，**未启用** cacheComponents，页面默认动态渲染）。动手前请阅读 `node_modules/next/dist/docs/` 中相关文档。
  - `params` / `searchParams` 是 Promise：`export default async function Page({ params }: PageProps<"/crm/customers/[id]">) { const { id } = await params; }`
  - 全局类型 `PageProps<"/route">`、`LayoutProps<"/route">` 由 `next typegen` 生成。
  - 中间件已更名为 `src/proxy.ts`（负责未登录跳转）。
- Prisma 7 + SQLite（`@prisma/adapter-better-sqlite3`），生成的客户端位于 `src/generated/prisma`。
  - 服务端：`import { db } from "@/lib/db"`；类型：`import type { Customer } from "@/generated/prisma/client"`。
  - 客户端组件里只能 `import type`，枚举值请使用字符串字面量。
  - SQLite 的 `contains` 默认对 ASCII 大小写不敏感，不支持 `mode: "insensitive"`。
- Tailwind CSS v4，设计令牌在 `src/app/globals.css`（`text-ink`、`text-ink-2`、`text-ink-3`、`border-line`、`bg-hover`、`bg-sidebar`、`bg-accent`、`bg-tag-*` 等）。
- Tiptap 3 + Yjs + Hocuspocus（实时协同），radix-ui，cmdk，sonner，recharts，lucide-react，date-fns。

## 目录

```
prisma/schema.prisma          全部数据模型（不要随意修改，需要改动时先说明）
prisma/seed/base.ts           基础数据（用户、角色、部门、科目、流程、仓库、产品、客户…）
prisma/seed/modules/*.ts      各模块示例业务数据
server/collab.ts              Hocuspocus 实时协同服务（端口 1234）
src/lib/db.ts                 Prisma 客户端，Tx 类型
src/lib/auth/*                会话（JWT Cookie）、getCurrentUser / requireUser / requirePermission
src/lib/permissions.ts        权限点：<module>:view / <module>:edit / admin（edit 隐含 view）
src/lib/action.ts             runAction(permission, fn) —— Server Action 统一包装
src/lib/services/*            跨模块业务服务（库存、记账、审批引擎、业务流程编排、通知）
src/lib/labels.ts             所有状态枚举的中文名与颜色
src/lib/format.ts             金额、日期格式化
src/lib/nav.ts                侧边栏模块与菜单
src/components/ui/*           通用 UI 组件
src/components/shell/*        应用外壳（侧边栏、命令面板）
src/app/(app)/<module>/...    各模块页面
```

## 页面写法

```tsx
// src/app/(app)/crm/layout.tsx
export default async function Layout({ children }: LayoutProps<"/crm">) {
  await requirePermission("crm:view");
  return children;
}

// 列表页
export default async function Page({ searchParams }: PageProps<"/crm/customers">) {
  const user = await requireUser();
  const { q } = await searchParams;
  const rows = await db.customer.findMany({ ... });
  return (
    <>
      <TopBar crumbs={[{ label: "CRM 客户", href: "/crm" }, { label: "客户" }]} actions={<NewCustomerButton />} />
      <Page>
        <PageHeader icon="🏢" title="客户" description="…" />
        <Table>…</Table>
      </Page>
    </>
  );
}
```

## 数据修改

- 每个模块一个 `actions.ts`（`"use server"`），每个导出函数都通过 `runAction("crm:edit", async (user) => { ... })` 包装，用 zod 校验输入，修改后 `revalidatePath(...)`。抛出的 `Error` 文案（中文）会直接提示给用户。
- 客户端调用：
  ```tsx
  const { run, pending } = useAction();
  run(() => createCustomer(values), { success: "客户已创建", onSuccess: () => setOpen(false) });
  ```
- 涉及库存、记账、审批、跨模块单据流转时，**必须**在 `db.$transaction(async (tx) => ...)` 内调用 `src/lib/services/*` 中的函数，不要自行改库存或写凭证：
  - `inventory.ts`：`moveStock` / `reserveStock` / `releaseStock` / `transferStock` / `adjustStock`
  - `ledger.ts`：`postJournal`、`ACCOUNT` 科目常量
  - `approval.ts`：`startApproval` / `actOnApproval` / `withdrawApproval`；审批结束回调在 `approval-hooks.ts`
  - `flows.ts`：采购审批通过 → 入库 → 应付；商机 → 销售订单 → 确认预占 → 出库 → 运输 → 签收 → 应收 → 收款
  - `notify.ts`：`notify(tx, {...})` 发站内通知，`audit(tx, {...})` 写操作日志
  - `sequence.ts`：`nextNo(tx, "PO")` 生成单据号，`nextCode(tx, "CUS")` 生成编码

## 本地运行

```bash
pnpm install
pnpm db:reset      # 重建数据库并写入示例数据
pnpm dev           # web: http://localhost:3000，协同: ws://localhost:1234，实时: ws://localhost:1235
```

演示账号密码均为 `123456`：admin@demo.com、ceo@demo.com、sales@demo.com、buyer@demo.com、wh@demo.com、dispatch@demo.com、driver@demo.com、pm@demo.com、dev@demo.com、finance@demo.com。

### 并行开发 / 测试隔离

同一目录可以并行运行多个实例，通过环境变量隔离构建目录、数据库和登录 Cookie：

```powershell
$env:NEXT_DIST_DIR=".next-crm"; $env:DATABASE_URL="file:./prisma/crm.db"; $env:SESSION_COOKIE_NAME="oa_session_crm"
pnpm prisma db push --force-reset; pnpm db:seed
pnpm next dev --port 3103
```

## IM / 实时架构

写入路径：Server Action（`runAction` 包 `withRealtimeBuffer`）→ 事务内 `queueEvent` 暂存事件 → 事务提交后 `flush()` → `publish()` → 实时服务 → 在线客户端。数据库是唯一事实源；客户端断线后按 `seq` 重新拉取补齐，事件只做「刷新提示」。

- `src/lib/realtime/buffer.ts`：AsyncLocalStorage 事件缓冲。不在缓冲上下文（种子脚本、离线任务）中 `queueEvent` 静默丢弃。
- `src/lib/realtime/publish.ts`：配置了 `REDIS_URL` 走 Redis 频道 `rt:events`（多实例），否则 POST `${REALTIME_INTERNAL_URL}/publish`（`rt-publish` 作用域令牌）。1.5s 超时、失败仅记日志不抛出。
- `server/realtime.ts`：`ws` 实时服务。`?token=` 连接（`rt` 作用域，`GET /api/realtime-token` 签发）；30s 心跳；typing 转发（校验会话成员，成员表缓存 60s）；presence 广播 + `presence.snapshot`；HTTP `POST /publish`、`GET /health`。配置 `REDIS_URL` 时通过 `rt:events`、`rt:presence`、`rt:instances` 与 `rt:online:<instanceId>` 实现跨实例事件、输入状态与在线状态同步。
- `server/collab.ts`：Hocuspocus 协同服务。配置 `REDIS_URL` 时自动挂载 `@hocuspocus/extension-redis`（前缀 `oa-docs`），支持多实例 Yjs 文档同步与分布式写锁；`GET /health` 返回 `redis` 状态。
- 令牌：`src/lib/auth/token.ts` 的 `signScopedToken/verifyScopedToken`，作用域 `collab`（文档协同）/ `rt`（实时通道）/ `rt-publish`（服务端投递）。带 scope 的令牌**不能**当会话 Cookie 用（`verifySessionToken` 会拒绝）。
- IM 代码在 `src/lib/im/`：`service.ts`（会话/消息/附件/分享写路径，seq 由 `lastSeq increment` 原子分配）、`queries.ts`（DTO 与查询）、`content.ts`（Tiptap 消息校验 + 链接/提及提取）、`cards.ts`（审批卡片与刷新）、`refs.ts`（按查看者权限解析业务引用，含日程 `event`）、`biz.ts`（项目/客户/商机/会议业务群绑定与日程同步，`directKey = "biz:<bizType>:<bizId>"`）、`bots.ts`/`biz-meta.ts`/`types.ts`（客户端可引用的常量与类型）。该目录不得 import `server-only`（会被 tsx 脚本与 server/ 引用）。
- 附件与可插拔存储：`src/lib/storage/` 提供 `StorageDriver` 接口，默认 `LocalStorageDriver`（`data/uploads`），也支持免额外依赖的 AWS SigV4 `S3StorageDriver`。上传走 `POST /api/im/upload`（会话成员校验、大小限制、图片魔数校验并禁止 SVG 内联），下载/预览走 `GET /api/im/files/[id]`（成员权限校验 + `X-Content-Type-Options: nosniff`）。
- 分享到会话：`GET /api/im/share-targets` 与 `ShareToChatButton` 支持将文档、审批、项目等直接分享到会话，消息内仅保存业务引用与用户附言，由 `RefPreviewCard` 按查看者权限动态解析，避免标题越权泄露。
- `notify()` 除写 Notification 表外，还会派发 `notification.new` 并向对应机器人会话投递卡片；审批状态变化时 `approval.ts` 末尾调用 `refreshApprovalCards` 刷新所有相关卡片。
- 补 IM 演示数据：`pnpm db:seed:im`（幂等）：无群聊时建群/单聊，并为还没有机器人会话的用户按历史通知回填卡片。

### 端口与环境变量

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `REALTIME_PORT` | `1235` | 实时服务端口 |
| `NEXT_PUBLIC_REALTIME_URL` | `ws://localhost:1235` | 客户端连接地址 |
| `REALTIME_INTERNAL_URL` | `http://localhost:1235` | 服务端 /publish 入口 |
| `REDIS_URL` | 未设置 | 设置后启用实时总线、跨实例在线状态与 Hocuspocus Redis 协同扩展 |
| `COLLAB_PORT` / `NEXT_PUBLIC_COLLAB_URL` | `1234` | 文档协同 Hocuspocus |
| `STORAGE_DRIVER` | `local` | 附件存储驱动：`local` 或 `s3` |
| `STORAGE_LOCAL_DIR` | `./data/uploads` | 本地附件存储目录（`STORAGE_DRIVER=local`） |
| `S3_BUCKET` / `S3_REGION` / `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE` | 未设置 | S3 兼容对象存储配置（`STORAGE_DRIVER=s3`） |

`docker-compose.yml` 提供可选的 `redis:7` 与 `postgres:16`（默认开发不需要启动）。

### 多实例与迁移说明

- 多实例：所有实例共享同一 `REDIS_URL` 即可互通业务事件、跨实例 typing、跨实例在线状态（`rt:presence` + `rt:online:<instanceId>` 60s TTL 心跳）以及 Hocuspocus 文档实时协同（`@hocuspocus/extension-redis`）。附件在多实例部署时请切换为 `STORAGE_DRIVER=s3`（或共享持久化卷）。
- 迁移 PostgreSQL：改 `schema.prisma` 的 `provider` 为 `postgresql`；`@prisma/adapter-better-sqlite3` 换成 `@prisma/adapter-pg`，`db.ts` 按 `DATABASE_URL` 选适配器；种子里的 `PRAGMA journal_mode` 仅限 SQLite（改为按 provider 跳过）；全库约 60 处 `contains` 查询需要一个大小写不敏感的辅助函数（SQLite 无 `mode: "insensitive"`，PG 有）。

### 事件类型（服务端 → 客户端）

`message.new` / `message.updated` / `conversation.updated` / `conversation.removed` / `read` / `notification.new` / `typing` / `presence` / `presence.snapshot`，载荷定义见 `src/lib/im/types.ts`。
