# OA 手机端 M0 技术验证报告（Android / Capacitor）

> 对应 `docs/mobile/mobile-plan.md` §4「M0 技术验证」。验证日期：2026-11-25。
> 结论：**Go**。Capacitor 运行时切换 `serverUrl` 可行，不需要退回原生 Kotlin WebView 壳。M0 期间**没有改动任何 Web 业务代码**。

## 0. 结论速览

| 项 | 结果 |
| --- | --- |
| 运行时配置 serverUrl（不写死在 `capacitor.config.json`） | **通过**。`MainActivity` 在 `super.onCreate()` 之前用 `CapConfig.Builder` 构造配置，切换服务器时 `recreate()`；远程页面上 Capacitor 插件全部可用 |
| debug APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk`（约 4.5 MB，包名 `com.oa.suite.mobile`，minSdk 26，targetSdk 36）。本机这次构建带了 `mobile/.devcerts`，所以额外信任本机自签测试证书；其他机器构建时没有这个目录，debug 包只信任系统 CA 和用户安装的 CA |
| 阻塞性问题 | 1 个：**局域网 HTTP（非 localhost）下 IM 发不出消息**，原因是 Web 代码依赖安全上下文才有的 `crypto.randomUUID()`（见 §3.1）。HTTPS 下全部正常 |
| 需要负责人决定 | 见 §6（局域网 HTTP 怎么处理、自签证书、mobile 包管理方式、精确闹钟权限） |

## 1. 验证环境

| 项 | 说明 |
| --- | --- |
| 构建机 | Windows 11，JDK 21（Temurin 21.0.13），Android SDK platform 36 / build-tools 35、36，Gradle 8（wrapper），Node 24 |
| 设备 | Android 模拟器 AVD `oa_m0_api36`：Android 16（API 36）google_apis x86_64，Pixel 7 外形；Android System WebView 133.0.6943.137 |
| 服务端 A：本机 `pnpm dev` | 隔离实例：web :3310（`NEXT_DIST_DIR=.next-m0`，库 `prisma/m0dev.db`，Cookie `oa_session_m0`），collab :1244，realtime :1245；App 通过 `adb reverse` 访问 `http://localhost:3310` |
| 服务端 B：NAS 同款服务 | **Docker Desktop 在本机无法启动**（守护进程启动失败），改用 Dockerfile 里同一个打包步骤 `node scripts/docker/bundle-server.mjs` 产出的 standalone 包，入口同为 `oa-standalone.mjs`（单端口网关，`/collab`、`/rt` 同源转发），端口 :3320，数据目录 `.tmp/m0-data`。差异：不在容器里、不经过 `docker-entrypoint.sh`，Node 为宿主机版本 |
| HTTPS | 本机没有 openssl，用 JDK `keytool` 生成自签证书（SAN 含 `10.0.2.2`、`127.0.0.1`、`localhost`），`mobile/tools/https-proxy.mjs` 模拟反向代理（转发 WebSocket，补 `X-Forwarded-*`）：`https://10.0.2.2:3443` → :3320。debug 包通过 `mobile/.devcerts/`（不入库）信任该证书。网关先后以 `SESSION_COOKIE_SECURE=false` 和 `true` 两种方式运行 |
| 测试账号 | `admin@demo.com`（张伟，App 端），`sales@demo.com`（李娜，对端，用本机无头 Edge 登录发送，`mobile/tools/peer.mjs`） |

## 2. 逐项结果

