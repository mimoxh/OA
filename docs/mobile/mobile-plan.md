# OA 手机端（Android）技术调研与分阶段开发方案

> 状态：调研结论 / 待负责人拍板。本文只给方案，不包含业务代码改动。
> 调研基线：`develop` 合并 `57d003d`（单容器 NAS 部署）之后的代码。

## 0. 结论速览

- **推荐形态：Capacitor 套壳 App（远程加载 NAS 上的 OA Web）+ 少量原生插件（推送、后台保活、通知、下载）**，同时把现有 Web 改造成响应式移动布局。
- **理由**：现有 Web 的写操作几乎全部走 Next Server Actions（仅 IM 一个模块就有 20 多个），并依赖 httpOnly Cookie 会话。原生 App（RN/Flutter）要先补齐整套 REST API 和 Bearer 鉴权，还要重写 IM 富文本渲染与白板，工作量是套壳方案的 3–5 倍。纯 PWA 又拿不到后台推送（局域网 HTTP 下连 Service Worker 都不可用）。套壳可以直接复用 Web 的 90% 以上，推送和保活交给原生层，以后加 iOS 只需新增 iOS 工程和 APNs 推送。
- **第一期工作量估算**：一名熟悉本仓库的全栈开发约 **35–55 人日**（不含厂商推送通道申请的等待时间）。
- **分期**：M0 技术验证 → M1 移动布局 + 登录 + IM → M2 后台推送 → M3 白板 + 审批 + 文档只读 → M4 签名发布与升级。

---

## 1. 现状盘点（代码实测）

### 1.1 前端技术栈与构建

| 项 | 现状 | 对手机端的影响 |
| --- | --- | --- |
| 框架 | Next.js 16 App Router（Turbopack）、React 19、Tailwind v4、radix-ui、Tiptap 3 | 页面是服务端渲染 + Server Actions，**不是静态 SPA**，无法打包进 App 离线运行，只能远程加载 |
| 数据写入 | 每个模块一个 `actions.ts`（`"use server"` + `runAction`）；IM 部分读接口在 `src/app/api/im/*` | 同源 WebView 内可直接用；原生 App 需重新提供 REST |
| 构建 | `pnpm build`；NAS/桌面用 `NEXT_OUTPUT=standalone`，`scripts/docker/bundle-server.mjs`、`scripts/desktop/bundle-server.mjs` 打包 | 手机端不需要打包服务端 |
| 移动适配 | 仅约 46 个文件用了少量 `sm:/md:/lg:` 栅格断点；外壳是固定左侧导航 `AppRail` + 248px `ContextPanel`（`src/components/shell/context-panel.tsx`），消息页是「会话列表 + 聊天」左右双栏（`src/app/(app)/messages/layout.tsx`） | **没有手机布局**，这是第一期最大的前端工作量 |
| PWA | 已有 `src/app/manifest.ts`（`start_url: /messages`）、`public/sw.js`（仅处理通知点击，不缓存）、`src/lib/im/desktop-notify.ts` | 可在 HTTPS 下“添加到主屏”，但没有 Web Push |

### 1.2 桌面端打包方式（可借鉴）

- `desktop/`：Tauri v2（Rust）+ WebView2，NSIS 安装包。启动页 `desktop/dist/index.html` 让用户选择「本机创建工作空间」或「连接已有服务器」，然后 **WebView 直接导航到服务器 URL**（`open_workspace`，`desktop/src-tauri/src/lib.rs`）。
- 页面通过 `window.__TAURI__` 调桥接命令（`src/lib/desktop-bridge.ts`：未读角标、原生通知、窗口控制），服务端通过 UA 标记 `OADesktop/`（`src/lib/desktop.ts`）渲染桌面顶栏。
- 局域网 HTTP 地址会通过 Chromium 参数被当成安全上下文，使摄像头、麦克风、剪贴板可用。**Android WebView 没有对应参数**，这一点手机端不能照搬（见 §6 风险）。
- 手机端沿用同一模式：**本地启动页选服务器 → 远程加载 → JS 桥接 + UA 标记**，新增 `src/lib/mobile-bridge.ts` 与 UA 标记 `OAMobile/`。

### 1.3 后端接口与鉴权

