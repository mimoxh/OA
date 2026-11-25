# OA 手机端（Android，Capacitor 套壳）

远程加载 NAS 上的 OA Web，原生层负责服务器选择、后台连接（前台服务）、通知和下载。方案见 `docs/mobile/mobile-plan.md`，M0 验证结果见 `docs/mobile/M0-validation-report.md`。

## 构建 debug APK

需要 JDK 21、Android SDK（platform 36），Node 22+，pnpm 11。`mobile/` 是根目录 pnpm workspace 的成员包（`oa-mobile`），依赖锁定在根目录 `pnpm-lock.yaml` 里，不要在这里用 npm 安装。

```powershell
# 在仓库根目录安装（会同时安装 Web、桌面端和手机端依赖）
pnpm install
$env:JAVA_HOME = "<JDK 21 路径>"; $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
pnpm mobile:build:debug          # 等同于 cd mobile; pnpm exec cap sync android; cd android; .\gradlew.bat assembleDebug
# 产物：mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

改了 `www/` 或 `capacitor.config.json` 后要重新 `pnpm mobile:sync`（`cap sync android`）再构建。服务端 Docker 镜像只安装 `oa-suite`（`pnpm install --filter oa-suite`），不会安装 Capacitor 依赖；镜像里只保留 `mobile/package.json` 供锁文件校验。

## 运行时如何选择服务器

- `capacitor.config.json` 不写 `server.url`。`MainActivity` 启动时读取用户保存的地址，用 `CapConfig.Builder` 设置 `serverUrl`；没有地址时加载包内启动页 `www/index.html`。
- 切换服务器：启动页、桌面图标长按「切换服务器」、连接失败页。
- 深链：`--es oa_path /messages/<id>`（通知点击用的就是它）。
- debug 包专用：`adb shell am start -n com.oa.suite.mobile/.MainActivity --es oa_server_url <地址>` 直接指定服务器，便于自动化测试；release 包忽略此参数。

## 后台推送（M2）

- `RtService`：前台服务常驻一条 `/rt?client=bg` WebSocket（会话 Cookie 换 rt 令牌），只接收服务端算好的 `push.notify` / `push.clear`，不计入在线状态；重连后调 `/api/push/missed` 补拉断线期间的提醒，按会话 seq 去重。
- `Notifier`：渠道 `oa_dm` / `oa_group` / `oa_mention` / `oa_system`（与 `src/lib/push/types.ts` 的 `PushChannel` 对应）和常驻通知 `oa_keepalive`；同一会话只占一条通知。
- `BootReceiver`：开机（`BOOT_COMPLETED`）和 App 升级（`MY_PACKAGE_REPLACED`）后按设置启动后台服务，不需要打开 App。
- App 在前台时由页面（`?client=app`）提醒，后台服务不重复提醒；页面切到后台 60 秒后断开自己的连接，只留后台连接。
- 设置页：Web 的「我的 → 通知」（`/me/notifications`）与厂商引导页（`/me/notifications/guide`），通过 `OAShell` 插件读写原生设置。
- 规则、去重和验证结果见 `docs/mobile/M2-report.md`，真机清单见 `docs/mobile/M2-device-checklist.md`。

## 联调

隔离 dev 实例（不要占用默认端口和数据库，参考根目录 `AGENTS.md`），然后让模拟器访问本机端口：

```powershell
adb reverse tcp:3310 tcp:3310; adb reverse tcp:1244 tcp:1244; adb reverse tcp:1245 tcp:1245
# App 里填 http://localhost:3310（localhost 属于安全上下文）
```

工具脚本（仅 debug 包，依赖 Node 22+ 内置 WebSocket）：

- `node tools/cdp.mjs eval "location.href"`：在 App 的 WebView 里执行脚本；`upload-files` 子命令可直接给文件输入框赋值。
- `node tools/peer.mjs <服务器> <邮箱> <会话 ID> <文本>`：用本机无头 Edge/Chrome 以另一个账号发消息。
- `node tools/https-proxy.mjs --pfx <证书.p12> --pass <口令> --listen 3443 --target http://127.0.0.1:3320`：本机自签 HTTPS 反代（支持 WebSocket）。

### 本机 HTTPS（自签证书）

release 包只信任系统 CA。debug 包信任用户安装的 CA，另外如果存在 `mobile/.devcerts/res/`（已加入 `.gitignore`），debug 包会用它替换 `src/debug/res`：

```powershell
New-Item -ItemType Directory -Force .devcerts/res/raw, .devcerts/res/xml
keytool -genkeypair -alias oa -keyalg RSA -keysize 2048 -validity 365 -dname "CN=OA Dev Proxy" `
  -ext "SAN=ip:10.0.2.2,ip:127.0.0.1,dns:localhost" -ext "BC=ca:true" `
  -keystore .devcerts/oa-dev.p12 -storetype PKCS12 -storepass <口令> -keypass <口令>
keytool -exportcert -rfc -alias oa -keystore .devcerts/oa-dev.p12 -storepass <口令> -file .devcerts/res/raw/oa_dev_ca.pem
```

`.devcerts/res/xml/network_security_config.xml` 在 `<trust-anchors>` 里加入 `system`、`user` 和 `@raw/oa_dev_ca`。

## 已知限制

- 局域网 HTTP（非 localhost）不是安全上下文：IM、白板等的客户端 ID 已改用不依赖安全上下文的生成方式，复制改走原生剪贴板（浏览器里回退到 `execCommand`），HTTP 下可以正常收发消息；但摄像头、麦克风（音视频通话）在 HTTP 下仍不可用。正式使用请按 `docs/mobile/deployment.md` 配置 HTTPS。
- `blob:` / `data:` 链接的下载（CSV 导出、白板草稿）暂不支持。
- 后台推送只实现了自建长连接（`PUSH_DRIVERS=realtime`）；被系统强杀且不允许自启动时收不到提醒，极光 / 个推驱动只留了接口（`src/lib/push/drivers/`）。
