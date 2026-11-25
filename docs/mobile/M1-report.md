# OA 手机端 M1 报告：移动布局、登录与 IM（Android / Capacitor）

> 对应 `docs/mobile/mobile-plan.md` §M1。验证日期：2026-11-25。上一阶段见 `M0-validation-report.md`。
> 结论：M1 范围内的功能已实现，**在模拟器上逐项通过**；没有真机，真机验收仍待做（见 §6）。桌面浏览器界面除消息气泡不再误折行（§3 第 2 条，负责人决定一起修）外无变化；`pnpm typecheck`、`pnpm lint`、`pnpm test`（157 项）全部通过。

## 0. 结论速览

| 项 | 结果 |
| --- | --- |
| 负责人 6 项决定 | 全部落实（§1） |
| M1 验收（单聊 / 建群 / @Bot / 图片文件 / 实时与已读 / 后台 5 分钟补齐） | **模拟器通过**，真机未测 |
| 局域网 HTTP（M0 的阻塞问题） | **已解决**：App 用 `http://10.0.2.2:3320`、桌面浏览器用 `http://192.168.124.39:3320`（均为非安全上下文，`crypto.randomUUID` 与 `navigator.clipboard` 都不存在）收发消息、复制都正常 |
| 桌面端回归 | 1440×900 前后截图布局一致；移动端样式全部限定在 `md` 以下或 `pointer: coarse`。之后按负责人决定修了电脑端气泡误折行，消息区只有气泡换行变化（§3 第 2 条） |
| 手机消息页列表 → 会话 → 返回 | **模拟器与手机浏览器通过**（§2.4），含通知进入、滚动位置保留 |
| 顺手修掉的既有问题 | 3 个（§3），桌面端同样受益 |
| debug APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk`（本阶段重建过一次，包含原生剪贴板与去掉精确闹钟权限） |

## 1. 负责人决定的落实情况

| # | 决定 | 做法 | 验证 |
| --- | --- | --- | --- |
| 1 | 支持局域网 HTTP | 新增 `src/lib/client-id.ts`（`randomId()`：有 `crypto.randomUUID` 用它，否则用 `crypto.getRandomValues` 拼 UUID v4，最后才退回 `Math.random`），替换 IM、文档、白板、多维表格、任务等处的 `crypto.randomUUID()`；新增 `src/lib/clipboard.ts`（App 内走原生 `OAShell.copyText`，浏览器安全上下文用 `navigator.clipboard`，否则 `execCommand("copy")`，失败时提示原因），替换所有复制入口。原生 `OAShellPlugin.copyText` 用 `ClipboardManager` | App 经 HTTP 发消息成功、复制后粘贴到输入框内容一致；桌面浏览器经局域网 HTTP 发消息、复制成功（§2.2）；`tests/lib/client-id.test.ts` |
| 2 | release 只信任系统 CA，补 HTTPS 部署文档 | release 配置本来就是只信任系统 CA，未改；新增 `docs/mobile/deployment.md`（为什么要 HTTPS、各访问方式能力对照、Let's Encrypt / 反向代理示例、`SESSION_COOKIE_SECURE`、内网试用的限制），`docs/NAS_DEPLOY.md` §4 加了链接；「我的」页在非安全连接下显示 HTTP 提示 | 文档审阅；`42-me-http.png` |
| 3 | 去掉精确闹钟权限 | `AndroidManifest.xml` 用 `tools:node="remove"` 移除插件带进来的 `SCHEDULE_EXACT_ALARM`（App 本身只发即时通知，`isExactNotification:false`） | 合并后的 debug manifest 中已无该权限 |
| 4 | `mobile/` 纳入 pnpm workspace | `pnpm-workspace.yaml` 加入 `mobile`；删除 `mobile/package-lock.json`；根目录脚本 `pnpm mobile:sync`、`pnpm mobile:build:debug`；Dockerfile 复制 `mobile/package.json` 以便 `pnpm install --frozen-lockfile` 通过，`.dockerignore` 只放行该文件；`capacitor.settings.gradle` 由 `cap sync` 重新生成为 pnpm 路径；`mobile/README.md` 已更新 | `pnpm install` 正常；`pnpm mobile:build:debug` 产出 APK |
| 5 | 移动端会话 30 天滑动续期 | 见 §1.1 | `tests/auth/session-renewal.test.ts`；App Cookie 实测有效期 30 天、杀进程重启后保持登录 |
| 6 | 服务升级后旧页面调 Server Action 报“找不到” → 自动刷新 | 新增 `src/lib/stale-action.ts`：识别 `UnrecognizedActionError` / “Failed to find Server Action”；App 内提示“服务已更新，正在刷新页面…”后自动刷新，30 秒内不重复刷新（防止服务端滚动升级时死循环），之后改为带“刷新”按钮的提示；浏览器里只提示不自动刷新（避免丢失正在编辑的内容）。`useAction` 与 IM store 的 Action 调用都接入，另有全局 `unhandledrejection` 兜底（`AppRuntime` 安装） | 生产包上实测：把 Action ID 换成不存在的值后发消息 → 服务端日志 `Failed to find Server Action`，App 提示并自动刷新；30 秒内再次触发只提示、不刷新 |
| 7 | 只用模拟器 | 全部验证在模拟器完成 | — |

### 1.1 会话策略（决定 5 的细节）

- 只对手机 App 生效：登录时根据 UA 中的 `OAMobile/` 把 `client: "mobile"` 写进签名 Token，之后续期只看 Token 里的标记，不看请求头，改 UA 不能把网页会话变成 30 天会话。
- 有效期 30 天；`src/proxy.ts` 对 GET/HEAD 请求在签发超过 1 天后换发新 Token（每天最多一次，不对 POST 等写请求续期）。
- 从首次登录起最长 180 天，到期必须重新登录（避免一次登录永久有效）。
- 网页和桌面端保持原来的 7 天固定有效期，不续期。
- 常量在 `src/lib/auth/token.ts`：`MOBILE_SESSION_TTL_SECONDS`、`SESSION_RENEW_AFTER_SECONDS`、`MOBILE_SESSION_MAX_AGE_SECONDS`。

## 2. 验证

### 2.1 环境

| 项 | 说明 |
| --- | --- |
| 设备 | 模拟器 `oa_m0_api36`：Android 16（API 36），Pixel 7 外形，1080×2400，WebView 133 |
| 服务端 A：`pnpm dev` 隔离实例 | web :3310（`NEXT_DIST_DIR=.next-m0`、`prisma/m0dev.db`、Cookie `oa_session_m0`）、collab :1244、realtime :1245，`adb reverse` 后 App 访问 `http://localhost:3310` |
| 服务端 B：生产包 | `node scripts/docker/bundle-server.mjs --out .tmp/m1-standalone` 产出的 standalone 包（与 Dockerfile 同一打包步骤），`oa-standalone.mjs` 单端口 :3320，数据目录 `.tmp/m1-data`，`SESSION_COOKIE_SECURE=false`。App 访问 `http://10.0.2.2:3320`，桌面浏览器访问 `http://192.168.124.39:3320`（本机局域网地址）。Docker Desktop 本机仍无法启动，所以没在容器里跑 |
| 对端 | 本机无头 Edge 以 `sales@demo.com` 等账号登录发消息（`mobile/tools/peer.mjs`） |
| Webhook 机器人 | 在隔离库里建了“Echo机器人”（加入全员群，`mention_only`），本机回声服务收到出站请求后先发 typing，再调用 `/api/im/webhooks/{id}/reply` 回复 |

