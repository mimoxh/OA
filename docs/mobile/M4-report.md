# OA 手机端 M4 报告：签名、分发与升级

> 范围见 `docs/mobile/mobile-plan.md` §4「M4」。本期只在模拟器上验证，真机按 `docs/mobile/device-checklist.md`（M0–M4 合并版）统一测试。

## 1. 结论

- 正式签名的 release 包可以构建、校验和发布：`pnpm mobile:build` → `pnpm mobile:publish`。签名为 v2 + v3，R8 压缩后 1.14 MB，Capacitor 插件和 JS 桥接都正常工作。
- NAS 自带下载页 `/download/android`（二维码、安装步骤、证书指纹），APK 放在挂载目录，不进 Docker 镜像。发布后立即生效，不用重启容器。
- App 启动时和回到前台时（最多每 10 分钟一次）检查 `/api/mobile/version`，支持可选更新和强制更新。下载用系统下载器，安装前校验 SHA-256、包名、版本号和签名证书，缺少权限时引导打开「安装未知应用」。
- 模拟器上走完了「从下载页安装 0.0.9 → 提示更新 → 下载 → 授权 → 覆盖安装 0.1.0」，登录状态、服务器地址和通知设置都保留了。强制更新（0.1.0 → 0.1.1）也走了一次，弹窗关不掉。
- 电脑端没有回归：10 个页面与改动前逐像素对比，差异都是 0.00%。Docker 和桌面一体包的服务端打包都能正常完成。

**需要负责人处理**：签名密钥目前**只有构建机上一份**（见 §3），请尽快指定保管人并完成离线备份。

## 2. 验收结果

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | `apksigner verify` 通过，v2 / v3 签名 | 通过 | v1 false、v2 true、v3 true，1 个签名者，证书 SHA-256 与 §3 一致 |
| 2 | 从下载页安装 | 通过 | 模拟器 Chrome 打开 `http://10.0.2.2:3330/download/android` → 下载（HTTP 下 Chrome 提示「无法安全下载」，选「保留」）→ 允许 Chrome 安装未知应用 → 安装成功 → 连接、登录。截图 01–07 |
| 3 | 冒烟：登录 / IM / 推送 / 白板 / 审批 / PDF（release 包） | 通过 | 推送：后台收到单聊通知，耗时 2.7 秒，点通知进入会话（22）。IM：App 内回复写入数据库（23）。审批：打开详情并发表评论（24），当前账号没有待办，所以没有走「同意」。白板：画了一个矩形，服务端 `updatedAt` 更新（25）。PDF：8 页预览正常（26），原生下载保存到 `Download/OA/`。logcat 里没有 `ClassNotFound` / `NoSuchMethod` / 崩溃 |
| 4 | 旧版本（0.0.9）检测 → 下载 → 覆盖安装 → 登录和通知设置保留 | 通过 | 升级前把「群聊消息」渠道设为静音（importance 2），升级后 `oa_group=2 oa_mention=4 oa_dm=4 oa_system=4` 不变。`firstInstallTime` 不变（覆盖安装），仍以张伟登录，服务器地址、后台连接都保留。更新包缓存目录 `updates/` 在升级后被清空。截图 09–18 |
| 5 | 强制更新走一次 | 通过 | 发布 0.1.1 并加 `--min latest`，重开 App 后弹出「需要更新到 0.1.1」。返回键和点空白处都关不掉，只有「立即更新」和「切换服务器」。更新完成后进入 0.1.1，仍是登录状态。截图 19、21 |
| 6 | 版本接口测试 | 通过 | `tests/mobile/mobile-release.test.ts`（11 项）覆盖：版本号公式与 gradle 一致、none / optional / required、发布目录查找顺序、release.json 校验（非法文件名、缺包）、反代头、Range 续传 / HEAD、未登录可访问接口和下载页（其他页面仍需登录） |
| 7 | typecheck / lint / test | 通过 | `pnpm typecheck` 0、`pnpm lint` 0、`pnpm test` 211 / 211 |
| 8 | Docker / standalone、桌面一体包构建 | 通过 | `scripts/docker/bundle-server.mjs` → 76.6 MB；`scripts/desktop/bundle-server.mjs` → 165.2 MB。容器本身没有运行（同 M0–M3，本机没有可用的 Docker） |
| 9 | 电脑端不回归 | 通过 | 改动前（b1649ea）和改动后各构建一份 standalone，在同一份数据上用无头 Edge 1440×900 以王芳登录，截图 10 个页面：消息列表、群聊、文档列表、带 PDF 的文档、白板、工作台、审批、设置、收件箱、通讯录。全部 0.00%。登录页底部新增「下载 Android App」链接（有意的改动，App 内不显示） |

