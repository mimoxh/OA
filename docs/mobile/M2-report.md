# OA 手机端 M2 报告：后台推送（自建长连接）

> 对应 `docs/mobile/mobile-plan.md` §M2。验证日期：2026-11-25。上一阶段见 `M1-report.md`。
> 结论：M2 范围内的功能已实现，**全部验收项在模拟器上通过**（Android 16 模拟器，标注「仅模拟器」）。按负责人决定，真机测试放到 M4 之后统一做，真机项目已整理到 `M2-device-checklist.md`。`pnpm typecheck`、`pnpm lint`、`pnpm test`（191 项）全部通过；桌面浏览器通知回归通过。

## 0. 结论速览

| 项 | 结果 |
| --- | --- |
| 负责人决定 | 全部落实（§1） |
| 后台 + 锁屏 + 强制 Doze 30 分钟后三类提醒 10 秒内到达 | **通过（仅模拟器）**，0 / 10 / 20 / 30 分钟四轮共 12 条全部到达，116–139 ms |
| 点通知进入会话 / 审批，返回到列表 | 通过（仅模拟器） |
| 免打扰（@ 除外）、本人、机器人账号、前台停在同一会话不提醒 | 通过（单元测试 + 模拟器） |
| 模拟器重启不打开 App 仍能收到提醒 | **通过（仅模拟器）**：开机后后台服务由 `BOOT_COMPLETED` 拉起，三类提醒 0.4–0.9 s 到达 |
| 后台连接不显示在线 | 通过（仅模拟器） |
| 桌面浏览器通知 | 通过（无头 Chrome），网页连接收不到 `push.*` |
| 1 小时耗电 / 唤醒基线 | 已采集：App 1 小时 CPU 0.5 s、无自有唤醒锁和闹钟、网络约 54 KB（仅模拟器，不能代替真机耗电） |
| Schema | **未改**（§3） |
| 电脑在用时手机静默、电脑关闭后手机提醒 | 通过（无头 Chrome + 模拟器） |
| debug APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk`（4,771,181 字节，SHA-256 `17D5E7B0…5919810E0`，未入库；模拟器上安装的就是这个包） |
| 截图 | `docs/mobile/m2-screenshots/`（§5.4） |

## 1. 负责人决定的落实情况

| # | 决定 | 做法 |
| --- | --- | --- |
| 1 | 只做自建长连接驱动，推送层可插拔 | `src/lib/push/`：规则 `rules.ts`、派发 `dispatch.ts`、驱动 `drivers/`（`realtime` 已实现；`jpush`、`getui` 是只打一次警告的桩，注释写明接入要做的事）。`PUSH_DRIVERS` 环境变量选择驱动，默认 `realtime`，可逗号分隔同时启用多个 |
| 2 | 只用模拟器，真机放到 M4 之后 | 本报告所有结果都来自模拟器 `oa_m0_api36`；真机项目见 `M2-device-checklist.md`，`M0-device-checklist.md` 加了指向它的说明 |
| 3 | 移动端 30 天滑动会话、支持局域网 HTTP、公网 CA HTTPS | 沿用 M1。后台服务用 WebView 的会话 Cookie 换 rt 令牌，30 天续期对后台连接同样有效；本次验证全程用局域网 HTTP（`http://10.0.2.2:3320`） |

## 2. 实现

### 2.1 服务端