> `next dev` 会拦截非 localhost 来源加载开发资源（`allowedDevOrigins`），所以局域网 HTTP 只能对生产包验证，开发实例只用 localhost。

### 2.2 M1 验收项

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 登录；杀进程后保持登录 | 通过 | `am force-stop` 后重新打开直接进入 `/messages`；Cookie 30 天 |
| 发起单聊 | 通过 | 生产包上 “+ → 发起单聊 → 赵磊” 新建会话，双向收发正常 |
| 建群 | 通过 | “+ → 发起群聊 → 李娜、赵磊” 建群，双向收发正常 |
| 单聊 / 群聊实时收发 | 通过 | App 发出到气泡出现约 0.3–0.5 s；对端发出后 App 立即显示 |
| 群内 @Bot 触发 Webhook 并收到回复 | 通过 | @ 选择器里选中 Echo机器人 → 发送 → 约 3.9 s 后收到 “Echo: …”（含回声服务故意等待的 0.8 s）。`group-bot-reply.png` |
| 发图片、文件；对方收到；下载 | 通过 | 图片 2.8 s 上传并显示；文件正常；看图页“下载原图”和长按菜单“下载”都由系统下载器保存到 `Download/OA/`，大小与原文件一致 |
| 已读 | 通过 | 对方打开会话后，我方消息由“未读”变“已读”；对方直接回复时也会立即变“已读”（§3 第 3 条修复后） |
| 后台 5 分钟补齐 | 通过 | App 切到后台 278 s，期间对方发 2 条；后台连接常驻服务在运行，系统通知收到；回到前台后两条都在，没有重复、没有缺失，未读数 2 |
| 局域网 HTTP：App | 通过（M0 时失败） | `http://10.0.2.2:3320`，`isSecureContext=false`：登录、发消息、收消息、复制都正常。`app-http-chat.png` |
| 局域网 HTTP：桌面浏览器 | 通过 | `http://192.168.124.39:3320`，`isSecureContext=false`，`crypto.randomUUID`、`navigator.clipboard` 都不存在：发消息、实时收消息、复制都正常 |
| 手机消息页：列表 → 点击进入会话 → 返回（含通知进入） | 通过 | 见 §2.4 |
| 桌面浏览器回归 | 通过 | 1440×900 下 8 个页面（首页、消息、单聊、群聊、通讯录、收件箱、云文档、设置）改动前后截图（`.tmp/m1-shots/desktop-before` / `desktop-after`）逐像素对比，只有时间戳、在线状态等少量像素不同。最后一轮修改后又截了 `desktop-final`：布局一致，差异全部来自测试期间新增的数据（新消息、未读数、新建的测试机器人） |
| Tauri 桌面端回归 | 未单独运行 | 改动只有顶栏“复制访问地址”换成统一的复制函数；桌面窗口宽度都在 `md` 以上，移动端样式不生效 |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 通过 | 157 项测试全部通过 |

