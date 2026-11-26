import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { isMobileRequest } from "@/lib/mobile";
import { DesktopDragStrip } from "@/components/desktop/window-controls";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录" };

/** 演示种子数据固定包含该账号，用它判断是否展示演示账号提示 */
const DEMO_ADMIN_EMAIL = "admin@demo.com";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/messages");
  if ((await db.user.count()) === 0) redirect("/setup");
  const demo = !!(await db.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL }, select: { id: true } }));
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/messages";
  const inApp = await isMobileRequest();
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <DesktopDragStrip />
      <div className="w-full max-w-[360px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-ink text-xl font-bold text-white">协</div>
          <h1 className="text-2xl font-bold text-ink">登录协作空间</h1>
          <p className="mt-1.5 text-sm text-ink-2">文档 · OA · CRM · ERP · WMS · TMS · PMS</p>
        </div>
        <LoginForm next={next} demo={demo} />
        {demo && (
          <div className="mt-6 rounded-lg border border-line bg-white p-3 text-xs leading-relaxed text-ink-2">
            <div className="mb-1 font-medium text-ink">演示账号（密码均为 123456）</div>
            <div>admin@demo.com · 管理员</div>
            <div>sales@demo.com · 销售 ｜ buyer@demo.com · 采购</div>
            <div>wh@demo.com · 仓管 ｜ dispatch@demo.com · 调度</div>
            <div>pm@demo.com · 项目经理 ｜ finance@demo.com · 财务</div>
          </div>
        )}
        {!inApp && (
          <div className="mt-6 text-center text-[13px]">
            <Link href="/download/android" prefetch={false} className="text-ink-2 hover:text-accent hover:underline" data-android-download-link>
              下载 Android App
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