| # | 验证项 | 结果 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | 运行时配置 serverUrl、切换服务器 | 通过 | 启动页输入 `http://localhost:3310` → 探测 → 连接，进入登录页；通过 `OPEN_LAUNCHER` 意图（与桌面图标长按「切换服务器」相同）回到启动页、再连接其他服务器都正常；连接不存在的地址 `http://10.0.2.2:3999` 时显示包内错误页（原因 `net::ERR_CONNECTION_REFUSED`），点「切换服务器」回到启动页。最近使用列表保存了 3 个地址。远程页面可用插件：`App`、`SystemBars`、`LocalNotifications`、`OAShell`、`CapacitorCookies`、`WebView`、`CapacitorHttp`；UA 带 `OAMobile/0.1.0` |
| 2 | 连接本机 `pnpm dev` | 通过 | 登录、会话列表、实时收消息、App 端发消息（写入 `m0dev.db` seq 5）、后台通知、`/collab` 文档、杀进程后保持登录，全部正常。`localhost` 属于安全上下文，所以不受 §3.1 影响 |
| 3 | 连接 NAS 同款服务（HTTP :3320） | 部分通过 | 登录、浏览、实时接收、后台通知、上传下载正常；**发送文字消息失败**（§3.1） |
| 4 | 连接 NAS 同款服务（HTTPS :3443） | 通过 | `isSecureContext=true`；发消息、图片、文件，`/rt`（wss）、`/collab`（wss）、原生后台连接（OkHttp 走同一信任配置）全部正常 |
| 5 | 登录 Cookie 持久化（杀进程重开） | 通过（修复后） | 初版在登录后 0.15–0.4 秒内杀进程会丢登录（WebView Cookie 异步落盘）。在页面跳转、加载完成、切后台时调用 `CookieManager.flush()` 后，HTTP 3/3 次通过；HTTPS + `Secure` Cookie 通过；dev 实例通过。Cookie 现状：`httpOnly`、`SameSite=Lax`、有效期 7 天，`Secure` 跟随 `SESSION_COOKIE_SECURE` |
| 6 | Server Actions | 通过 | 登录（真实点击「登录」按钮）、发消息（HTTPS / localhost）、上传附件均走 Server Action 并写库成功；经反向代理时 Origin 校验通过 |
| 7 | `/rt` 断线重连与补拉 | 通过 | App 停在会话页 → 开飞行模式 → 对端发 2 条 → 关飞行模式，约 15 秒内两条都出现，DOM 中各 1 份，无重复无缺失。原生后台连接也自动重连（`connects=3`） |
| 8 | `/collab` 文档打开 | 通过 | `/docs/cmwvue6v0001z54wrdx0chw9e` 显示「已连接」，正文 385 字正常渲染（HTTPS 代理与 dev 实例都验证了）。admin 有编辑权限，所以编辑器是可编辑状态；只读模式是 M3 的 UI 工作 |
| 9 | 图片上传（文件选择器） | 通过 | 点「发送图片」弹出 Android 照片选择器（`accept=image/*`），多选 2 张后发送成功（seq 12、13）。注意：照片选择器返回的文件名是 `20.png` 这类编号，**原文件名丢失** |
| 10 | 文件上传（文件选择器） | 通过 | 点「发送文件」弹出系统文件选择器（DocumentsUI），选 `Download/m0-upload.txt`，文件名和大小（21 B）正确（seq 14） |
| 11 | 文件下载 | 通过（普通链接） | 点击文件卡片（`<a download href=…?download=1>`）→ 系统 DownloadManager（带 Cookie 和 UA）→ `/sdcard/Download/OA/m0-upload.txt`，内容一致，下载完成通知正常。**`blob:` 下载（多维表格导出 CSV、白板下载草稿）不支持**，只会弹提示，本次没有实测 |
| 12 | 本地通知插件 | 通过（需改参数） | 远程页面调用 `LocalNotifications.schedule` 可用。坑：Android 12+ 默认 `isExactNotification=true`，没有精确闹钟权限时插件会**跳转到「闹钟和提醒」设置页，调用一直挂起**。传 `isExactNotification: false` 后立即显示；启动页的「测试本地通知」（5 秒后）已改为该参数并实测通过 |
| 13 | 前台服务保活：后台收消息 | 通过 | `specialUse` 前台服务常驻一条 `/rt`，回到桌面后收到消息弹通知（HTTP、HTTPS、dev 三种服务端都通过）；**熄屏**后通过；强制 Doze 深度休眠 90 秒后通过；HTTPS + `Secure` Cookie 下熄屏通过。点击通知进入对应会话 `/messages/<id>` |
| 14 | 熄屏 30 分钟（模拟器，强制 Doze、拔电模拟） | 通过 | 见 §2.1。 真机测试见清单 `docs/mobile/M0-device-checklist.md` |
| 15 | 国产机锁屏 30 分钟 | **未测** | 没有真机。小米/红米、华为/荣耀、OPPO/vivo 需按清单实测 |