### 2.3 移动端交互

| 项 | 结果 |
| --- | --- |
| 底部 Tab（消息 / 通讯录 / 工作 / 我的）与未读角标 | 通过，聊天页内隐藏 Tab 栏 |
| 安全区 | 通过（状态栏、手势条区域不被遮挡） |
| Android 返回键 | 通过：先收起键盘 → 关闭弹层 / 抽屉 / 看图 → 页面后退；在 Tab 首页按返回把 App 退到后台（不退出、不回登录页） |
| 软键盘 | 通过：输入框紧贴键盘，最后一条消息仍可见；键盘回车显示“发送”，用输入法回车发送成功 |
| @ 提及（含 Bot）、表情 | 通过 |
| 话题、搜索 | 通过，手机上为全屏抽屉，返回键关闭后留在当前会话；话题内回复成功 |
| 长按消息 | 通过：快捷表情 + 回复 / 话题 / 复制 / 下载 / 编辑 / 撤回；长按不再触发系统选字 |
| 长按会话 | 通过：置顶 / 取消置顶 / 免打扰 / 从列表移除 |
| 看图 | 通过：双指缩放（实测放大到 4.2 倍后不误关）、放大后拖动、双击放大 / 还原、单击关闭、返回键关闭、下载原图 |
| 通讯录 / 工作台 / 收件箱入口 / 我的 | 通过 |

### 2.4 手机消息页：列表 → 会话 → 返回（负责人追加验收）

要求：手机尺寸（`md` 以下，App 与手机浏览器一致）`/messages` 只显示全屏会话列表；点会话通过路由进入 `/messages/[id]` 全屏聊天，不再同时显示列表；顶部返回按钮和 Android 返回键都回到列表并保留滚动位置；从通知进入时直接打开会话，返回时回到列表；桌面双栏不变。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| `/messages` 只显示全屏列表 | 通过 | App 与手机浏览器（412×915）列表宽 412 = 屏宽，聊天区不渲染 |
| 点会话 → 路由跳转到全屏聊天 | 通过 | 点击后地址变为 `/messages/<id>`，列表宽度 0（隐藏），聊天页顶部有返回按钮，底部 Tab 栏隐藏 |
| 顶部返回按钮 → 列表，滚动位置保留 | 通过 | 列表先滚到 230 px（App）/ 155 px（浏览器），返回后仍为 230 / 155；刚看过的会话未读角标已清除 |
| Android 返回键 → 列表，滚动位置保留 | 通过 | 同上，返回后 `scrollTop` 不变；列表页再按返回键 App 退到后台 |
| 手机浏览器自带后退 | 通过 | `history.back()` 回到列表，滚动位置不变 |
| 点系统通知进入（App 已在运行，停在“工作台”后切到后台） | 通过 | 下拉通知栏点“刘洋”的消息通知 → 直接打开该会话（列表隐藏），新消息可见；按返回键或点顶部返回都回到**会话列表**，不是之前的“工作台” |
| 冷启动从通知进入（`am force-stop` 后用与通知相同的 Intent 启动） | 通过 | 直接打开会话；返回键回到列表；再按返回键 App 退到后台 |
| 直接打开会话链接（手机浏览器新开页面） | 通过 | 点顶部返回回到 `/messages` 列表 |
| 桌面 1440×900 | 通过 | `/messages` 与 `/messages/<id>` 仍为左侧 248 px 列表 + 右侧聊天，聊天页无返回按钮 |

