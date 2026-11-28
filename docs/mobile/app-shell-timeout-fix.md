# App 壳层：旧服务器不响应时的白屏兜底 + 启动页省略 http://（#44）

> 分支 `mimoxh/oa-webhook-composer-bar`。根因分析见诊断报告：App 冷启动直接加载保存的 `server_url`，壳层没有主框架加载超时。旧服务器静默丢包时白屏约 138–141 秒才报 `ERR_CONNECTION_TIMED_OUT`；服务器接受 TCP 却不响应时一直白屏。白屏期间页面上没有「切换服务器」入口。另外启动页的 `<input type="url">` 会被浏览器原生校验拦下 `192.168.124.220:3001` 这种不带协议的地址（「Please enter a URL.」），点「连接」没有反应。
>
> 改的是原生层和包内页面，**需要发新 APK**（0.1.6）。

## 结论

| 场景（冷启动，保存的 `server_url` 指向该服务器） | 修复前 | 修复后（模拟器实测） |
| --- | --- | --- |
| 接受 TCP 但不响应 | 一直白屏（60 秒后仍空白） | 0.6 秒后显示「正在连接 OA 服务器…」和「切换服务器」按钮；**13.5 秒**（从 `am start` 算起，看门狗 12 秒 + 进程启动约 1.4 秒）后显示超时错误页 |
| SYN 被静默丢弃（`iptables DROP`） | 白屏约 138–141 秒 | 同上，**13.5 秒**后显示超时错误页 |
| 连接被拒（RST） | 约 3 秒显示错误页 | 不变：3.6 秒，`net::ERR_CONNECTION_REFUSED` |
| 服务器 8 秒后才响应（慢但正常） | — | 9.4 秒显示页面，30 秒内没有误报超时 |
| 正常服务器（本机 / NAS `192.168.124.220:3001`） | — | 2.0 秒 / 2.4 秒打开（NAS 跳到 `/login`），20–25 秒内没有误报超时 |
| 启动页输入 `192.168.124.220:3001`（不带 `http://`） | 被原生校验拦下 | 通过，补成 `http://192.168.124.220:3001`，5.3 秒打开 NAS 登录页 |

## 修改