- **规则**（`src/lib/push/rules.ts`，纯函数）：每条新消息对每个成员算一次。不提醒：发送者本人、机器人账号、已停用账号、系统消息、已撤回消息；免打扰会话只在 @我 / @所有人 时提醒。渠道：单聊 `dm`（标题为对方姓名）、群聊 `group`（标题为群名，正文「发送人：内容」）、被 @ `mention`（正文前加「[有人@我] 」）、机器人会话 `system`（审批助手等，标题为机器人名，正文为卡片标题）。
- **派发**：`im/service.ts` 写消息后调用 `queueMessagePush`，与 `queueEvent` 同一时机进入请求缓冲区，事务提交后才投递（回滚的消息不会推送）。标记已读、本人在会话里发言时调用 `queuePushClear`，让本人所有设备撤掉该会话的通知。不在缓冲区里（种子脚本）的写入不推送。
- **realtime 驱动**：把提醒转换成 `push.notify` / `push.clear` 事件，并入同一批实时事件一起投递（一次 `/publish` 或同一轮 Redis 发布），不额外发请求。
- **实时服务**（`server/realtime.ts`，过滤逻辑在 `src/lib/push/realtime-filter.ts`）：连接按 `?client=` 分三类：`web`（浏览器 / 桌面端，默认）、`app`（App 内页面）、`bg`（App 后台服务）。`push.*` 只发给 `app` 和 `bg`；`bg` 只收 `push.*`，不计入在线状态（`presence`、`/health` 的 `users`），连上后收到 `push.hello`（原生层据此区分新旧服务端）。`/health` 增加 `bgConnections`。
- **电脑在用时手机静默**：`web` 连接在页面可见、有焦点且 2 分钟内有键鼠输入时上报 `activity: true`（持续活跃时每分钟刷新），不再满足时上报 `false`；服务端以最近一次 `true` 起 3 分钟为有效期（关闭页面即失效）。有效期内 `push.notify` 带 `silent: true` 下发，手机只推进补拉游标、不弹通知。
- **断线补拉**：`GET /api/push/missed?since=<毫秒>`（`src/lib/push/missed.ts`）返回 `since` 之后、仍未读、按规则需要提醒的消息，每个会话一条并带未读条数；同时返回服务端当前时间作为下次游标。

### 2.2 Android

- `RtService`：前台服务（`specialUse`）常驻一条 `/rt?client=bg` 连接。用 `CookieManager` 读 WebView 的会话 Cookie 调 `/api/realtime-token` 换令牌；连接建立后补拉；指数退避重连；默认网络切换（Wi-Fi ⇄ 移动数据）时立即重连；OkHttp 每 25 秒 ping。对旧服务端（没有 `push.hello`）退回 M0 的做法，把 `message.new` 当提醒。
- `Notifier`：渠道「单聊消息」`oa_dm`、「群聊消息」`oa_group`、「@我」`oa_mention`（高优先级）、「审批与系统通知」`oa_system`、「后台连接」`oa_keepalive`（常驻通知，低优先级）；删除 M0/M1 的单一渠道。同一会话只占一条通知，最近几条按行展示；点击带 `oa_path` 深链进入会话。
- `BootReceiver`：`BOOT_COMPLETED`、`MY_PACKAGE_REPLACED` 后按设置启动后台服务，不需要打开 App。
- `OAShellPlugin`：页面读写通知总开关、后台保活开关、渠道状态，跳转系统渠道设置、电池优化、应用详情和各厂商自启动页。
- `MainActivity`：记录前后台状态（`AppState`，供后台服务判断由谁提醒）；点通知打开会话时立即撤掉该会话的通知（页面标记已读后服务端还会再发 `push.clear`）。

### 2.3 Web

- IM store：App 内由服务端的 `push.notify` 决定是否提醒（与后台服务内容一致），页面可见且不在该会话时调用原生通知；`push.clear` 撤销通知。浏览器和桌面端仍走原来的 `message.new` → 浏览器通知，逻辑未变。
- 实时连接：App 内带 `client=app`；页面切到后台 60 秒后断开自己的连接（只留后台服务的连接，否则别人会看到你一直在线），回到前台立即重连；通话进行中或有来电时不断开（`setRealtimeParkGuard`）。电脑端上报 `activity`。
- 设置页：「我的 → 通知」（`/me/notifications`）：总开关、四个类别（点开进入系统渠道设置）、后台保活开关与连接状态、忽略电池优化、提醒规则说明；「后台保活设置引导」（`/me/notifications/guide`）按品牌（小米、华为、荣耀、OPPO / 一加、vivo、三星、魅族、其他）给出步骤和跳转按钮。

## 3. Schema 决定：不改

realtime 驱动不需要新表：

- 投递按 `userId` 找该用户当前的 `app` / `bg` 连接，不需要设备令牌。
- 免打扰用现有 `ConversationMember.muted`，已读用 `lastReadSeq`，补拉直接查 `Message`（`createdAt > since`、`seq > lastReadSeq`），游标由手机自己保存。
- 类别开关用 Android 通知渠道，本来就是每台设备各自的设置，不需要同步到服务端。

