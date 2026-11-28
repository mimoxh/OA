# 手机端构建与发布（Android release）

> 面向维护者：在 Windows 构建机上产出正式签名的 APK，并发布到 NAS 的下载页。日常联调用的 debug 包见 `mobile/README.md`；用户安装与升级说明见 `docs/mobile/USER_GUIDE.md`。

## 1. 构建环境

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Windows + PowerShell 7 | — | 命令按 PowerShell 写；Node / pnpm 不要在 WSL 里跑（根目录 `AGENTS.md`） |
| JDK | 21 | 设 `JAVA_HOME`。`apksigner`、`keytool` 都靠它 |
| Android SDK | platform 36、build-tools 35 以上（含 `apksigner`） | 设 `ANDROID_HOME`，默认 `%LOCALAPPDATA%\Android\Sdk` |
| Node | 22 以上 | |
| pnpm | 11 | 在仓库根目录 `pnpm install`，会同时安装 `mobile/` 的 Capacitor 依赖 |

```powershell
$env:JAVA_HOME = "<JDK 21 路径>"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

## 2. 版本号

- `versionName` 取**根目录 `package.json` 的 `version`**（与 Web 同一个版本号），只能是 `X.Y.Z`，Y、Z 不超过 99。
- `versionCode = X × 10000 + Y × 100 + Z`，例如 `0.1.0 → 100`、`1.2.3 → 10203`。公式在 `mobile/android/app/build.gradle` 和 `src/lib/mobile-version.ts` 各有一份，改规则时两处一起改。
- `mobile/package.json` 的 `version` 不参与构建，不用维护。
- 发版前先改根目录 `package.json` 的版本号。版本号不比已发布的高时，`pnpm mobile:publish` 会拒绝发布（Android 也不允许降级覆盖安装）。

**什么时候需要发新 APK**：App 加载的是 NAS 上的网页，Web 页面的改动随 NAS 更新自动生效，不需要重新安装。只有改了原生层（`mobile/android/**`、`mobile/www/` 启动页、`capacitor.config.json`、Capacitor 依赖）才要发新 APK。

## 3. 签名密钥

正式密钥**不入库**，只放在构建机的用户目录：

| 文件 | 位置 | 内容 |
| --- | --- | --- |
| 密钥库 | `%USERPROFILE%\.oa-mobile\oa-release.p12` | PKCS12，RSA 4096，别名 `oa-release`，有效期到 2054 年 |
| 配置 | `%USERPROFILE%\.oa-mobile\keystore.properties` | 密钥库路径、别名、口令（格式见 `mobile/android/keystore.properties.example`） |
| 混淆映射 | `%USERPROFILE%\.oa-mobile\mappings\` | 每次发布自动归档 `mapping-<版本>-<versionCode>.txt`，用于还原崩溃堆栈 |

gradle 按以下顺序查找签名配置，找不到就**直接报错**，不会产出未签名或调试签名的 release 包：

1. 环境变量 `OA_KEYSTORE_PROPERTIES` 指向的文件；
2. `mobile/android/keystore.properties`（已加入 `.gitignore`）；
3. `%USERPROFILE%\.oa-mobile\keystore.properties`。

口令也可以不写进文件，改用环境变量 `OA_KEYSTORE_PASSWORD` / `OA_KEY_PASSWORD` 提供。`*.p12`、`*.jks`、`*.keystore`、`keystore.properties` 都在 `mobile/android/.gitignore` 里。

**当前证书指纹**（下载页底部也会显示，可用来核对安装包来源）：

```text
SHA-256: C2:E2:74:F8:65:37:7D:C7:59:00:51:2A:FF:FC:EC:74:24:1F:AB:C8:2A:64:05:AE:A0:67:15:F0:DB:E9:75:0A
SHA-1:   FE:AA:47:F3:95:4F:7D:A6:CF:9E:81:36:78:F6:D6:22:BE:16:65:14
```

### 3.1 备份（必须做）

**密钥丢失或口令遗忘后，已安装的 App 就无法覆盖升级了**：只能让所有用户卸载后重装，本机的登录状态、服务器地址、通知设置都会丢失。Android 没有任何找回办法。

1. 把 `oa-release.p12` 和 `keystore.properties` 两个文件复制到**至少两处离线介质**（加密 U 盘、公司保险柜里的移动硬盘），不要放进网盘同步目录或代码仓库。
2. 口令另外记在公司的密码管理器里（与文件分开保管）。
3. 备份后在另一台机器上用备份文件验证一次：

   ```powershell
   $env:JAVA_TOOL_OPTIONS = "-Duser.language=en"   # keytool 中文输出在部分终端会乱码
   keytool -list -v -keystore <备份路径>\oa-release.p12 -storetype PKCS12 -alias oa-release
   # 输入口令后，核对 SHA256 指纹与上面一致
   ```

4. 换构建机时：复制两个文件到新机器的 `%USERPROFILE%\.oa-mobile\`，`keystore.properties` 里的 `storeFile` 写相对路径 `oa-release.p12` 即可（相对配置文件所在目录）。

签名用了 v3 方案，以后如需更换密钥，可以用 `apksigner rotate` 做密钥轮换（新旧密钥都必须还在）；密钥丢失时轮换也做不了。

### 3.2 首次生成（已经生成过，不要重复执行）

只有在全新部署、还没有任何用户安装过 App 时才需要：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.oa-mobile" | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Duser.language=en"
keytool -genkeypair -alias oa-release -keyalg RSA -keysize 4096 -validity 10000 `
  -dname "CN=OA Suite Mobile, OU=Mobile, O=OA Suite, C=CN" `
  -storetype PKCS12 -keystore "$env:USERPROFILE\.oa-mobile\oa-release.p12"
# 按提示输入口令（PKCS12 的密钥口令与密钥库口令相同），然后按 keystore.properties.example 写配置文件
```

## 4. 构建

```powershell
pnpm mobile:build
# = cd mobile; cap sync android; cd android; .\gradlew.bat assembleRelease
# 产物：mobile/android/app/build/outputs/apk/release/app-release.apk（约 1.2 MB）
```

- release 包开启了 R8（`minifyEnabled` + `shrinkResources`）。`proguard-rules.pro` 保留了本应用的全部类（`com.oa.suite.mobile.**`，Capacitor 插件按类名反射注册）、`@JavascriptInterface` 方法和行号信息；Capacitor 自带的规则随依赖生效。新增原生插件放在 `com.oa.suite.mobile` 包下即可，不用改规则。
- release 包关闭了 WebView 远程调试（`setWebContentsDebuggingEnabled(BuildConfig.DEBUG)`），`mobile/tools/cdp.mjs` 只能用于 debug 包。
- 签名只开 v2 + v3（最低 Android 8.0，不需要 v1）。手动校验：

  ```powershell
  & "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs mobile\android\app\build\outputs\apk\release\app-release.apk
  # 应看到 v2 / v3 为 true，Signer #1 certificate SHA-256 与 §3 一致
  ```

## 5. 发布到下载页

```powershell
pnpm mobile:publish --dir <发布目录> --notes "· 更新内容一`n· 更新内容二"
```

脚本 `scripts/mobile/publish-apk.mjs` 会：

1. 读取 gradle 生成的 `output-metadata.json`，确认 versionCode 与 versionName 符合 §2 的规则；
2. 用 `apksigner` 校验签名：必须有 v2/v3，**拒绝调试证书**；证书与上次发布不同时拒绝（会导致用户无法覆盖升级）；
3. 把 APK 复制为 `oa-mobile-<版本>.apk`，写 `release.json`（版本、大小、SHA-256、更新说明、证书指纹、最低支持版本）；
4. 只保留本次和上一个版本的 APK；把混淆映射归档到 `%USERPROFILE%\.oa-mobile\mappings\`。

| 参数 | 说明 |
| --- | --- |
| `--dir <目录>` | 发布目录。也可用环境变量 `MOBILE_RELEASE_DIR`；都不写时为 `data/mobile` |
| `--notes "..."` / `--notes-file <文件>` | 更新说明，显示在下载页和 App 的更新提示里（支持换行） |
| `--min <版本>` | 最低支持版本，低于它的 App 会被**强制更新**（弹窗不能关闭）。可写 `X.Y.Z`、versionCode 或 `latest`（等于本次版本）。不写时沿用上次的设置；`--min 0` 取消强制 |
| `--apk <文件>` | 发布其他位置的 APK（同目录必须有 `output-metadata.json`，映射文件只认同目录的 `mapping.txt`） |
| `--force` | 允许版本不升高或证书变化（仅用于测试或回退，正式环境不要用） |

发布目录在哪里：

| 部署方式 | 目录 | 说明 |
| --- | --- | --- |
| NAS Docker | 宿主机 `OA_MOBILE_DIR`（`.env.nas`，默认 `./nas-data/mobile`） | `docker-compose.nas.yml` 只读挂载到容器 `/data/mobile`。在电脑上发布到共享目录，或把 `release.json` 和 APK 复制过去。**不需要重建镜像，也不需要重启容器** |
| 桌面一体包 | `<数据目录>\mobile` | 服务端默认读 `OA_DATA_DIR/mobile` |
| 源码运行 | `data/mobile` | 或设置 `MOBILE_RELEASE_DIR` |

APK 不会打进 Docker 镜像：`.dockerignore` 排除了 `data/` 和 `mobile/*`，`/data/mobile` 也不是镜像里的匿名卷。

发布后检查：

```powershell
curl.exe -s https://oa.example.com/api/mobile/version      # available: true，版本号正确
# 手机浏览器打开 https://oa.example.com/download/android，扫码页显示新版本
```

下载页和二维码里的地址按访问者的请求地址生成（经反代时取 `X-Forwarded-Host` / `X-Forwarded-Proto`）。从 `127.0.0.1` / `localhost` 打开时页面会提示改用局域网 IP 或域名，否则手机扫码打不开。

## 6. 测试升级流程用的旧版本包

```powershell
cd mobile\android
.\gradlew.bat assembleRelease '-PoaVersionName=0.0.9'   # PowerShell 里 -P 参数必须加引号，否则 0.0.9 会被拆开
```

`-PoaVersionName` 只用于构建测试包，正式发版不要用。测试包同样用正式密钥签名，可以与正式包互相覆盖升级。

可以同时加 `'-PoaVersionCode=<N>'` 核对 versionCode：它不会单独改 versionCode，与按 §2 规则算出的值不一致时构建直接失败。

## 7. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `未找到 release 签名配置` | 没有 `keystore.properties`，按 §3 放好文件或设置 `OA_KEYSTORE_PROPERTIES` |
| `SDK location not found` | 没设 `ANDROID_HOME` |
| `apksigner 校验失败：JAVA_HOME is not set` | 发布脚本调用 `apksigner` 也需要 `JAVA_HOME` |
| `版本号必须是 X.Y.Z ...：0` | PowerShell 把 `-PoaVersionName=0.0.9` 拆开了，参数加单引号 |
| 手机安装时提示「与已安装的应用签名不一致」 / `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 手机上装的是 debug 包（调试证书）。debug 包与 release 包不能互相覆盖，先卸载 |
| 用户反馈的崩溃堆栈是混淆后的类名 | 用 `%USERPROFILE%\.oa-mobile\mappings\` 里对应版本的映射文件，配合 Android SDK 的 `retrace` 还原 |