| 文件 | 改动 |
| --- | --- |
| `mobile/android/.../LoadWatchdog.java`（新增） | 主框架加载看门狗，纯 Java（定时和时钟由接口提供，可单元测试）。`arm(url)` 开始计时，12 秒内没有 `settle()` 就回调 `onTimeout`。只对远程 http/https 主文档计时，`https://localhost/...` 包内页面、`about:blank` 不计时。新的加载会作废旧计时（带代次检查，已排队的旧回调也不会生效）。`pause()` / `resume()` 用于切后台：回前台后按剩余时间继续，最少再等 2 秒 |
| `MainActivity.java` | Bridge 在 `super.onCreate()` 里已经对保存的服务器调用了 `loadUrl`，之后立即 `watchLoad(bridge.getAppUrl())`。错误页「重试」和通知深链（`onNewIntent`）都改走 `loadRemote()`，统一计时。超时时依次执行：记录 `kind=timeout`、`webView.stopLoading()`、加载包内 `error.html`。`stopLoading` 之后 WebView 可能再报 `ERR_ABORTED`，这种错误会被忽略，不会覆盖超时原因，也不会重复跳转。<br>白屏等待期间，如果加载超过 0.6 秒，会显示原生遮罩（转圈、「正在连接 OA 服务器…」、服务器地址、「切换服务器」按钮），首帧出现后隐藏。已经显示着远程页面时（例如点通知深链）不显示遮罩，因为 WebView 会保留旧页面。<br>`onStop` 暂停计时，`onStart` 继续计时，`onDestroy` 取消计时（切换服务器时 `recreate` 也会经过这里）。主框架变成下载时（`DownloadListener`）停止计时 |
| `OAWebViewClient.java` | `onPageCommitVisible` / `onPageFinished` 通知 `onMainFrameSettled(url)`，停止计时并隐藏遮罩。WebView 自己报的主框架错误同样会停止计时 |
| `ServerStore.java` | `normalize` 先判断有没有协议，再去掉结尾斜杠，否则只输入 `http://` 会被当成主机名 `http`。同时拒绝端口超过 65535 的地址和带用户名密码的地址 |
| `OAShellPlugin.java` | 地址无效时的提示改成「地址格式不正确，例如 192.168.1.20:3000 或 https://oa.example.com」 |
| `mobile/www/error.html` | 新增 `timeout` 类型：标题「连接 OA 服务器超时」，说明「服务器长时间没有响应，可能已关机、地址已更换或网络不通（服务器 12 秒内没有响应）」，并显示当前服务器地址。点「重试」后按钮变成「正在重试…」。底部提示「服务器地址换了？点『切换服务器』重新填写」。<br>修复一个时序问题：`info()` 只对包内页面开放，以 `onPageStarted` 记下的地址为准，但页面脚本可能先于 `onPageStarted` 执行。这时 `info()` 返回 `{}`，错误页就不显示服务器地址和原因。release 包实测复现过一次。现在拿不到 `serverUrl` 时每 100ms 重试一次，最多 3 秒 |
| `mobile/www/index.html` | 输入框改为 `type="text"`，保留 `inputmode="url"`、`autocomplete="url"`、`autocapitalize="off"`、`spellcheck="false"`；表单加 `novalidate`；占位文字和说明改为「可以省略 http://」。提交时先用 `server-url.js` 规范化，并显示中文错误提示。修复一个顺带发现的问题：`render()` 每 3 秒随 `refresh()` 执行一次，用户清空输入框后，旧服务器地址会被填回来（实测清空后输入的地址被拼成 `http://10.0.2.2:3409192.168.124.220:3001`）。现在只在首次渲染时预填 |
| `mobile/www/server-url.js`（新增） | `normalizeServerUrl()`，规则与 `ServerStore.normalize` 一致：去掉首尾空格和结尾斜杠；没写协议时补 `http://`（与原有规则相同）；只接受 http/https；错误提示分为空地址、含空格、协议不支持、格式不正确 |
| `mobile/android/app/build.gradle` | 支持 `-PoaVersionCode`，只用来核对。与 versionName 按规则算出的值不一致时直接报错 |
| 测试 | `LoadWatchdogTest`（8 个）：超时触发、提前 settle 取消、新导航重新计时、包内页面不计时、切后台暂停并按剩余时间继续、剩余时间不足时的 2 秒宽限、空状态 pause/resume、已排队的旧回调不生效。`ServerStoreNormalizeTest`（3 个）：补协议、保留协议、拒绝无效输入。`tests/mobile/app-shell.test.ts`（8 个）：在 `vm` 沙箱里执行 `server-url.js` 验证规范化和错误提示；对启动页输入框和表单属性、错误页超时文案，以及看门狗的接入点（冷启动、重试、深链、首帧、下载、生命周期）做结构断言 |

不会误杀的情况：

- 只有 `onPageCommitVisible` / `onPageFinished` 之前的阶段计时。页面出首帧以后，慢的子资源、页内路由跳转（Next.js 客户端路由不触发主框架导航）、`pushState` 都不受影响。
- 由页面发起的主框架导航（点链接、`location.href`）不计时。WebView 在新页面出首帧前保留旧页面，不会白屏。下载走 `DownloadListener`，同样不受影响。
- 慢服务器只要 12 秒内开始返回页面就正常打开（实测 8 秒响应的服务器正常显示）。

## 模拟器实测

环境：独立模拟器 `nbase_api36`（Android 16，WebView 133.0.6943.137，`-read-only` 启动，测完关闭）、本工作区构建的 debug 包（A–K），以及同一份代码的 0.1.6 release 包（R8 混淆后复测 A、E、G）。测试服务器在本机，模拟器通过 `10.0.2.2` 访问：3409 端口接受连接但永不响应；3410 端口 8 秒后响应；3411 端口正常响应；3412 端口在模拟器内用 `iptables -I OUTPUT ... -j DROP` 丢弃 SYN；3999 端口没有监听。每个场景都先 `force-stop`，再用 root 写入 `shared_prefs/oa_shell.xml` 的 `server_url`，然后冷启动。驱动脚本用 CDP 每 250ms 读一次 `location.href`，用 uiautomator 找原生控件。脚本放在 `.tmp/shell-test/`，不入库。