接入极光 / 个推时再新增 `PushDevice`（`userId`、`provider`、`registrationId`、`platform`、`lastSeenAt`）和 `POST/DELETE /api/push/devices`，见 `drivers/jpush.ts` 注释。届时是加表，不影响现有数据。

## 4. 去重策略

同一条消息可能经过三条路径到达手机（App 内页面、后台服务、补拉），以及电脑浏览器。规则如下，保证每条消息最多一个系统通知：

1. **服务端只算一次**：每个（接收人, 消息）只产生一个 `push.notify`，内容由服务端统一生成，App 内与后台服务显示相同的标题和正文。
2. **前台 / 后台分工**：App 在前台时由页面提醒（页面知道当前停在哪个会话，停在该会话就不提醒）；后台服务看到 App 在前台时只记录 seq、不提醒。App 在后台时页面要么不可见（不提醒），要么已断开连接（60 秒后），只由后台服务提醒。
3. **seq 去重**：后台服务按会话记录已提醒的最大 seq，补拉结果与实时推送重叠时跳过 seq 不更大的那条（补拉在连接建立之后才发出，所以不会漏，只会重叠）。
4. **按会话合并**：通知按会话 ID 作为 tag，一个会话始终只占一条通知，新消息更新这一条。
5. **读了就撤**：在任一设备上读了或回复了某会话，服务端给本人发 `push.clear`，手机撤掉该会话的通知；打开 App 进入会话时本地也会撤。
6. **电脑在用时静默**：电脑页面在前台且最近有操作时手机不响（`silent`），由电脑弹浏览器通知；电脑不在用时两边都提醒。
7. **浏览器不受影响**：`push.*` 不发给 `web` 连接，浏览器 / Tauri 只按原有逻辑弹通知。

## 5. 验证（仅模拟器）

### 5.1 环境

| 项 | 说明 |
| --- | --- |
| 设备 | 模拟器 `oa_m0_api36`：Android 16（API 36），无头运行，WebView 133，未加电池优化白名单 |
| 服务端 | 生产包：`node scripts/docker/bundle-server.mjs --out .tmp/m2-standalone`（与 Dockerfile 同一打包步骤），`oa-standalone.mjs` 单端口 :3320，数据目录 `.tmp/m2-data`（复制自 M1 测试数据），`SESSION_COOKIE_SECURE=false`。App 访问 `http://10.0.2.2:3320`（局域网 HTTP），登录 `admin@demo.com`（张伟） |
| 发消息 | `.tmp/m2-send.ts`：在服务端进程外直接调用与 Server Action 相同的写路径（`withRealtimeBuffer` → `sendTextMessage` / `notify` → 推送派发 → `/publish`），以发出时刻计时；到达时间用 `dumpsys notification` 每 200 ms 轮询，所以延迟包含最多 200 ms 轮询误差和 adb 开销 |
| 电脑端 | 本机无头 Chrome（独立用户目录），通过 CDP 授予通知权限并记录 `Notification` 调用 |

> 开发实例（`next dev`）下 Turbopack HMR 会反复重载页面，导致在线状态来回跳，所以全部改用生产包验证。