- 会话：`src/lib/auth/session.ts` 签发 HS256 JWT，写入 httpOnly Cookie `oa_session`，有效期 **7 天**，`SameSite=Lax`，`Secure` 由 `SESSION_COOKIE_SECURE` 控制（局域网 HTTP 需设为 `false`）。
- 路由守卫：`src/proxy.ts`，未登录访问 `/api/*` 返回 401，页面跳转 `/login?next=`。
- 作用域令牌：`signScopedToken`（`src/lib/auth/token.ts`），作用域 `collab` / `rt` / `rt-publish`，有效期 1 小时，经 `/api/collab-token`、`/api/realtime-token` 签发；带 scope 的令牌不能当会话用。
- Webhook 机器人：`/api/im/webhooks/*` 走 Bearer Token，出站推送 `src/lib/im/webhook-outbound.ts`（`mention_only` / `all` 两种触发方式）。@Bot 就是普通 `@提及`，手机端只要提及选择器可用即可，**后端无需改动**。

### 1.4 实时通信

- `server/realtime.ts`：`ws` 服务，`?token=`（`rt` 作用域）连接，30s 心跳，按 userId 投递事件，typing / presence / 通话信令；有 `REDIS_URL` 时支持多实例。
- 客户端 `src/components/realtime/provider.tsx`：每个标签页一条 WS，指数退避重连，`visibilitychange` / `online` 时唤醒；断线后按消息 `seq` 补拉（数据库是唯一事实源，事件只做刷新提示）。**这套机制在 App 切后台、再切回前台时可以直接复用。**
- 文档协同：`server/collab.ts`（Hocuspocus + Yjs），`/collab`。
- **离线推送：目前没有。**事件只投递给在线 socket；浏览器桌面通知只在页面活着时由前端触发（`store.ts` 的 `maybeNotifyMessage`）。
- 关键事实：审批、任务、公告等业务通知经 `notify()`（`src/lib/services/notify.ts`）以 **卡片消息写入机器人会话**（`appendMessage`）。因此“IM 新消息”这一个推送钩子就能覆盖几乎所有业务提醒。

### 1.5 白板实现

- 白板是文档（`Document.kind = "whiteboard"`）的一种，属于「文档」应用：`src/components/docs/whiteboard/*`（画布约 800 行）+ `src/lib/docs/whiteboard/*`（绘制、几何、内容校验）。
- 自研 `<canvas>` 渲染；工具有选择、平移、画笔、形状、便签、框架、箭头、文字、图片、橡皮。
- 持久化走 REST：`GET/PATCH /api/docs/whiteboards/[id]`，带 `expectedRevision` 乐观锁，上限 1 MB；**不是 Yjs 实时协同**，多人同时编辑靠冲突检测。
- 触屏现状：画布已设 `touch-none`、用 Pointer Events，**单指绘制和拖动理论上可用**；但只处理 `isPrimary` 指针，**没有双指缩放和平移**（缩放只靠 Ctrl+滚轮）；命中容差 7px、缩放手柄、工具栏都按鼠标尺寸设计；文字编辑是覆盖在画布上的 textarea，要处理软键盘。

### 1.6 NAS 部署形态与手机如何连接

- 单容器单端口（默认 `:3000`）：`/` → Next，`/collab` 与 `/rt` → WebSocket 同源转发，`/health` 探活（`server/standalone/main.ts`、`server/desktop/gateway.ts`）。
- 手机端只需要一个地址，例如 `http://192.168.1.20:3000` 或 `https://oa.example.com`，**WS 地址由服务端按请求的 Host 自动生成**（`src/lib/ws-url.ts`），不用另外配置。
- 访问方式对比：

| 方式 | 适用 | 说明 |
| --- | --- | --- |
| 局域网 HTTP（`http://192.168.x.x:3000`） | 办公室 Wi-Fi 内 | App 需允许明文流量；不是安全上下文，WebView 里无法使用摄像头/麦克风（音视频通话不可用），离开局域网就断开 |
| HTTPS 域名 + 反代（飞牛反代 / Lucky / NPM），公网 IP 或 DDNS + 端口映射 | 外网正式使用 | 推荐的长期方案；`SESSION_COOKIE_SECURE=true`，反代开启 WebSocket，超时 ≥ 300s（已写在 `docs/NAS_DEPLOY.md`） |
| 内网穿透（frp / Cloudflare Tunnel / 飞牛自带远程访问） | 无公网 IP | 需实测是否支持 WebSocket 长连接和 60 MB 上传；飞牛自带远程访问能否转发 Docker 自定义端口需实测 |
| 组网 VPN（Tailscale / ZeroTier） | 小团队、无公网 IP、不想暴露服务 | 每台手机装 VPN 客户端；对“后台推送”同样有效，但多一个常驻 App |

---

## 2. OA 业务模块盘点与第一期建议

模块来源：`src/lib/permissions.ts`（8 个可启停应用）、`src/lib/nav.ts`、`src/app/(app)/*` 路由。