| # | 场景 | 结果 |
| --- | --- | --- |
| A | 接受 TCP 不响应，冷启动 | 3 秒时显示遮罩（「正在连接 OA 服务器…」「切换服务器」）；13.47 秒进入错误页，标题「连接 OA 服务器超时」，显示服务器 `http://10.0.2.2:3409` |
| B | SYN 静默丢弃，冷启动 | 3 秒时显示遮罩；13.51 秒进入超时错误页 |
| C | 连接被拒 | 3.56 秒进入错误页，原因 `net::ERR_CONNECTION_REFUSED`（与修复前相同） |
| D | 8 秒后才响应 | 9.38 秒显示页面，30 秒内没有进入错误页 |
| E | 正常服务器 / NAS | 1.98 秒 / 2.44 秒打开，NAS 跳到 `/login`，20 / 25 秒内没有进入错误页 |
| F | 超时错误页点「重试」 | 重试期间显示遮罩，14.7 秒后再次进入超时错误页（包含 uiautomator 找按钮的约 1.5 秒） |
| G | 错误页点「切换服务器」，输入 `192.168.124.220:3001`，点「连接」 | 进入启动页。输入框 `type=text`，`validity.valid = true`，没有原生拦截。5.3 秒后打开 `http://192.168.124.220:3001/login`（「登录 · 协作空间」），保存的 `server_url = http://192.168.124.220:3001` |
| H | 挂起期间触发桌面长按快捷方式 `OPEN_LAUNCHER` | 立即进入启动页，14 秒后仍在启动页（旧计时已随 `recreate` 取消） |
| I | 通知深链：冷启动 `oa_path=/messages/c1`，再在运行中 `oa_path=/messages/c2` | 都打开对应路径，18 秒内没有误报超时 |
| J | 挂起时第 5 秒按 HOME，后台停留 5 秒后回到前台 | 后台期间仍是 `about:blank`（计时已暂停）。回到前台 6.8 秒后进入超时错误页，从启动算起 17.9 秒 ≈ 12 秒 + 后台时长 |
| K | 挂起期间直接点遮罩上的「切换服务器」 | 进入启动页，之后没有再跳到错误页 |

release 包（0.1.6 / 106，R8 混淆，同一份代码）复测，只用 uiautomator 轮询（每次 dump 约 1–1.5 秒，所以时间偏大），连续两轮：

| # | 场景 | 结果（两轮） |
| --- | --- | --- |
| A | 接受 TCP 不响应，冷启动 | 出现遮罩；15.1 / 15.0 秒检测到超时错误页，页面上显示服务器 `http://10.0.2.2:3409` |
| E | NAS 冷启动 | 6.8 / 6.9 秒检测到登录页，20 秒时没有错误页 |
| G | 超时页 →「切换服务器」→ 全选删除后输入 `192.168.124.220:3001` →「连接」 | 输入框内容 `192.168.124.220:3001`，3.8 / 3.7 秒检测到 NAS 登录页，保存的 `server_url = http://192.168.124.220:3001` |

补充：后台停留 20 秒时，Android 16 会在约 10 秒后自己断开后台应用的连接，WebView 报 `net::ERR_CONNECTION_ABORTED`，显示普通的「无法连接」错误页（不是超时）。这是系统行为，修复前也一样。

截图：`docs/mobile/app-shell-timeout-screenshots/`

- `loading-overlay.png`：白屏等待期间的遮罩
- `timeout-error-page.png`：超时错误页
- `launcher-without-http.png`：启动页输入不带 `http://` 的地址

## 自动检查

- `gradlew testDebugUnitTest`：21 个测试全部通过（`LoadWatchdogTest` 8、`ServerStoreNormalizeTest` 3、`PushSessionTest` 9、`ExampleUnitTest` 1）。
- `pnpm typecheck`、`pnpm lint`：通过。
- `pnpm test`：322 个测试全部通过（含新增的 `tests/mobile/app-shell.test.ts` 8 个）。

## 遗留

- 计时从壳层发起加载时开始。由页面自己发起的主框架导航不计时（旧页面还在，不会白屏）；如果这时服务器挂了，用户仍可以在「我的」里切换服务器。
- 超时时间固定 12 秒，没有做成设置项。网络很慢（12 秒内连首字节都拿不到）时会先显示超时页，点「重试」可以再等 12 秒。
- 遮罩上的「切换服务器」按钮用的是系统默认按钮样式。