### 5.2 验收项

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 后台（亮屏）单聊 | 通过 | 142 ms，渠道 `oa_dm`，标题「李娜」 |
| 后台群聊普通消息 | 通过 | 150 ms，`oa_group`，正文「李娜：…」 |
| 后台群聊 @我 | 通过 | 155 ms，`oa_mention`，正文「[有人@我] 李娜：@张伟 …」 |
| 后台审批卡片 | 通过 | 134 ms，`oa_system`，标题「审批助手」 |
| **锁屏 + 强制 Doze 30 分钟后**单聊 / 群 @我 / 审批 | **通过** | 未加电池优化白名单；`dumpsys battery unplug` → 熄屏 → `deviceidle force-idle`，每轮前后 `deviceidle get deep` 都是 `IDLE`、屏幕 `Asleep`。第 0 / 10 / 20 / 30 分钟各发一轮：第 30 分钟单聊 116 ms、群 @我 126 ms、审批 119 ms；四轮 12 条全部到达，最慢 139 ms，渠道分别为 `oa_dm` / `oa_mention` / `oa_system`。原始记录 `.tmp/m2-doze.log` |
| 点通知进入对应页面，返回到列表 | 通过 | 单聊、审批、@我 三种通知点击后约 2.9 s 打开对应会话（审批进入审批助手会话），返回键回到 `/messages`，该会话通知已撤销。截图 `tap-*-opened.png` / `tap-*-back.png` |
| 免打扰群普通消息不提醒，@我 提醒 | 通过 | 普通消息 8 s 内无通知；@我 139 ms 到达（`oa_mention`） |
| 自己发的消息不提醒 | 通过 | 8 s 内无通知；单元测试 |
| 机器人账号不被提醒 | 通过（单元测试） | `tests/push/push-flow.test.ts`「群聊：…机器人账号不提醒」、「机器人账号发消息照常提醒真人，机器人自身不收」；`push-rules.test.ts` |
| 前台停在同一会话不提醒 | 通过 | App 停在与李娜的会话，对方发消息 8 s 内无通知；停在会话列表时 130 ms 弹出 |
| 模拟器重启后不打开 App 也能收到 | **通过** | `adb reboot` 后不打开 App：53 s 开机完成（`sys.boot_completed=1`）；系统约 39 s 后才投递开机广播，`RtService` 以 `BOOT_COMPLETED` 豁免启动前台服务（logcat `Background started FGS: Allowed … code:BOOT_COMPLETED`）；重启后 107 s `bgConnections=1`、`users=0`，App 没有任何 Activity。随后单聊 938 ms、群 @我 386 ms、审批 757 ms 到达（开机后系统仍繁忙，比平时慢）。截图 `shade-after-reboot.png` |
| 后台连接不显示在线 | 通过 | 前台时 `/health` `users=1`；退到后台约 60 s 后 `users=0`、`bgConnections=1`；回到前台 `users=1` |
| 电脑在用时手机静默 | 通过 | 无头 Chrome 以张伟登录（页面可见、有焦点、刚有键盘输入），李娜发单聊：电脑弹出浏览器通知，手机 8 s 内没有通知；关掉电脑页面后再发，手机 259 ms 弹出 |
| 规则单元测试 | 通过 | `tests/push/push-rules.test.ts`、`realtime-filter.test.ts`、`push-flow.test.ts`（独立库 `prisma/push-test.db`，已加入 `.gitignore`） |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 通过 | 191 项测试全部通过 |
| 桌面浏览器通知不回归 | 通过 | 无头 Chrome 以王芳登录停在 `/messages`，赵磊发来单聊 46 ms 后弹出浏览器通知（标题「赵磊」）；该页面收到 `message.new`，没有收到任何 `push.*` 事件；页面上报了 `activity` |
| Tauri 桌面端 | 未单独运行 | Tauri 走 `web` 连接与原有 `message.new` 通知路径，代码只在 `isMobileApp()` 时分流；改动对它的影响与浏览器相同 |
| 1 小时耗电 / 唤醒基线 | 已采集（仅模拟器） | §5.3 |

### 5.3 1 小时耗电 / 唤醒基线（仅模拟器）

条件：与 Doze 测试同一次运行，`batterystats --reset` 后不充电、熄屏、强制 Doze 60 分钟，期间前 30 分钟共收到 12 条提醒，未加白名单。数据来自 `dumpsys batterystats com.oa.suite.mobile`（`.tmp/m2-batterystats.txt`）和 `dumpsys alarm`。

| 指标（App，UID u0a216） | 1 小时 |
| --- | --- |
| 前台服务运行时间 | 1h 0m 10s（全程） |
| CPU 时间 | 0.50 s（用户态 253 ms + 内核态 250 ms；主进程 460 ms，WebView 沙箱进程 110 ms） |
| 唤醒锁 | 只有系统发通知时代持的 `NotificationManagerService:post`，12 次共 1.4 s（对应 12 条提醒）；App 自身没有唤醒锁 |
| 唤醒闹钟 | 0（`dumpsys alarm` 中没有本 App 的闹钟） |
| 网络 | 接收 27.5 KB / 发送 26.3 KB（560 / 564 个包），主要是双向心跳：服务端每 30 s ping、客户端每 25 s ping，约 9 个包 / 分钟 |
| Wi-Fi AP 唤醒 | 112 次（约 1.9 次 / 分钟，与心跳频率一致） |
| 估算耗电 | 模拟器电池是假的（`Discharge: 0 mAh`），App 未出现在耗电估算中 |