| 模块 / 页面 | 路由 | 一期建议 | 理由 |
| --- | --- | --- | --- |
| 登录 / 首次安装向导 | `/login`、`/setup` | 登录：**纳入**；`/setup`：不纳入 | 登录是前提；初始化管理员在电脑上完成即可 |
| IM 消息（单聊、群聊、@Bot、话题、表态、已读、文件图片、会话内搜索、分享卡片） | `/messages`、`/api/im/*` | **纳入（核心）** | 手机端最高频；话题、搜索、已读明细以抽屉形式适配即可 |
| 通讯录 | `/contacts` | **纳入** | 发起单聊、建群需要选人 |
| 收件箱（站内通知） | `/inbox` | **纳入（轻量）** | 页面简单，是推送点击后的落点之一 |
| 个人设置（资料、退出登录、通知开关） | `/settings/profile` | **纳入** | 退出登录、通知偏好、服务器切换入口 |
| 文档 · 白板 | `/docs/[id]`（kind=whiteboard） | **纳入：查看 + 编辑** | 需求明确；需补触屏手势（§4 M3） |
| 文档 · 普通文档（Tiptap 协同） | `/docs/[id]` | **纳入：只读查看**；编辑放二期 | IM 里分享的文档链接要能打开；Tiptap 协同编辑在手机软键盘、选区、工具栏上适配成本高 |
| 文档 · 数据库视图、知识图谱、导入导出、回收站 | `/docs/*` | 不纳入 | 表格/看板/图谱是大屏交互，导入导出属于管理操作 |
| OA · 审批中心（查看、通过、驳回、评论） | `/oa/approvals`、`/oa/approvals/[id]` | **建议纳入（处理审批）**；发起审批放二期 | 手机审批价值最高；IM 审批卡片已有操作按钮（`cardAction`），详情页适配成本低。发起审批用的动态表单（`dynamic-form.tsx`）放二期 |
| OA · 公告通知 | `/oa/announcements` | **建议纳入（只读）** | 只读列表 + 详情，成本很低 |
| OA · 工作台 | `/work`、`/oa` | 二期 | 聚合页，等审批、任务、日程都适配后再做“工作”Tab |
| OA · 日程会议 | `/oa/calendar` | 二期 | 日历视图（`calendar-view.tsx`）在手机上需要重做为列表/日视图 |
| OA · 流程管理（流程设计器） | `/oa/flows` | 不做手机端 | 管理员配置工具，适合电脑 |
| PMS 项目（我的任务、项目、看板） | `/pms` | 二期（先做“我的任务”） | 看板/时间线需重做；“我的任务”列表适配简单 |
| CRM 客户（客户、商机、跟进记录） | `/crm` | 二期（先做“跟进记录”与客户详情） | 外勤销售有需求，但不是本期范围 |
| TMS 运输（运输单、车辆、司机、线路） | `/tms` | 二期（司机端：运输单状态与签收） | 司机角色天然在手机上，可能用到拍照与定位，单独规划 |
| WMS 仓储 | `/wms` | 二期以后（扫码出入库） | 价值依赖摄像头扫码，需要原生扫码插件 |
| ERP（产品、供应商、采购、销售订单） | `/erp` | 不做手机端（仅保留 Web） | 多行明细表单，手机录入体验差 |
| 财务（应收应付、收付款、凭证、科目余额） | `/finance` | 不做手机端（可二期做只读概览） | 凭证录入与核对适合电脑 |
| 系统设置（成员、部门、角色、应用启停、Webhook 机器人） | `/settings/*` | 不做手机端 | 管理员操作 |
| 全局搜索（命令面板，`/api/search`） | — | 二期 | 一期只保留会话内搜索 |
| 音视频通话 / 会议（WebRTC Mesh，`src/components/call/*`） | — | 不纳入一期 | 需要安全上下文（HTTPS）、麦克风/摄像头权限，以及来电唤醒（Android `ConnectionService` / 全屏来电通知），单独立项 |

第一期没有适配的页面在手机上仍然可以打开（桌面布局缩放显示），不会报错。第一期的“工作”入口只放审批、公告和打开 Web 完整版的链接。

---

## 3. 候选形态对比

### 3.1 对比表