模拟器：`oa_m0_api36`（Android 16，1080×2400），服务端为 standalone 单端口包，端口 3330，数据目录 `.tmp/m4-data`（复制自 M3），App 访问 `http://10.0.2.2:3330`。release 包关闭了 WebView 调试，所以 App 内操作用 `uiautomator dump` + `adb shell input` 完成（脚本 `.tmp/m4ui.mjs`、`.tmp/m4-s*.mjs`）。

## 3. 签名密钥

| 项目 | 值 |
| --- | --- |
| 密钥库 | `C:\Users\16617\.oa-mobile\oa-release.p12`（PKCS12，RSA 4096，别名 `oa-release`，有效期到 2054-04-13） |
| 配置 | `C:\Users\16617\.oa-mobile\keystore.properties`（含随机生成的口令，只在这台机器上） |
| 证书 DN | `CN=OA Suite Mobile, OU=Mobile, O=OA Suite, C=CN` |
| 证书 SHA-256 | `C2:E2:74:F8:65:37:7D:C7:59:00:51:2A:FF:FC:EC:74:24:1F:AB:C8:2A:64:05:AE:A0:67:15:F0:DB:E9:75:0A` |
| 证书 SHA-1 | `FE:AA:47:F3:95:4F:7D:A6:CF:9E:81:36:78:F6:D6:22:BE:16:65:14` |
| 混淆映射归档 | `C:\Users\16617\.oa-mobile\mappings\` |

- 仓库里只有示例文件 `mobile/android/keystore.properties.example`；`.gitignore` 排除了 `*.p12`、`*.jks`、`*.keystore`、`keystore.properties`。gradle 找不到签名配置时直接报错，不会产出未签名的包。
- **备份方法**：把 `.p12` 和 `keystore.properties` 复制到两处离线介质，口令另存到密码管理器，再在另一台机器上用 `keytool -list -v` 核对指纹（步骤见 `BUILD.md` §3.1）。
- **丢失后果**：已安装的 App 再也无法覆盖升级，所有用户只能卸载重装，本机登录状态、服务器地址、通知设置全部丢失。v3 签名支持以后做密钥轮换，但前提是旧密钥还在。

## 4. 实现

### 4.1 构建与版本

- `mobile/android/app/build.gradle`：`versionName` 取根目录 `package.json` 的 `version`，`versionCode = X×10000 + Y×100 + Z`（0.1.0 → 100）；`-PoaVersionName=0.0.9` 只用于构建测试包。签名从 `OA_KEYSTORE_PROPERTIES` → `mobile/android/keystore.properties` → `~/.oa-mobile/keystore.properties` 读取，口令可用环境变量覆盖；只开 v2 + v3。release 开启 `minifyEnabled` + `shrinkResources`。
- `proguard-rules.pro`：保留 `com.oa.suite.mobile.**`（Capacitor 按类名注册插件）、`@JavascriptInterface` 方法和行号信息。
- `capacitor.config.json` 去掉了写死的 `appendUserAgent`（版本号改由 `MainActivity` 从 `BuildConfig` 拼进 UA）。
- 脚本：`pnpm mobile:build`（`cap sync` + `assembleRelease`）；`pnpm mobile:publish`（`scripts/mobile/publish-apk.mjs`）：校验版本规则和签名（拒绝调试证书、拒绝证书变化、拒绝版本不升高），写 `release.json` 和 `oa-mobile-<版本>.apk`，保留最近两个版本，归档映射文件。
- 产物：`mobile/android/app/build/outputs/apk/release/app-release.apk`，0.1.0（versionCode 100），1,196,988 字节，SHA-256 `b34c1720b9cf1617bce42fd56fe2eddb56bf88f6f56d070b4bad57224656a1f3`。重新构建得到的 SHA-256 完全相同，与升级测试里安装的 0.1.0 是同一个包。

### 4.2 服务端

- `GET /api/mobile/version?current=<versionCode>`（`src/app/api/mobile/version/route.ts`）：无需登录，`Cache-Control: no-store`；返回最新版本、最低支持版本、按请求地址生成的下载地址、大小、SHA-256、更新说明，以及 `update: none | optional | required`。
- `/download/android`（`src/app/download/android/page.tsx`）：版本信息、二维码（`uqr`，服务端生成 SVG）、安装步骤、常见机型提示、升级说明、安装包与证书指纹。从 `127.0.0.1` 打开时提示改用局域网地址。没有发布时显示「管理员还没有发布 Android 安装包」。
- `/download/android/<文件>.apk`、`latest.apk`（`[file]/route.ts`）：只提供 `release.json` 登记的文件，支持 Range 和 HEAD，带 ETag（SHA-256）。
- `src/proxy.ts` 的 `PUBLIC_PATHS` 加入 `/api/mobile/version`、`/download/android`。
- 发布目录：`MOBILE_RELEASE_DIR` → `OA_DATA_DIR/mobile` → `./data/mobile`（`src/lib/mobile-release.ts`）。Docker：`ENV MOBILE_RELEASE_DIR=/data/mobile`，`docker-compose.nas.yml` 把 `${OA_MOBILE_DIR:-./nas-data/mobile}` 只读挂载进去。它不是 `VOLUME`，镜像里也没有 APK；`.dockerignore` 本来就排除了 `data/` 和 `mobile/*`。桌面一体包用 `<数据目录>/mobile`。

### 4.3 App 内更新

- 页面：`src/components/mobile/app-update.tsx`（挂在根布局，只在 App 内生效，登录页也会检查）。启动 1.5 秒后检查一次，回到前台时距上次检查超过 10 分钟再查；「稍后」在 24 小时内不再提示同一版本；强制更新时弹窗不可关闭，只能更新或「切换服务器」。「我的」页新增「检查更新」。旧版 App 没有更新接口时，回退为在系统浏览器打开下载页。
- 原生：`AppUpdater.java` + `OAShellPlugin`（`downloadUpdate`、`getUpdateProgress`、`installUpdate`、`canInstallPackages`、`openInstallPermissionSettings`、`cancelUpdate`）。用 `DownloadManager` 下载到 App 私有外部目录 `updates/`（不需要存储权限），只接受与当前服务器同源的地址。下载完成后校验 SHA-256、包名、versionCode，以及签名证书是否与已安装的 App 一致，然后通过 FileProvider 调起系统安装器。清单新增 `REQUEST_INSTALL_PACKAGES`；`BootReceiver` 在 `MY_PACKAGE_REPLACED` 时清理 `updates/`。

## 5. 文档

| 文件 | 内容 |
| --- | --- |
| `docs/mobile/BUILD.md` | 构建环境、版本号规则、签名密钥（位置、备份、丢失后果、首次生成）、构建、发布参数、测试旧版本、常见问题 |
| `docs/mobile/USER_GUIDE.md` | 员工用：安装（扫码、未知来源、各品牌拦截）、首次使用、通知与电池设置、升级、常见问题 |
| `docs/mobile/device-checklist.md` | M0–M4 合并的真机清单，按 P0 / P1 / P2 排列；旧的 M0 / M2 / M3 清单顶部加了指向说明 |
| `docs/mobile/deployment.md` §6、`docs/NAS_DEPLOY.md`、`mobile/README.md`、`.env.nas.example` | 下载页与发布目录、`OA_MOBILE_DIR`、release 包说明 |

## 6. 截图（`docs/mobile/m4-screenshots/`）

| 文件 | 内容 |
| --- | --- |
| `00-download-page-desktop.png`、`00-login-download-link.png` | 电脑端下载页（二维码；用 127.0.0.1 打开时的局域网地址提示）、登录页入口 |
| `01-download-page-mobile.png`、`01b-download-page-mobile-guide.png` | 手机浏览器下载页、安装步骤 |
| `02`–`06` | Chrome「保留」下载 → 未知来源提示 → 允许 Chrome 安装 → 安装确认 → 安装完成 |
| `07`、`08` | 0.0.9 登录后、「检查更新」 |
| `09` | 升级前的通知设置（群聊已在系统里设为静音） |
| `10` | **可选更新提示** |
| `12`、`13` | **「允许安装更新」引导**、系统「允许来自此来源的应用」 |
| `14`、`15` | 系统更新确认、更新完成 |
| `16`–`18` | 升级到 0.1.0 后：仍登录、「我的」版本号、通知设置 |
| `19` | **强制更新提示**（返回键、点空白处都关不掉） |
| `21` | 强制更新完成后（0.1.1） |
| `22`–`26` | release 包冒烟：推送通知、IM 回复、审批评论、白板、PDF 预览 |

下载进度条没有截到：模拟器上 1.1 MB 的包不到 1 秒就下载完了。

## 7. 遗留问题与需要决定的事

1. **谁保管签名密钥、谁做备份**（必须）：目前只有 `C:\Users\16617\.oa-mobile\` 一份。建议指定一名保管人和一名备份人，按 `BUILD.md` §3.1 做两处离线备份并核对指纹。
2. **下一个正式版本号至少用 0.1.2**：为测试升级流程构建过用正式密钥签名的 0.0.9 和 0.1.1 测试包（`.tmp/m4-apks/`，映射文件也归档在 `mappings/` 里）。0.1.1 测试包比正式的 0.1.0 新，正式发版应跳过 0.1.1。测试包不要外传，验收后可以删除 `.tmp/m4-apks/`。
3. **M0–M3 的 debug 包不能直接升级**：它们用调试证书签名，测试人员需要先卸载一次再从下载页安装正式包（卸载后要重新填服务器地址和登录）。
4. 真机没有测：各品牌的安装拦截、厂商安装器的二次扫描、系统下载器行为，需要按 `device-checklist.md` §1 和 §4.4 确认。
5. 局域网 HTTP 下 Chrome 会提示「无法安全下载」，需要用户手动选「保留」。配置 HTTPS（`deployment.md`）后不会出现这个提示。
6. 前台检查的 10 分钟节流只做了代码审查，模拟器上只验证了启动检查和手动检查。
7. 「我的 → 通知」的类别只显示开 / 关，系统里设成「静音」时仍显示「已开启」（M2 的显示方式，不影响功能）。
8. 以前就存在的 Next 文件追踪警告（`orca-catalog` 的 `execFile` 和动态 `path.join` 导致追踪整个项目）使 `.nft.json` 清单里列出了本机的 gradle 构建文件，standalone 包从 70.8 MB 变为 76.6 MB。实际复制的文件没有变化，Docker 构建上下文也排除了 `mobile/*`，不影响镜像。建议以后单独给这两处加 `turbopackIgnore`。
9. 模拟器上现在装的是 0.1.1 测试包（release 签名）。继续用 debug 包联调前，需要先 `adb uninstall com.oa.suite.mobile`。