实现要点：

- 列表与聊天本来就由 `messages-shell.tsx` 按路由段切换（列表在 `layout` 里常驻，进入会话时 `max-md:hidden`），所以从会话返回时列表不重新挂载。WebView 133 隐藏再显示时本身会保留滚动位置；另在 `MessagesShell` 里记录列表可见时的 `scrollTop`，重新显示时恢复，防止其他浏览器在 `display:none` 后把滚动位置归零。
- **修复：从通知进入后返回会回到通知前的页面。** 原来判断“能否后退”用 `window.history.length`，但原生层收到通知是 `loadUrl` 新开文档，历史里还留着通知之前的页面（如“工作台”）和 App 启动页，返回会退回那里。新增 `src/components/mobile/nav-stack.ts`，只记录本文档内的客户端路由：有站内上一页才后退，否则替换为所属一级页面（会话 → `/messages`，其他 → `/work`）。聊天页顶部返回、二级页面返回按钮（`MobileBack`）、Android 返回键共用这一逻辑。

截图（模拟器，`docs/mobile/m1-screenshots/`）：`nav-1-list`（列表，已滚动）→ `nav-2-chat`（点击进入会话）→ `nav-3-back-list`（返回后列表，滚动位置相同）；`nav-4-notification`（通知栏）→ `nav-5-from-notification`（点通知直接进入会话）→ `nav-6-notification-back`（返回到列表）；`nav-desktop`（桌面 1440×900 双栏不变）。通知相关截图来自开发实例，左下角圆形按钮是 Next.js 开发指示器，生产包没有。
## 3. 验证中发现并修复的问题

1. **直接打开会话页时 @ 列表为空**（既有问题，桌面同样存在）：`initIm()` 首次初始化会清空 store，而子组件的 effect 先于它执行，已加载的群成员被清掉，@ 选择器只剩“所有人”。从通知点进会话、刷新会话页都会遇到。修复：首次初始化不清空，只在切换用户时清空（`src/components/im/store.ts`）。
2. **短消息也折行**（如 “@Echo” 折成 “@E / cho”，手机和电脑都有）：气泡上的 `max-w-[min(560px,75%)]` 参照的是外层列宽，而列宽本身由内容决定，百分比上限会循环缩小，短文本也被折行。修复：百分比限宽移到宽度确定的消息行容器上，气泡只保留 560 px 上限并 `max-w-full`（`src/components/im/message-item.tsx`，正式消息和发送中 / 失败的气泡都改了）。
   - 手机（`md` 以下）：行容器限宽 88%（含头像），气泡 `max-w-full`。
   - 电脑（`md` 及以上，负责人决定一起修）：行容器限宽 `calc(75% + 2.5rem)`（75% 给气泡，2.5rem 是头像列），气泡最宽 560 px；话题面板里的气泡仍是原来的 270 px 上限（话题面板本来就不受影响）。
   - 结果（DOM 实测）：1440×900 下单聊、群聊里没有一条短文本折行；30 字左右的消息一行显示（474 px）；长消息在 560 px 处换行（1024×768 窗口下按 75% 在 510 px 处换行）。图片（最宽 320 px）、文件卡片（280 px）、业务卡片（320 px）、链接预览、引用回复都在气泡内正常显示，引用回复那一行也不再被压窄。
   - 回归（1440×900，改动前后同一数据截图、逐像素对比）：`消息` 列表页、审批助手卡片会话、话题面板与改动前一致（只有左侧导航栏头像处有 7–12 个零散采样点的抗锯齿差异）；单聊、群聊只在消息区域（标题栏以下、输入框以上）有差异，全部来自气泡变宽、行数减少后消息上移；会话列表、标题栏、输入框、导航栏无变化。手机 412×915 的单聊、群聊前后截图逐像素完全相同。
   - 截图：`docs/mobile/m1-screenshots/desktop-bubble/` 下 `before-*.png` / `after-*.png`（`messages`、`dm`、`group`、`thread`、`card`），以及长消息换行 `after-group-long.png`。
3. **对方回复后我方消息仍显示“未读”**（既有问题，桌面同样存在）：服务端发消息时会顺带推进发送者的 `lastReadSeq`，但不发 `read` 事件，客户端要到刷新才更新。修复：客户端收到对方的文字 / 图片 / 文件消息时，同步把对方已读位置推进到该消息（卡片、系统消息的已读归属不同，跳过）。
4. **从通知进入会话后返回，回到的是通知前的页面而不是会话列表**：见 §2.4。
5. 本阶段新组件的问题（已修）：看图双指缩放后手指先后抬起会被当成单击而关闭；长按弹出面板时手指仍按着，系统会在面板上选字；“我的”页对 `http://localhost`（安全上下文）也显示 HTTP 提示。