| 维度 | PWA / 移动 H5 | **Capacitor 套壳（推荐）** | Tauri v2 Mobile 套壳 | 原生 Kotlin WebView 壳 | React Native / Flutter 原生 |
| --- | --- | --- | --- | --- | --- |
| 可安装 APK | 否（只能“添加到主屏”，且需 HTTPS） | 是 | 是 | 是 | 是 |
| Web 代码复用 | ~95% | ~90%（同一套页面 + 响应式改造） | ~90% | ~90% | ~20–30%（只复用类型、校验、业务规则） |
| 后端改动 | 无 | 少量（推送钩子、设备登记） | 同左 | 同左 | **大**：为 IM/审批/白板补全 REST API + Bearer 鉴权（现在写操作基本都是 Server Actions） |
| 后台推送 | **基本不可用**：Web Push 需 HTTPS + 浏览器推送服务（Chrome 依赖 FCM，国内多数手机/浏览器不可用）；局域网 HTTP 下 Service Worker 不可用 | 原生层自由选择：自建长连接 / 极光 / 个推 / 厂商通道 / FCM | 同样可做，但需自己写 Kotlin 插件，生态里没有现成推送插件 | 完全可控 | 有成熟 SDK |
| 白板触屏 | 修好手势即可 | 同 Web | 同 Web | 同 Web | 需重写画布（或嵌 WebView，回到套壳） |
| iOS 接入代价 | 低，但 iOS PWA 推送限制多 | 中低：`cap add ios` + APNs + Apple 账号 | 中：Rust iOS 工具链 | 高：iOS 壳要用 Swift 重写 | 中（框架本身跨端） |
| 第一期工作量（人日） | 15–20，但达不到“后台推送”要求 | **35–55** | 45–65 | 40–55（只有 Android） | 120–200 |
| 维护成本 | 最低 | 低：Web 一处改动全端生效，原生层很薄 | 中：Rust + Android NDK 构建链重 | 中：iOS 需另写 | 高：两套 UI、两套接口长期同步 |

### 3.2 推荐：Capacitor 套壳

1. **与现有架构契合**：桌面端已经验证了“远程加载服务器 URL + 桥接”的模式；服务端渲染、Server Actions、Cookie 会话、WS 重连补拉都能原样工作。
2. **推送能力在原生层解决**，不受 PWA 限制，可按负责人的选择接自建长连接或国内推送服务。
3. **有现成插件生态**（本地通知、推送、状态栏、键盘、文件、分享、App 生命周期），iOS 后续可直接复用同一工程。
4. **改造的副产品是移动 H5**：响应式布局做完后，手机浏览器访问也能用；iOS 正式接入之前，iPhone 用户可以先用 Safari 临时使用（没有后台推送）。

**为什么不选 Tauri v2 Mobile**：团队已有 Tauri 经验是优势，但 Android 侧没有推送插件，保活前台服务也要自写 Kotlin 插件，还要额外维护 Rust + NDK 构建链；收益不抵成本。如果 M0 验证 Capacitor 远程加载有无法解决的问题，备选是 **原生 Kotlin WebView 壳**（Android 专用，iOS 时再评估）。

**为什么不选 RN/Flutter**：要先写一整套移动 API，还要重写 Tiptap 消息渲染、卡片、白板画布，并长期维护两套 UI，与“第一期尽快可用”的目标冲突。

### 3.3 Capacitor 远程加载的关键做法（M0 需验证）

- Capacitor 官方说明 `server.url` 主要用于开发热更新，“不建议用于生产”；这条主要针对应用商店审核。本项目通过 APK 内部分发，可以接受，但要在 M0 实测。
- 通过 `allowNavigation` 跳转到的外部页面，Android 上**拿不到 Capacitor 插件**（ionic-team/capacitor#4164），所以不能用“启动页 → `location.href` 跳转”的做法。
- 做法：自定义 `MainActivity extends BridgeActivity`，启动时从 SharedPreferences 读取用户保存的服务器地址，用 `CapConfig.Builder` 设置 `serverUrl`（必要时设置 `allowNavigation` 和 `cleartext`），再初始化 Bridge；切换服务器时重建 Activity。未配置服务器时加载包内启动页（`www/index.html`，参考 `desktop/dist/index.html`）。
- `android:usesCleartextTraffic` 或 network security config 允许局域网 HTTP；`appendUserAgent: "OAMobile/<版本>"`。

### 3.4 Android 推送方案（国内无 Google 服务）

