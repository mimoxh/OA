import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Download, ShieldCheck, Smartphone } from "lucide-react";
import { isMobileUserAgent } from "@/lib/mobile-ua";
import { DOWNLOAD_PAGE_PATH, apkPath, isLoopbackOrigin, readMobileRelease, requestOrigin } from "@/lib/mobile-release";
import { QrCode } from "./qr-code";

export const metadata: Metadata = { title: "下载 Android App" };

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5 max-md:p-4">
      {title && <h2 className="mb-3 text-[15px] font-semibold text-ink">{title}</h2>}
      {children}
    </section>
  );
}

/** Android 安装包下载页（无需登录）：电脑上显示二维码，手机浏览器里直接下载 */
export default async function AndroidDownloadPage() {
  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  let origin = requestOrigin(h, "http://localhost");
  // 在 NAS 本机用 localhost 打开时，二维码改用配置的对外地址
  const publicBase = process.env.OA_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (isLoopbackOrigin(origin) && publicBase && !isLoopbackOrigin(publicBase)) origin = publicBase;
  const pageUrl = origin + DOWNLOAD_PAGE_PATH;
  const loopback = isLoopbackOrigin(origin);
  const inWeChat = /MicroMessenger|QQ\//i.test(ua);
  const inApp = isMobileUserAgent(ua);
  const result = readMobileRelease();
  const release = result.ok ? result.release : null;

  return (
    <div className="min-h-screen bg-sidebar px-4 py-10 max-md:py-6">
      <div className="mx-auto flex max-w-[720px] flex-col gap-4">
        <header className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-ink text-xl font-bold text-white">协</div>
          <div>
            <h1 className="text-xl font-bold text-ink">协作平台 OA · Android 版</h1>
            <p className="mt-0.5 text-[13px] text-ink-2">公司内部分发，不在应用商店上架</p>
          </div>
        </header>

        {inWeChat && (
          <div className="rounded-lg bg-tag-yellow/60 px-4 py-3 text-sm text-tag-yellow-ink" data-wechat-tip>
            微信 / QQ 里不能下载安装包：请点右上角「···」，选择「在浏览器打开」。
          </div>
        )}
        {inApp && (
          <div className="rounded-lg bg-tag-blue/50 px-4 py-3 text-sm text-ink" data-in-app-tip>
            你正在 App 里打开本页。App 会自动检查更新，也可以在「我的 → 检查更新」手动检查。
          </div>
        )}

        {!release ? (
          <Card>
            <div className="flex items-start gap-3" data-no-release>
              <Smartphone className="mt-0.5 size-5 shrink-0 text-ink-3" />
              <div className="text-sm leading-relaxed text-ink-2">
                <div className="font-medium text-ink">管理员还没有发布 Android 安装包</div>
                <div className="mt-1">
                  {result.ok === false && result.reason === "invalid"
                    ? "发布信息（release.json）格式不正确，请管理员重新发布。"
                    : result.ok === false && result.reason === "apk-missing"
                      ? "发布信息里登记的安装包文件不存在，请管理员重新发布。"
                      : "请联系管理员。发布方法见 docs/mobile/BUILD.md「发版」一节。"}
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex gap-6 max-md:flex-col">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div>
                  <div className="text-2xl font-semibold text-ink" data-version>
                    {release.versionName}
                  </div>
                  <div className="mt-1 text-[13px] text-ink-2">
                    {formatSize(release.size)}
                    {release.publishedAt && ` · ${formatDate(release.publishedAt)} 发布`} · 需要 Android 8.0 及以上
                  </div>
                </div>
                <a
                  href={apkPath(release)}
                  download={release.file}
                  data-download-apk
                  className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-lg bg-accent px-6 text-[15px] font-medium text-white hover:bg-accent-hover max-md:w-full"
                >
                  <Download className="size-5" />
                  下载安装包
                </a>
                {release.notes && (
                  <div className="rounded-lg bg-sidebar px-3 py-2.5">
                    <div className="mb-1 text-xs font-medium text-ink-2">本版更新</div>
                    <div className="whitespace-pre-line text-[13px] leading-relaxed text-ink">{release.notes}</div>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-center gap-2 max-md:hidden" data-qr>
                <QrCode text={pageUrl} className="rounded-lg border border-line" />
                <div className="text-[13px] text-ink-2">手机浏览器扫码下载</div>
                <div className="max-w-[200px] break-all text-center text-xs text-ink-3">{pageUrl}</div>
              </div>
            </div>
            {loopback && (
              <div className="mt-3 rounded-lg bg-tag-yellow/60 px-3 py-2 text-xs text-tag-yellow-ink max-md:hidden">
                当前用本机地址打开，手机扫码访问不到。请用局域网 IP 或域名打开本页（如 http://192.168.1.20:3000{DOWNLOAD_PAGE_PATH}），或在服务器上配置 OA_PUBLIC_BASE_URL。
              </div>
            )}
          </Card>
        )}

        <Card title="安装步骤">
          <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-ink">
            <li>
              用手机自带浏览器或 Chrome 打开本页，点「下载安装包」。浏览器提示「此类文件可能会损害设备」或「无法安全下载」时，选「仍然下载」/「保留」。
            </li>
            <li>
              下载完成后点「打开」（提示条消失了就到浏览器菜单 →「下载内容」里点安装包）。第一次安装时系统会提示「出于安全考虑，已禁止安装来自此来源的未知应用」：点「设置」，打开「允许来自此来源的应用」，返回后点「安装」；没有出现安装界面就再点一次安装包。
            </li>
            <li>
              安装完成后打开「协作平台 OA」，服务器地址填 <span className="font-mono text-[13px]">{loopback && publicBase ? publicBase : origin}</span>，点「连接」，然后登录。
            </li>
            <li>允许发送通知。到「我的 → 通知 → 后台保活设置引导」按提示打开自启动、关闭电池优化，锁屏后也能及时收到消息。</li>
          </ol>
        </Card>

        <Card title="常见机型提示">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
            <li>小米 / 红米：安装时提示「纯净模式」或「安全守护」，选「仍然安装」或在设置里暂时关闭纯净模式。</li>
            <li>华为 / 荣耀：开启了「纯净模式」时会拦截，选「仍然安装」，或在 设置 → 系统和更新 → 纯净模式 中暂时退出。</li>
            <li>OPPO / 一加 / vivo / iQOO：安装前的「安全检测」或「应用安装验证」可选「继续安装」；部分机型需要输入账号密码确认。</li>
            <li>纯血鸿蒙（HarmonyOS NEXT）不能安装 Android 应用，请改用手机浏览器访问 OA。</li>
          </ul>
        </Card>

        <Card title="升级">
          <p className="text-[13px] leading-relaxed text-ink-2">
            App 启动和回到前台时会自动检查新版本，按提示「立即更新」即可覆盖安装，登录状态和通知设置都会保留。也可以在本页下载新版直接安装。
            <span className="font-medium text-ink">升级时不要先卸载</span>，卸载会清掉登录状态和本机设置。
          </p>
        </Card>

        {release && (
          <Card>
            <div className="flex items-start gap-2 text-xs leading-relaxed text-ink-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 break-all">
                <div>安装包 SHA-256：{release.sha256}</div>
                {release.certSha256 && <div>签名证书 SHA-256：{release.certSha256}</div>}
              </div>
            </div>
          </Card>
        )}

        {!inApp && (
          <div className="text-center text-[13px]">
            <Link href="/login" className="text-accent hover:underline">
              在浏览器中登录 OA
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