## 4. 主要改动

- 外壳：`src/app/layout.tsx`（viewport：`viewportFit: cover`、`interactiveWidget: resizes-content`；`AppRuntime`）、`src/app/globals.css`（安全区与 Tab 栏高度变量，`h-app` 在手机上扣除 Tab 栏）、`src/components/shell/app-rail.tsx`（`md` 以下隐藏，渲染底部 Tab）、`context-panel.tsx`、`src/components/ui/page.tsx`（非 Tab 页顶栏返回按钮）。
- 新增 `src/components/mobile/*`：底部 Tab、返回键处理（`app-runtime.tsx`、`back-stack.ts`、站内路由记录 `nav-stack.ts`）、长按、操作面板、看图、返回按钮、`useIsMobileLayout`。
- IM：`messages-shell.tsx`（列表 / 聊天全屏切换）、`chat-view.tsx`、`composer.tsx`、`message-list.tsx`、`message-item.tsx`、`conversation-list.tsx`、`drawer.ts`（话题 / 搜索 / 成员抽屉在手机上全屏）、`store.ts`。
- 页面：`/me`（新增）、通讯录、工作台。
- 平台：`src/lib/client-id.ts`、`clipboard.ts`、`stale-action.ts`、`mobile-bridge.ts`、`mobile-ua.ts`、`mobile.ts`；`src/lib/auth/token.ts`、`session.ts`、`src/proxy.ts`。
- 原生 / 打包：`OAShellPlugin.copyText`、`AndroidManifest.xml`、`mobile/www/index.html`（HTTP 说明文字）、pnpm workspace 相关文件、Dockerfile、`.dockerignore`。
- 工具：`mobile/tools/shots.mjs`（按视口批量截图，用于桌面回归和窄屏对比）。

## 5. 截图

`docs/mobile/m1-screenshots/`（模拟器）：`messages-list`、`group-bubbles`、`group-bot-reply`、`dm-read-receipt`、`keyboard`、`message-longpress`、`conversation-longpress`、`image-viewer`、`thread-drawer`、`contacts`、`work`、`me-http`、`app-http-chat`，电脑端气泡前后对比 `desktop-bubble/`（§3 第 2 条），以及 §2.4 的 `nav-1-list` … `nav-6-notification-back`、`nav-desktop`。全部过程截图（含桌面前后对比、窄屏对比、局域网 HTTP 桌面截图）在本机 `.tmp/m1-shots/`，未入库。

## 6. 遗留与建议

- **真机未测**：中文输入法联想 / 语音输入与 Tiptap 的组合输入、国产 ROM 后台保活、低端机长列表性能都需要真机确认（M0 设备清单 `M0-device-checklist.md` 可复用）。
- **自动刷新会丢掉当次发送的内容**：服务升级后第一次发送会触发“找不到 Action”并自动刷新，这条消息不会发出，需要用户重发。后续可以在刷新前把内容存成草稿。
- Docker 容器内未实测（本机 Docker Desktop 无法启动），用的是同一打包步骤产出的 standalone 包。
- Tauri 桌面端未实际启动回归。
- 开发模式下局域网访问需要把地址加入 `next.config.ts` 的 `allowedDevOrigins`，这只影响开发调试，本次未改。

## 7. 复现

```powershell
# 依赖与 APK（需 JDK 21、Android SDK）
pnpm install
pnpm mobile:build:debug

# 生产包（与 Dockerfile 同一步骤）
$env:DATABASE_URL='file:./prisma/build.db'; node scripts/docker/bundle-server.mjs --out .tmp/m1-standalone
$env:OA_PORT='3320'; $env:OA_BIND='0.0.0.0'; $env:OA_DATA_DIR="$PWD/.tmp/m1-data"; $env:AUTH_SECRET='<32+ 字符>'
$env:NODE_ENV='production'; $env:SESSION_COOKIE_SECURE='false'
node .tmp/m1-standalone/oa-standalone.mjs

# 模拟对端发消息
node mobile/tools/peer.mjs http://127.0.0.1:3320 sales@demo.com <会话 ID> "测试消息"
# 桌面 / 窄屏截图
node mobile/tools/shots.mjs http://127.0.0.1:3320 admin@demo.com .tmp/shots 412x915 /messages /contacts /work /me
```