### 2.1 模拟器熄屏 30 分钟

测试步骤：回桌面 → 拔电（`dumpsys battery unplug`）→ 熄屏 → `dumpsys deviceidle force-idle` → 等 30 分钟 → 对端发消息 → 15 秒内检查通知。

结果：**通过**。16:44:22 进入强制深度 Doze（`deep state: IDLE`，屏幕 `Asleep`），30 分钟后对端发送「M0 锁屏30分钟 8」（服务端 `createdAt` 09:14:23.292 UTC），通知的生成时间为 09:14:22.959（模拟器时钟比宿主机慢不到 1 秒），即**1 秒内送达**；常驻通知一直保持「已连接」。（脚本里 15 秒后的自动检查因为控制台编码问题没匹配到中文，结果改用通知记录里的时间戳核对。）

说明：模拟器没有国产 ROM 的后台管理，这项结果只能证明 Android 原生 Doze 下前台服务 + WebSocket 可以存活，不能代替真机测试。

## 3. 发现的问题

### 3.1 局域网 HTTP 下 IM 发不出消息（Web 现有问题，阻塞）

- 现象：App 连 `http://<局域网 IP>:<端口>` 时，按发送后输入框被清空，但消息没有出现，也没有报错提示，数据库里没有记录。
- 原因：`src/components/im/store.ts` 的 `sendText` / `sendThreadText` / `sendThreadAttachment` / `sendAttachment` 用 `crypto.randomUUID()` 生成 `clientMsgId`。这个 API **只在安全上下文（HTTPS 或 localhost）里存在**；实测 HTTP 页面上 `typeof crypto.randomUUID === "undefined"`，调用抛 TypeError，而 Composer 先清空了输入框。白板（`whiteboard-canvas.tsx`、`whiteboard-workspace.tsx`）同样直接调用，`navigator.clipboard` 也一样。
- 影响面：**不只是手机**。普通电脑浏览器通过局域网 IP 用 HTTP 访问 NAS 时也会遇到同样的问题（Tauri 桌面端用 Chromium 参数把地址视为安全来源，所以不受影响）。
- M0 没有改 Web 代码，只在启动页的说明里写明 HTTP 的限制。处理方式需要负责人决定（§6 第 1 项）。

### 3.2 WebView Cookie 异步落盘（已修复）

登录后立即被杀进程会丢失登录状态。已在 `OAWebViewClient.doUpdateVisitedHistory/onPageFinished` 和 `MainActivity.onPause` 里调用 `CookieManager.flush()`。

### 3.3 本地通知插件的精确闹钟（已规避）

见 §2 第 12 项。`@capacitor/local-notifications` 8.x 会合并声明 `SCHEDULE_EXACT_ALARM` 权限。IM 提醒不需要精确闹钟，建议 M2 时在 Manifest 里移除该权限，并统一传 `isExactNotification: false`。

### 3.4 停在启动页时点消息通知不跳转（已修复）

用户打开启动页后再点通知，原来会停在启动页。现在会切回已保存的服务器并打开对应会话（`MainActivity.onNewIntent`）。

### 3.5 原生后台连接不补发离线期间的通知（M2 处理）

前台服务只把**连接期间**收到的 `message.new` 显示为通知。断网期间到达的消息，重连后不会补通知（打开 App 后页面会补拉，不会丢消息）。M2 的服务端推送派发需要补充：重连时按 `seq` 或未读数补一条汇总通知。

### 3.6 现有页面在手机上不可用（M1 已规划）

- 页面是桌面布局：布局视口约 560 CSS 像素宽，而设备是 412，横向溢出，聊天气泡里的中文被挤成一列竖排。
- 软键盘收起后，曾有一次出现页面只画在上半屏、下半屏空白的情况（`visualViewport` 高度没恢复），重载无效，重启 App 恢复。M1 做移动布局时要配合 `interactive-widget` 与 `visualViewport` 一起处理并回归。
- Gboard 软键盘的回车会直接发送（英文输入）；中文输入法组合输入时的回车行为没有测（模拟器没有中文输入法），放进真机清单。

