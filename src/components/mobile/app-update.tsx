"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  canMobileInstallPackages,
  downloadMobileUpdate,
  getMobileShellState,
  getMobileUpdateProgress,
  installMobileUpdate,
  isMobileApp,
  onMobileAppState,
  openMobileExternal,
  openMobileInstallPermissionSettings,
  openMobileLauncher,
  type MobileUpdateProgress,
} from "@/lib/mobile-bridge";
import { versionCodeOf, type MobileVersionInfo } from "@/lib/mobile-version";

/** 「我的 → 检查更新」触发手动检查 */
export const CHECK_UPDATE_EVENT = "oa:check-update";

const CHECK_INTERVAL_MS = 10 * 60_000;
const SNOOZE_MS = 24 * 60 * 60_000;
const SNOOZE_KEY = "oa:update-snooze";
const POLL_MS = 700;

type Release = Extract<MobileVersionInfo, { available: true }>;
type Phase = "prompt" | "downloading" | "permission" | "installing" | "error";

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function snoozed(code: number) {
  try {
    const v = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "null") as { code: number; until: number } | null;
    return !!v && v.code === code && v.until > Date.now();
  } catch {
    return false;
  }
}

function snooze(code: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ code, until: Date.now() + SNOOZE_MS }));
  } catch {}
}

