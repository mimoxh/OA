"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  openMobileAppSettings,
  openMobileVendorSettings,
  requestMobileIgnoreBatteryOptimizations,
  requestMobileNotificationPermission,
  useIsMobileApp,
} from "@/lib/mobile-bridge";
import { Tone, useMobilePushState } from "../notifications-client";

type Vendor = "xiaomi" | "huawei" | "honor" | "oppo" | "vivo" | "samsung" | "meizu" | "other";

const VENDOR_NAMES: Record<Vendor, string> = {
  xiaomi: "小米 / 红米（HyperOS、MIUI）",
  huawei: "华为（HarmonyOS、EMUI）",
  honor: "荣耀（MagicOS）",
  oppo: "OPPO / 一加 / realme（ColorOS）",
  vivo: "vivo / iQOO（OriginOS）",
  samsung: "三星（One UI）",
  meizu: "魅族（Flyme）",
  other: "其他 Android 手机",
};

/** 各厂商系统里“自启动 / 后台运行”设置的位置；系统版本不同时菜单名可能略有差别 */
const VENDOR_STEPS: Record<Vendor, string[]> = {
  xiaomi: [
    "设置 → 应用设置 → 应用管理 → OA → 打开“自启动”",
    "同一页面 → 省电策略 → 选择“无限制”",
  ],
  huawei: [
    "设置 → 电池 → 应用启动管理 → 找到 OA，关闭“自动管理”",
    "在弹窗里打开“允许自启动”“允许关联启动”“允许后台活动”",
  ],
  honor: [
    "设置 → 电池 → 应用启动管理 → 找到 OA，关闭“自动管理”",
    "在弹窗里打开“允许自启动”“允许关联启动”“允许后台活动”",
  ],
  oppo: [
    "设置 → 电池 → 更多设置 → 优化电池使用 → OA → 选择“不优化”",
    "设置 → 应用 → 自启动管理 → 打开 OA；应用详情 → 耗电管理 → 允许后台运行",
  ],
  vivo: [
    "设置 → 电池 → 后台耗电管理 → OA → 选择“允许后台高耗电”",
    "i管家 → 应用管理 → 权限管理 → 自启动 → 打开 OA",
  ],
  samsung: [
    "设置 → 电池 → 后台使用限制 → 从不休眠的应用 → 添加 OA",
    "设置 → 应用程序 → OA → 电池 → 选择“不受限制”",
  ],
  meizu: ["手机管家 → 权限管理 → 后台管理 → OA → 允许后台运行", "手机管家 → 权限管理 → 自启动管理 → 打开 OA"],
  other: ["设置 → 应用 → OA → 电池 → 选择“不受限制”或“允许后台活动”"],
};

export function vendorOf(manufacturer: string, brand = ""): Vendor {
  const m = `${manufacturer} ${brand}`.toLowerCase();
  if (/xiaomi|redmi|poco/.test(m)) return "xiaomi";
  if (/honor/.test(m)) return "honor";
  if (/huawei/.test(m)) return "huawei";
  if (/oppo|realme|oneplus/.test(m)) return "oppo";
  if (/vivo|iqoo/.test(m)) return "vivo";
  if (/samsung/.test(m)) return "samsung";
  if (/meizu/.test(m)) return "meizu";
  return "other";
}

function Step({ n, title, status, children, action }: { n: number; title: string; status?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] text-ink">{title}</span>
          {status}
        </div>
        {children && <div className="mt-1 text-xs leading-5 text-ink-2">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-line-strong bg-white px-3 py-1.5 text-[13px] text-ink active:bg-hover">
      {children}
    </button>
  );
}

export function KeepAliveGuide() {
  const inApp = useIsMobileApp();
  const { state, reload } = useMobilePushState(inApp);
  if (!inApp) {
    return <p className="mt-4 px-1 text-sm text-ink-2">后台保活设置只在 OA 手机 App 内可用。</p>;
  }
  const vendor = vendorOf(state?.manufacturer ?? "", state?.brand ?? "");
  const openVendor = async (kind: "autostart" | "battery") => {
    const r = await openMobileVendorSettings(kind);
    if (r?.opened === "app-details") toast.info("没有找到该机型的专用设置页，已打开应用详情，请按下方步骤设置");
  };

  return (
    <>
      <div className="mt-3 rounded-xl bg-white px-4 py-3 text-xs leading-5 text-ink-2">
        为了在锁屏、App 退到后台和手机重启后仍能收到消息，OA 会保持一条到公司服务器的连接。国产手机默认会清理后台应用，请完成下面几步。
        <div className="mt-1 text-ink-3">
          当前机型：{state ? `${state.manufacturer} ${state.model} · Android ${state.release}` : "读取中…"}（按 {VENDOR_NAMES[vendor]} 显示）
        </div>
      </div>

      <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-white">
        <Step
          n={1}
          title="允许通知"
          status={state && <Tone tone={state.permissionGranted && state.notificationsEnabled ? "ok" : "warn"}>{state.permissionGranted && state.notificationsEnabled ? "已允许" : "未允许"}</Tone>}
          action={state && !(state.permissionGranted && state.notificationsEnabled) && <Btn onClick={() => void requestMobileNotificationPermission().then(reload)}>开启通知</Btn>}
        />
        <Step
          n={2}
          title="忽略电池优化"
          status={state && <Tone tone={state.ignoringBatteryOptimizations ? "ok" : "warn"}>{state.ignoringBatteryOptimizations ? "已允许" : "未允许"}</Tone>}
          action={
            state && !state.ignoringBatteryOptimizations ? (
              <Btn onClick={() => void requestMobileIgnoreBatteryOptimizations()}>允许</Btn>
            ) : (
              <Btn onClick={() => void openVendor("battery")}>打开电池设置</Btn>
            )
          }
        >
          系统弹窗里选“允许”。这样锁屏省电模式（Doze）下仍可保持连接。
        </Step>
        <Step
          n={3}
          title="允许自启动和后台运行"
          action={
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => void openVendor("autostart")}>{state?.vendorAutostart ? "打开自启动设置" : "打开应用设置"}</Btn>
              <Btn onClick={() => void openMobileAppSettings()}>应用详情</Btn>
            </div>
          }
        >
          <ol className="list-decimal space-y-0.5 pl-4">
            {VENDOR_STEPS[vendor].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="mt-1 text-ink-3">系统需要你手动确认，App 无法读取这一项是否已开启。</div>
        </Step>
        <Step n={4} title="在最近任务里锁定 OA（可选）">
          打开最近任务列表，长按或下拉 OA 的卡片，选择“锁定”。一键清理后台时不会被关闭。
        </Step>
        <Step n={5} title="确认连接状态">
          回到“通知”页，连接状态显示“已连接，后台可接收”即可。重启手机后无需打开 App，后台连接会自动恢复。
        </Step>
      </div>
    </>
  );
}