### 3.7 其他观察

- Android 16 有「通知冷却」：短时间内多条通知会自动降低音量，测试时要注意不是丢通知。
- 默认电池优化状态是「受限制」，启动页提供「忽略电池优化」和「应用设置」入口，国产 ROM 还需要手动开自启动。
- `RtService` 用同一个用户身份连 `/rt`，服务端会把它当成一个在线连接，可能让用户在 App 退到后台时仍显示「在线」。没有实测，M2 计划里的 `?client=bg` 区分要做。
- Docker 不可用，NAS 容器本身（`docker-entrypoint.sh`、容器网络）没有验证；standalone 包与镜像内运行的是同一份产物。

## 4. 对 M1 / M2 的影响

| 阶段 | 影响 |
| --- | --- |
| M1 | 1）先解决 §3.1（如果局域网 HTTP 要继续支持），否则手机和电脑浏览器在 HTTP 下都不能发消息。2）移动布局要处理键盘收起后的视口恢复。3）文件名：照片选择器会改名，如果要保留原名，可以改用「文件」入口，或在 M1 接原生选择器。4）`blob:` 下载需要一个桥接方法（页面把数据以 base64 交给原生保存），涉及多维表格 CSV 导出和白板草稿下载。5）会话有效期仍是 7 天（30 天滑动续期按计划在 M1 做），过期后原生后台连接会停在「未登录」，状态已能在通知栏和启动页显示。6）`mobile/` 目前用 npm 独立安装（见 §6 第 3 项）。 |
| M2 | 1）保活原型（`RtService`）可以直接作为 `realtime` 推送驱动的客户端基础：认证复用 WebView Cookie → `/api/realtime-token` → `/rt`，服务端零改动已跑通。2）需要补：离线期间补通知（§3.5）、后台连接不计入在线状态、开机自启（`BOOT_COMPLETED`，原型未做）、按会话分渠道、前台时 WebView 内提醒改走原生。3）移除 `SCHEDULE_EXACT_ALARM`。4）真机送达率和耗电数据决定是否追加极光/个推。 |

## 5. 改动清单

### 5.1 新增：`mobile/`（Capacitor 8 工程）

| 路径 | 作用 |
| --- | --- |
| `mobile/package.json`、`package-lock.json` | `oa-mobile` 包：`@capacitor/core`/`android`/`cli` 8.6.2，`@capacitor/app` 8.1.2，`@capacitor/local-notifications` 8.3.1 |
| `mobile/capacitor.config.json` | 包名、UA 标记、错误页、本地通知图标；**不写 `server.url`**，由原生代码在运行时决定 |
| `mobile/www/index.html` | 包内启动页：输入服务器地址并探测、最近使用、继续使用、后台连接开关与状态、通知权限、忽略电池优化、应用设置、测试本地通知、诊断信息 |
| `mobile/www/error.html` | 连接失败页：显示原因，重试 / 回到启动页 |
| `mobile/android/app/src/main/java/com/oa/suite/mobile/MainActivity.java` | 运行时构造 `CapConfig`（serverUrl、UA、错误页）、切换服务器、深链 `oa_path`、`OPEN_LAUNCHER`、Cookie 落盘、前后台状态、错误页桥接；debug 包支持 `--es oa_server_url` 自动化测试 |
| `…/ServerStore.java`、`AppState.java` | 服务器地址与最近列表、保活开关的存储；前后台状态 |
| `…/OAWebViewClient.java` | 只在网络/证书/502–504 错误时显示错误页；Cookie 落盘 |
| `…/OADownloadListener.java` | 下载交给 DownloadManager（带 Cookie/UA），保存到 `Download/OA/` |
| `…/OAShellPlugin.java` | 启动页和远程页面可用的 `OAShell` 插件：getState / probe / connect / forget / openLauncher / setKeepAlive / 电池优化 / 设置页 |
| `…/RtService.java` | `specialUse` 前台服务：Cookie → `/api/realtime-token` → `/rt`（OkHttp），指数退避、网络切换重连、App 不在前台时把 `message.new` 显示为通知 |
| `AndroidManifest.xml`、`res/xml/network_security_config.xml`（main：系统 CA + 允许明文；debug：另信任用户 CA）、`res/xml/shortcuts.xml`、图标、`variables.gradle`（minSdk 26）、`app/build.gradle`（版本 0.1.0、OkHttp 4.12.0、`.devcerts` 覆盖） | 原生配置 |
| `mobile/tools/cdp.mjs` | 通过 adb 转发 WebView DevTools，在 App 内执行脚本（仅 debug 包） |
| `mobile/tools/peer.mjs` | 本机无头 Edge 以另一个账号登录并发消息，模拟对端 |
| `mobile/tools/https-proxy.mjs` | 本机自签 HTTPS 反向代理（支持 WebSocket） |
| `mobile/README.md` | 构建与联调说明 |

