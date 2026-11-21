import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 text-5xl">🧭</div>
      <h1 className="text-xl font-semibold text-ink">页面不存在</h1>
      <p className="mt-2 text-sm text-ink-2">你访问的页面可能已被删除，或链接有误。</p>
      <Link href="/" className={buttonClass("default", "md", "mt-6")}>
        返回首页
      </Link>
    </div>
  );
}