/** 页面与 App 同源：下载地址按当前页面的源重写，避免反代未透传 Host 时原生层拒绝下载 */
function sameOriginUrl(url: string) {
  try {
    const u = new URL(url, window.location.origin);
    return window.location.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * 手机 App 检查更新：启动时检查，回到前台时最多每 10 分钟检查一次。
 * 有新版本时提示（「稍后」24 小时内不再提示同一版本）；低于最低支持版本时强制更新，弹窗不能关闭。
 * 下载走系统下载器，下载完调起系统安装器；没有「安装未知应用」权限时先引导到系统设置。
 */
export function AppUpdate() {
  const [release, setRelease] = useState<Release | null>(null);
  const [required, setRequired] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [progress, setProgress] = useState<MobileUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>("");
  const lastCheck = useRef(0);
  const phaseRef = useRef<Phase>("prompt");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const install = useCallback(async () => {
    const r = await installMobileUpdate();
    if (!r.ok) {
      setError(r.error || "无法安装更新");
      go("error");
      return;
    }
    setProgress(r.value);
    if (r.value.status === "started") go("installing");
    else if (r.value.status === "needs_permission") go("permission");
    else {
      setError(r.value.error || "安装包还没有准备好");
      go("error");
    }
  }, [go]);

  const poll = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    const tick = async () => {
      const r = await getMobileUpdateProgress();
      if (!r.ok) return;
      setProgress(r.value);
      if (r.value.state === "ready") {
        setOpen(true);
        void install();
        return;
      }
      if (r.value.state === "failed") {
        setError(r.value.error || "下载失败");
        setOpen(true);
        go("error");
        return;
      }
      if (r.value.state === "idle") return;
      pollTimer.current = setTimeout(tick, POLL_MS);
    };
    void tick();
  }, [go, install]);

  const check = useCallback(
    async (manual: boolean) => {
      if (!isMobileApp()) return;
      lastCheck.current = Date.now();
      const state = await getMobileShellState();
      if (!state) return;
      const code = state.versionCode ?? versionCodeOf(state.appVersion) ?? 0;
      setCurrent(state.appVersion);
      let info: MobileVersionInfo;
      try {
        const res = await fetch(`/api/mobile/version?current=${code}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        info = (await res.json()) as MobileVersionInfo;
      } catch {
        if (manual) toast.error("检查更新失败，请稍后再试");
        return;
      }
      if (!info.available || info.update === "none" || !info.update) {
        setRequired(false);
        if (manual) toast.success(info.available ? `已是最新版本（${state.appVersion}）` : "服务器上还没有发布新版本");
        return;
      }
      setRelease(info);
      const mustUpdate = info.update === "required";
      setRequired(mustUpdate);
      if (!mustUpdate && !manual && snoozed(info.versionCode)) return;
      // 上次的下载可能还在进行或已完成（App 被杀后重新打开）
      const p = await getMobileUpdateProgress();
      if (p.ok && p.value.targetCode === info.versionCode && p.value.state !== "idle" && p.value.state !== "failed") {
        setProgress(p.value);
        go("downloading");
        poll();
      } else if (phaseRef.current !== "permission" && phaseRef.current !== "installing") {
        go("prompt");
      }
      setOpen(true);
    },
    [go, poll],
  );

  useEffect(() => {
    if (!isMobileApp()) return;
    const t = setTimeout(() => void check(false), 1500);
    const off = onMobileAppState((active) => {
      if (!active) return;
      if (phaseRef.current === "permission") {
        // 从「安装未知应用」设置页返回：已允许就继续安装
        void canMobileInstallPackages().then((ok) => ok && void install());
        return;
      }
      if (phaseRef.current === "installing" || phaseRef.current === "downloading") return;
      if (Date.now() - lastCheck.current > CHECK_INTERVAL_MS) void check(false);
    });
    const onManual = () => void check(true);
    window.addEventListener(CHECK_UPDATE_EVENT, onManual);
    return () => {
      clearTimeout(t);
      off();
      window.removeEventListener(CHECK_UPDATE_EVENT, onManual);
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [check, install]);

  async function start() {
    if (!release) return;
    setError(null);
    const r = await downloadMobileUpdate({
      url: sameOriginUrl(release.downloadUrl),
      versionCode: release.versionCode,
      versionName: release.versionName,
      sha256: release.sha256,
    });
    if (!r.ok) {
      if (r.missing) {
        // 旧版 App 没有自更新能力：在系统浏览器打开下载页
        if (!(await openMobileExternal(sameOriginUrl(release.pageUrl)))) window.location.href = sameOriginUrl(release.downloadUrl);
        return;
      }
      setError(r.error || "无法开始下载");
      go("error");
      return;
    }
    setProgress(r.value);
    go("downloading");
    poll();
  }

  if (!release) return null;
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : 0;
  const canClose = !required;

  return (
    <D.Root open={open} onOpenChange={(v) => (v || canClose) && setOpen(v)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[90] bg-black/40 animate-fade-in" />
        <D.Content
          data-app-update={required ? "required" : "optional"}
          data-phase={phase}
          onEscapeKeyDown={(e) => !canClose && e.preventDefault()}
          onPointerDownOutside={(e) => !canClose && e.preventDefault()}
          onInteractOutside={(e) => !canClose && e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-white shadow-pop animate-pop-in focus:outline-none"
        >
          <div className="px-5 pt-5">
            <D.Title className="text-[17px] font-semibold text-ink">
              {phase === "permission"
                ? "允许安装更新"
                : required
                  ? `需要更新到 ${release.versionName}`
                  : `发现新版本 ${release.versionName}`}
            </D.Title>
            <D.Description className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              {phase === "permission"
                ? "Android 需要你允许「协作平台 OA」安装应用。"
                : required
                  ? `当前版本 ${current} 已不再支持（最低 ${release.minVersionName}），更新后才能继续使用。`
                  : `当前版本 ${current} · 安装包 ${formatMb(release.size)}。覆盖安装，登录状态和设置都会保留。`}
            </D.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 text-sm text-ink">
            {phase === "prompt" && release.notes && (
              <div className="whitespace-pre-line rounded-lg bg-sidebar px-3 py-2.5 text-[13px] leading-relaxed">{release.notes}</div>
            )}
            {phase === "downloading" && (
              <div data-update-progress={pct}>
                <div className="h-2 overflow-hidden rounded-full bg-hover">
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 text-[13px] text-ink-2">
                  {progress?.state === "paused"
                    ? progress.error
                    : progress && progress.total > 0
                      ? `正在下载 ${pct}%（${formatMb(progress.downloaded)} / ${formatMb(progress.total)}）`
                      : "正在连接…"}
                </div>
              </div>
            )}
            {phase === "permission" && (
              <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink">
                <li>点下方「去设置」</li>
                <li>打开「允许来自此来源的应用」（部分手机叫「安装未知应用」）</li>
                <li>返回 App，会自动继续安装</li>
              </ol>
            )}
            {phase === "installing" && (
              <div className="text-[13px] leading-relaxed text-ink-2">
                已打开系统安装界面，请点「更新」或「安装」。安装完成后点「打开」即可继续使用，登录状态和通知设置都会保留。
              </div>
            )}
            {phase === "error" && (
              <div className="flex items-start gap-2 rounded-lg bg-tag-red/40 px-3 py-2.5 text-[13px] text-danger">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 [&>button]:h-10 [&>button]:px-4">
            {phase === "prompt" && (
              <>
                {required ? (
                  <Button variant="ghost" onClick={() => openMobileLauncher()}>
                    切换服务器
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      snooze(release.versionCode);
                      setOpen(false);
                    }}
                  >
                    稍后
                  </Button>
                )}
                <Button variant="primary" onClick={() => void start()} data-update-start>
                  <Download className="size-4" />
                  立即更新
                </Button>
              </>
            )}
            {phase === "downloading" && canClose && (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                后台下载
              </Button>
            )}
            {phase === "permission" && (
              <Button variant="primary" onClick={() => void openMobileInstallPermissionSettings()} data-update-permission>
                去设置
              </Button>
            )}
            {phase === "installing" && (
              <>
                {canClose && (
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    关闭
                  </Button>
                )}
                <Button variant="primary" onClick={() => void install()}>
                  重新打开安装界面
                </Button>
              </>
            )}
            {phase === "error" && (
              <>
                <Button variant="ghost" onClick={() => void openMobileExternal(sameOriginUrl(release.pageUrl))}>
                  在浏览器下载
                </Button>
                <Button variant="primary" onClick={() => void start()}>
                  重试
                </Button>
              </>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