### 5.2 仓库根目录配置（非业务代码）

- `tsconfig.json`：`exclude` 加 `mobile`；`eslint.config.mjs`：忽略 `mobile/**`；`.gitignore`：忽略 `/mobile/node_modules`、`/mobile/.devcerts/`；`.dockerignore`：排除 `mobile`（不参与服务端镜像构建）。
- `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`Dockerfile` **未改**。

### 5.3 Web 代码（`src/`、`server/`、`prisma/`）

**无改动。**

## 6. 需要负责人决定

1. **局域网 HTTP 是否继续支持**（影响手机和电脑浏览器）：
   - 方案甲：Web 加一个不依赖安全上下文的 ID 生成函数，替换 `store.ts` 中 4 处和白板中 4 处 `crypto.randomUUID()`，剪贴板失败时给出提示。约 0.5 人日，HTTP 下即可正常发消息（摄像头、麦克风仍不可用）。
   - 方案乙：要求一律使用 HTTPS（包括办公室内网，需要域名和内网 DNS 或反代），Web 不改。
   - 建议：M1 一开始先做方案甲，对外访问仍按计划走 HTTPS。
2. **自签证书**：release 包只信任系统 CA。正式 HTTPS 请使用公共 CA 证书（例如 Let's Encrypt，反代自动续期），App 无需任何改动。如果一定要用自签或内网 CA，需要决定是否让 release 包信任用户安装的 CA（安全性下降，员工要手动安装证书）。
3. **`mobile/` 的包管理**：M0 为了不动 `pnpm-lock.yaml` 和 `Dockerfile`，`mobile/` 用 npm 独立安装（有自己的 `package-lock.json`），根目录的 typecheck/lint 也排除了它。是否在 M1 按计划改为 pnpm workspace 包（需要同时改 `Dockerfile` 的 `COPY mobile/package.json`）？
4. **精确闹钟权限**：建议移除 `SCHEDULE_EXACT_ALARM`（IM 不需要），确认即可。
5. **真机测试**：需要安排人员和设备按 `docs/mobile/M0-device-checklist.md` 实测，结果决定 M2 是否追加极光/个推。

## 7. 复现方法

```powershell
# 1. 构建 debug APK（需 JDK 21、Android SDK；首次先在 mobile/ 下 npm install）
$env:JAVA_HOME = "<JDK 21 路径>"; $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd mobile; npx cap sync android; cd android; .\gradlew.bat assembleDebug
# 产物：mobile/android/app/build/outputs/apk/debug/app-debug.apk

# 2. 安装并指定服务器（debug 包专用的自动化参数；正常使用在启动页输入）
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.oa.suite.mobile/.MainActivity --es oa_server_url https://10.0.2.2:3443

# 3. 在 App 内执行脚本 / 模拟对端发消息
node mobile/tools/cdp.mjs eval "location.href"
node mobile/tools/peer.mjs http://127.0.0.1:3320 sales@demo.com <会话 ID> "测试消息"
```

本地 HTTPS 联调、隔离 dev 实例的启动方式见 `mobile/README.md`。