结论：后台连接本身的 CPU 开销很小，耗电主要取决于心跳唤醒射频的次数。模拟器 CPU 不会真正休眠，也没有蜂窝射频，所以这只能作为“没有异常唤醒、没有忙等”的基线，真实耗电要按 `M2-device-checklist.md` §5 在真机上测。

### 5.4 截图

`docs/mobile/m2-screenshots/`（模拟器）：

- `shade-three-types.png`：通知栏中的单聊、群聊 @我、审批三类通知
- `notification-settings.png`：「我的 → 通知」设置页
- `notification-guide.png`：后台保活设置引导页
- `tap-dm-opened.png` / `tap-dm-back.png`、`tap-approval-opened.png` / `tap-approval-back.png`、`tap-mention-opened.png` / `tap-mention-back.png`：点通知进入与返回列表
- `shade-after-reboot.png`：重启后未打开 App 收到的提醒（同一应用的通知被系统折叠在一组里），以及「后台连接」常驻通知

## 6. 验证中发现并修复的问题

1. **App 退到后台后一直显示在线**：后台服务的连接本来就不计入在线，但 WebView 页面自己的连接在后台不会断开（系统不冻结有前台服务的进程），所以用户仍显示在线。修复：App 内页面切到后台 60 秒后主动断开连接，回到前台立即重连；通话中或有来电时保持连接（`src/components/realtime/provider.tsx`、`src/components/call/store.ts`）。
2. **开发实例下在线状态来回跳**：Turbopack HMR 重载导致，生产包无此问题，不需要修改；验证改用生产包。

## 7. 遗留与需要负责人决定的事

- **真机未测**（按决定放到 M4 之后）：国产 ROM 的后台限制、真实 Doze（模拟器 CPU 不会真正休眠，网络在 Doze 中也不会像真机那样被收紧）、厂商自启动页能否跳转、真实耗电。清单见 `M2-device-checklist.md`。
- **被强杀且不允许自启动时收不到**：这是自建长连接的固有限制。真机结果不达标时，按 `PUSH_DRIVERS=realtime,jpush`（或 getui）接入厂商通道：需要申请极光 / 个推账号（付费或需实名，**需负责人决定**），并新增 `PushDevice` 表（§3）。
- **静默判断只看本实例的连接**：多实例部署（`REDIS_URL`）时，如果电脑和手机连到不同实例，电脑在用时手机仍会响。单实例（NAS 默认）不受影响；需要时可把 `activity` 同步到 Redis。
- **后台服务心跳**：OkHttp 每 25 秒 ping 一次，真机锁屏时会周期性唤醒射频。真机耗电偏高时可以把客户端 ping 放宽到 60–120 秒，只依赖服务端 30 秒心跳（需要真机数据再定）。
- Docker 容器内未实测（本机 Docker Desktop 无法启动），用的是同一打包步骤产出的 standalone 包。
- iOS 不在本期范围。

## 8. 复现

```powershell
# APK（需 JDK 21、Android SDK）
$env:JAVA_HOME = "<JDK 21>"; pnpm mobile:build:debug

# 生产包
$env:DATABASE_URL='file:./prisma/build.db'; node scripts/docker/bundle-server.mjs --out .tmp/m2-standalone
$env:OA_PORT='3320'; $env:OA_BIND='127.0.0.1'; $env:OA_DATA_DIR="$PWD/.tmp/m2-data"
$env:NODE_ENV='production'; $env:SESSION_COOKIE_SECURE='false'
node .tmp/m2-standalone/oa-standalone.mjs

# 模拟器：强制 Doze 与恢复
adb shell dumpsys battery unplug; adb shell input keyevent 223; adb shell dumpsys deviceidle force-idle
adb shell dumpsys deviceidle get deep     # IDLE
adb shell dumpsys deviceidle unforce; adb shell dumpsys battery reset

# 健康检查（看 users 与 bgConnections）
curl.exe http://127.0.0.1:<实时服务内部端口>/health   # standalone 启动日志里打印的端口
```

测试脚本（本机 `.tmp/`，未入库）：`m2-send.ts`（发消息 / 审批 / 免打扰）、`m2-rules.mjs`（规则逐条验证）、`m2-tap.mjs`（点通知与返回）、`m2-doze.mjs`（锁屏 + Doze 长时间测试与耗电采集）、`m2-desktop.mjs`（桌面浏览器回归）。