| 方案 | 原理 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A. 自建长连接 + 前台服务（推荐一期先做）** | 原生前台服务常驻，复用现有 `/rt` WebSocket 接收事件，用本地通知显示 | 零第三方、零费用；纯局域网可用；数据不出 NAS；符合 NAS“零外部依赖”的部署原则 | 常驻通知栏图标；国内 ROM 会杀后台，需引导用户开启“自启动”和“忽略电池优化”；手机连不到服务器时（离开局域网又没有外网访问）收不到 |
| B. 推送聚合 SDK（极光 JPush / 个推 / 友盟） | NAS 调用推送服务商的 REST API，SDK 接入小米、华为、荣耀、OPPO、vivo、魅族等厂商系统通道 | App 被杀也能送达，不需要常驻 | NAS 必须能访问公网；需在各厂商开放平台注册应用（部分厂商要求先在其商店上架或审核，以厂商当前政策为准）；消息摘要经过第三方，需在隐私政策里说明；极光的 Capacitor 插件是社区维护，需要评估或自封装 |
| C. 直接接各厂商推送 | 同 B，但不经聚合商 | 不依赖聚合商 | 要对接 5–6 套 SDK 和服务端接口，工作量最大 |
| D. FCM | Google 推送 | 标准方案 | 国内手机基本没有 GMS，不适用；只作为海外设备的补充 |
| E. UnifiedPush（自建 ntfy） | 开源推送协议，手机装一个 distributor App | 可自建 | 员工要多装一个 App，体验差 |

推荐路线：**一期做 A**，并在后端做成可插拔的推送驱动 `src/lib/push/`（`realtime` 驱动先实现，预留 `jpush` / `getui` 驱动）。如果实测 A 在主力机型上的送达率不能接受，或需要“App 被杀也能收到”，二期再加 B。iOS 只能走 APNs（iOS 不允许后台常驻长连接），如果以后确定做 iOS，**选 B（极光/个推同时支持 APNs）可以减少重复工作**，这一点需要负责人一起权衡。

方案 A 的技术要点：

- 前台服务类型用 `specialUse`（APK 自行分发，不受 Play 审核约束）。**不要用 `dataSync`**：面向 Android 15 的应用，`dataSync` 前台服务 24 小时内累计最多运行 6 小时。
- Android 13+ 需要运行时申请 `POST_NOTIFICATIONS`；建立通知渠道（单聊、群聊、@我、审批/系统各一个，用户可单独关闭）。
- 认证：原生层通过 `CookieManager` 读取 WebView 的会话 Cookie（httpOnly Cookie 原生侧可读），调用现有 `/api/realtime-token` 换取 `rt` 令牌。后期可改为独立的设备令牌（可单独吊销）。
- 前台时由 WebView 内的现有逻辑提醒（`maybeNotifyMessage` 改走原生本地通知），后台时由前台服务提醒，按 App 生命周期切换，避免重复提醒。
- 点击通知 → 深链到 `/messages/<id>`；“免打扰”和“@我”规则沿用 `store.ts` 现有逻辑，但改为**服务端计算**（见 M2），保证 A/B 两种驱动结果一致。

---

## 4. 分阶段开发计划（第一期）

整体目录规划：

```
mobile/                         新增：Capacitor 工程（pnpm workspace 包 oa-mobile）
  package.json  capacitor.config.ts
  www/index.html                包内启动页：输入/选择服务器、连接诊断
  android/                      cap add android 生成；含 MainActivity、前台服务、通知、下载等原生代码
src/lib/mobile-bridge.ts        新增：isMobileApp()、原生通知、角标、下载、生命周期（对标 desktop-bridge.ts）
src/lib/mobile.ts               新增：服务端识别 UA 标记 OAMobile/（对标 src/lib/desktop.ts）
src/components/mobile/*         新增：底部 Tab 栏、移动顶栏、返回按钮、底部抽屉
src/lib/push/*                  新增（M2）：推送派发与驱动
docs/mobile/*                   本文及后续构建/发布说明
```

注意：`pnpm-workspace.yaml` 加入 `mobile` 后，`Dockerfile` 第一阶段要像 `desktop/package.json` 一样补 `COPY mobile/package.json ./mobile/package.json`，否则 `pnpm install --frozen-lockfile` 会失败。`.dockerignore` 要排除 `mobile/android`。

### M0 技术验证（3–5 人日）

- 范围：最小 Capacitor 工程；运行时可配置 `serverUrl`；连接本机 `pnpm dev` 和 NAS 容器；验证登录 Cookie 持久化（杀进程重开仍保持登录）、Server Actions、`/rt` 重连补拉、`/collab` 文档只读打开、图片/文件上传（WebView 文件选择器）、文件下载；本地通知插件；前台服务保活原型，在 2–3 款国产主力机型（如小米/红米、华为/荣耀、OPPO/vivo）上测锁屏 30 分钟后的消息到达情况。
- 改动目录：`mobile/`（新建）；Web 不改。
- 后端配合：无。
- 风险：`server.url` 远程加载的插件可用性；局域网 HTTP 明文；WebView 版本过旧（Android System WebView 需较新版本以支持 React 19 和 ES2022）。
- 验收：产出 debug APK；一份测试记录，含每个验证项的通过/失败和机型；明确 Go/No-Go。No-Go 时切到原生 Kotlin WebView 壳，M1 之后的计划不变。

