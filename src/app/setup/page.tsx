import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { DesktopDragStrip } from "@/components/desktop/window-controls";
import { SetupForm } from "./setup-form";

export const metadata = { title: "初始化工作空间" };

export default async function SetupPage() {
  // 是否已有用户取决于运行时数据库，不能在构建时预渲染
  await connection();
  if ((await db.user.count()) > 0) redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-10">
      <DesktopDragStrip />
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-ink text-xl font-bold text-white">协</div>
          <h1 className="text-2xl font-bold text-ink">创建你的工作空间</h1>
          <p className="mt-1.5 text-sm text-ink-2">先设置管理员账号，之后可在「设置 · 成员」中邀请同事</p>
        </div>
        <SetupForm />
        <p className="mt-4 text-center text-xs leading-relaxed text-ink-3">
          将同时创建内置角色、会计科目与常用审批流程，可在设置中调整。
        </p>
      </div>
    </div>
  );
}
