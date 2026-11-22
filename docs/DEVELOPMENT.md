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
- 文档附件存储在 `ATTACHMENT_DIR`（默认 `storage/attachments`，相对路径基于项目根目录），文件名以附件 id 命名、不入库；上限 10MB。

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
pnpm dev           # web: http://localhost:3000，协同: ws://localhost:1234
```

演示账号密码均为 `123456`：admin@demo.com、ceo@demo.com、sales@demo.com、buyer@demo.com、wh@demo.com、dispatch@demo.com、driver@demo.com、pm@demo.com、dev@demo.com、finance@demo.com。

### 并行开发 / 测试隔离

同一目录可以并行运行多个实例，通过环境变量隔离构建目录、数据库和登录 Cookie：

```powershell
$env:NEXT_DIST_DIR=".next-crm"; $env:DATABASE_URL="file:./prisma/crm.db"; $env:SESSION_COOKIE_NAME="oa_session_crm"
pnpm prisma db push --force-reset; pnpm db:seed
pnpm next dev --port 3103
```