### M1 移动布局 + 登录 + IM（12–18 人日）

- 范围：
  - 包内启动页：输入服务器地址、`/health` 连通性检测、最近使用的服务器、切换服务器。
  - 移动外壳：`md` 以下隐藏 `AppRail`，改为底部 Tab（消息 / 通讯录 / 工作 / 我的），未读角标；安全区（刘海、手势条）适配；Android 返回键与页面返回一致。
  - 消息：`/messages` 全屏会话列表，`/messages/[id]` 全屏聊天带返回；输入框在软键盘弹出时不被遮挡（`viewport` 的 `interactiveWidget: "resizes-content"` + `visualViewport`）；@提及选择器（含 Bot）、表情、图片/文件、话题与搜索以全屏抽屉呈现；长按消息出操作菜单（替代右键/悬停）；图片预览手势；下载用原生下载器。
  - 通讯录、收件箱、个人页（退出登录、服务器信息、通知设置入口）。
  - 页面方案：CSS 断点优先（手机浏览器同样受益），只有原生相关的部分才判断 `OAMobile/` UA。
- 改动目录：`src/app/(app)/layout.tsx`、`src/app/(app)/messages/*`、`src/components/im/*`、`src/components/shell/*`、`src/app/(app)/contacts/*`、`src/app/(app)/inbox/*`、`src/app/login/*`、`src/app/layout.tsx`（viewport）、新增 `src/components/mobile/*`、`src/lib/mobile*.ts`、`mobile/`。
- 后端配合：
  - 建议：移动端会话改为 30 天或滑动续期（现在固定 7 天，过期后推送也会中断），改动在 `src/lib/auth/session.ts` / `src/proxy.ts`，需负责人确认安全策略。
  - 服务升级后，旧页面调用 Server Action 会报“找不到 Action”：App 内捕获后自动刷新页面。
