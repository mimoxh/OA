import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { PERMISSION_LABELS } from "@/lib/permissions";
import { buttonClass } from "@/components/ui/button";

export default async function ForbiddenPage({ searchParams }: PageProps<"/forbidden">) {
  const sp = await searchParams;
  const p = typeof sp.p === "string" ? sp.p : "";
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <ShieldOff className="mb-4 size-10 text-ink-3" />
      <h1 className="text-xl font-semibold text-ink">没有访问权限</h1>
      <p className="mt-2 text-sm text-ink-2">
        {p ? <>当前账号缺少「{PERMISSION_LABELS[p] ?? p}」权限，</> : null}请联系管理员在「设置 · 角色权限」中开通。
      </p>
      <Link href="/" className={buttonClass("default", "md", "mt-6")}>
        返回首页
      </Link>
    </div>
  );
}