- 风险：Tiptap 输入框在部分输入法（中文联想、语音输入）下的光标和合成事件问题；长列表性能（低端机）；**改布局时不能破坏桌面端和 Tauri 桌面顶栏**。
- 验收：
  - 在真机上用两个账号完成：登录 → 发起单聊 → 建群 → 群内 @Bot 触发 Webhook 并收到回复 → 发图片和文件 → 对方实时收到并显示已读。
  - App 切后台 5 分钟再回来，消息自动补齐，没有重复也没有缺失。
  - 桌面浏览器、Tauri 桌面端的界面回归无变化；`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。

### M2 后台消息推送（8–12 人日；如追加极光/个推再加 6–10 人日 + 厂商审核等待）

- 范围：
  - 服务端推送派发：在 IM 写消息路径（`src/lib/im/service.ts` 的 `appendMessage` 提交后，与 `queueEvent` 同一时机）为每个接收人计算是否推送（跳过发送者、机器人账号、免打扰但未被 @ 的会话），生成标题和摘要（单聊为对方名，群聊为“发送人：内容”，被 @ 时加前缀，卡片消息用卡片标题），通过驱动发出。审批、任务等业务通知已经以卡片消息进入机器人会话，自动覆盖。
  - `realtime` 驱动：通过现有实时通道向该用户投递 `push.notify` 事件。
  - Android 原生：前台服务（`specialUse`）维持一条 `/rt` 连接，收到 `push.notify` 且 App 不在前台时显示通知；断网重连、开机自启（`BOOT_COMPLETED`）、网络切换重连；通知渠道；点击深链；“电池优化/自启动”引导页（按厂商跳转设置）。
  - 前台提醒：`src/lib/im/desktop-notify.ts` 在 App 内改走原生本地通知。
  - 设置：我的 → 通知（总开关、渠道说明、后台保活状态）。
- 改动目录：新增 `src/lib/push/*`；`src/lib/im/service.ts`（或其调用处）；`src/lib/im/types.ts`（事件类型）；`server/realtime.ts`（区分前台服务连接，避免它把用户显示为“在线”，可用 `?client=bg` 参数）；`src/lib/im/desktop-notify.ts`；`mobile/android/*`。
- 后端配合（如做设备管理或极光/个推）：新增 `PushDevice` 表（userId、平台、驱动、设备令牌、机型、最后活跃时间、启用状态）与 `POST/DELETE /api/push/devices`。改 `prisma/schema.prisma` 后要执行 `pnpm db:push`，并用 `pnpm desktop:migration` 生成 `desktop/migrations/NNNN_*.sql`（NAS 容器和桌面一体包都靠它升级）。
- 风险：国产 ROM 杀后台导致的送达率；耗电（心跳 25–30s，需实测每小时耗电）；Android 14/15 前台服务限制；多设备（电脑 + 手机）同时在线时的重复提醒。
- 验收：
  - 主力测试机上，App 切后台并锁屏 30 分钟后，单聊、群聊 @我、审批卡片三类消息都能在 10 秒内弹出通知；点击后进入对应会话或审批。
  - 免打扰会话不提醒，但被 @ 时提醒；自己发的消息不提醒；App 在前台且停在该会话时不提醒。
  - 重启手机后（已授予自启动）无需打开 App 就能收到通知。
  - 记录每款测试机的送达率和 1 小时耗电，作为是否追加方案 B 的依据。

### M3 白板 + 审批 + 文档只读（8–12 人日）

- 范围：
  - 白板（`src/components/docs/whiteboard/whiteboard-canvas.tsx` 等）：同时跟踪多个指针，支持双指缩放和平移（单指仍按当前工具操作）；按 `pointerType === "touch"` 放大命中容差和缩放手柄；手机上默认进入“查看/平移”模式，点“编辑”再出现工具栏（底部横向滚动的工具条）；文字编辑时画布随软键盘上移；长按代替右键；图片插入调用相册/拍照。保持 1 MB 上限与 `expectedRevision` 冲突提示不变。
  - 审批：列表、详情、通过/驳回/评论、撤回（`src/app/(app)/oa/approvals/*`）；IM 审批卡片按钮在手机上可点。
  - 公告：列表 + 详情只读。
  - 文档：`/docs/[id]` 在手机上以只读模式渲染（可复用 `static-doc.tsx` 或协同编辑器只读模式），附件可预览下载。
- 改动目录：`src/components/docs/whiteboard/*`、`src/lib/docs/whiteboard/geometry.ts`（命中容差参数化）、`src/components/docs/doc-view.tsx`、`src/app/(app)/oa/approvals/*`、`src/app/(app)/oa/announcements/*`。
- 后端配合：无。
- 风险：在中低端机上，大白板（接近上限的元素数）的绘制帧率；手势与系统返回手势、浏览器缩放冲突；电脑和手机同时编辑时冲突提示要清楚。
- 验收：
  - 手机上打开电脑创建的白板，双指缩放、平移流畅（目测无明显卡顿）；手指画笔、矩形、便签、文字、移动、删除都可用，保存后电脑端刷新可见。
  - 电脑与手机同时编辑同一白板时出现冲突提示，且不丢数据。
  - 在手机上完成一次审批：推送 → 点开卡片 → 通过 → 发起人收到结果卡片。
  - 白板几何相关单元测试（`src/lib/docs/whiteboard/text-align.test.ts` 同类）补充触屏容差用例并通过。

### M4 签名、分发与升级（3–5 人日）

- 范围：
  - 生成正式签名密钥（`keytool`，v2/v3 签名），密钥和密码离线保管，**不入库**；`mobile/android` 只引用本机 `keystore.properties`（加入 `.gitignore`）。
  - Release 构建脚本（`pnpm mobile:build` → `gradlew assembleRelease`），版本号与 Web 版本一起维护。
  - 分发：NAS 上提供下载地址（例如把 APK 放进 uploads 目录，或在 `public/` 提供 `/download/android` 页面和二维码）；App 启动时检查 `/api/mobile/version`（新增，返回最新版本号和下载地址），提示更新。Web 页面的改动随 NAS 更新自动生效，**只有原生层改动才需要发新 APK**。
  - 文档：`docs/mobile/BUILD.md`（构建环境：JDK、Android SDK、Node），`docs/mobile/USER_GUIDE.md`（安装、允许未知来源、通知与电池设置）。
- 后端配合：`/api/mobile/version`（无需登录，需加入 `src/proxy.ts` 的 `PUBLIC_PATHS`）。
- 风险：部分手机安装未上架 APK 时会显示风险提示或“纯净模式”拦截；签名密钥丢失后无法覆盖升级（只能卸载重装，本地设置丢失）。
- 验收：在 3 款测试机上，从 NAS 下载页扫码安装正式签名 APK；旧版本能检测到新版本并完成覆盖升级，登录状态保留。

### 工作量汇总

| 阶段 | 人日 | 可并行 |
| --- | --- | --- |
| M0 技术验证 | 3–5 | — |
| M1 移动布局 + 登录 + IM | 12–18 | 与 M2 的原生部分可两人并行 |
| M2 后台推送（自建长连接） | 8–12 | |
| M3 白板 + 审批 + 文档只读 | 8–12 | 可与 M2 并行 |
| M4 签名、分发与升级 | 3–5 | |
| 合计 | **35–55** | 两人并行约 4–6 周 |

追加极光/个推：+6–10 人日，外加厂商平台注册和审核的等待时间（通常以周计）。

---

## 5. 后续：iOS 接入代价

- 工程：`npx cap add ios`，Web 部分完全复用；原生插件（前台服务除外）需要写 Swift 版本。估算 **8–15 人日**（不含审核）。
- 硬件和账号：需要 Mac + Xcode；Apple Developer 账号（个人/公司年费）。分发选项：App Store、TestFlight（测试）、Ad Hoc（每年最多 100 台设备）、Apple Business Manager 定制 App；企业证书申请门槛高，不建议依赖。
- 推送：**iOS 不允许后台常驻长连接，方案 A 不可用，必须用 APNs**（NAS 需能访问公网）。如果 Android 选了极光/个推，iOS 可复用同一后端驱动。
- 网络：HTTP 局域网地址需配置 ATS 例外（`NSAllowsLocalNetworking`）；对外服务强烈建议 HTTPS。
- 上架 App Store 时，远程加载网页的 App 可能因“只是网页套壳”被拒（审核指南 4.2），需要有足够的原生能力（推送、通知、文件等）；内部分发则不受影响。

---

## 6. 主要风险汇总

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Capacitor 远程加载不是官方推荐的生产用法 | 插件在远程页面不可用 | M0 先验证 `CapConfig.serverUrl` 方案；备选原生 Kotlin WebView 壳 |
| 局域网 HTTP 不是安全上下文，Android WebView 无法像桌面端那样放行 | 摄像头、麦克风、Web 剪贴板 API、Service Worker 不可用 | 一期不做通话；通知、剪贴板、下载走原生插件；外网正式使用 HTTPS |
| 国产 ROM 杀后台 | 自建推送送达率低 | 引导设置白名单；M2 实测；需要时追加极光/个推 |
| 会话 7 天过期 | 用户每周要重新登录，推送中断 | M1 调整移动端会话策略 |
| 服务端升级导致 Server Action ID 变化 | 长时间打开的页面操作失败 | 捕获错误后自动刷新；回到前台时检查版本 |
| 响应式改造影响桌面端 | 桌面回归问题 | 断点内改动、桌面回归清单、按 AGENTS.md 用隔离实例做 E2E |
| 推送内容经第三方 | 合规与隐私 | 方案 A 不出 NAS；用方案 B 时只推摘要或“你有一条新消息”，在隐私政策中说明 |
| 上架国内应用商店需要 APP 备案、软著等材料 | 拖慢上线 | 一期只做内部分发，不上架 |

---

## 7. 需要负责人拍板的问题

1. **推送服务选型**：一期只做自建长连接（零第三方，依赖手机能连到服务器、需用户设电池白名单），还是同时接极光/个推（App 被杀也能收到，但 NAS 需出公网、要注册各厂商通道、消息摘要经第三方）？如果明确要做 iOS，倾向后者。
2. **是否需要外网访问**：只在办公室局域网用，还是出差/在家也要收消息？如需外网，选 HTTPS 域名 + 反代（需公网 IP/DDNS 和证书）、内网穿透，还是 Tailscale 组网？这同时决定了外网能否收到推送、能否做音视频通话。
3. **签名与分发**：包名（建议 `com.oa.suite.mobile`）；签名密钥由谁保管、怎么备份；只在内部分发（NAS 下载页/群文件），还是要上架应用商店（需 APP 备案、软著）？
4. **移动端会话有效期**：维持 7 天，还是 30 天/滑动续期？是否需要“设备管理/远程退出”？
5. **第一期范围确认**：是否同意纳入“审批处理 + 公告只读 + 文档只读”，并把日程、我的任务、司机端、发起审批放到二期？
6. **最低 Android 版本**：建议 Android 8.0（API 26）起，需确认员工手机的最低版本，以及是否要求 Android System WebView 保持更新。
7. **音视频通话**：确认一期不做；二期是否做取决于第 2 项（需要 HTTPS）。
8. **构建环境**：Android 构建在谁的电脑上做（需要 JDK + Android SDK），是否需要 CI 自动出包。
