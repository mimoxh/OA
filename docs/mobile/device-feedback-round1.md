# 第一轮真机反馈修复（小米，11 项）

> 分支 `mimoxh/oa-mobile-research`。验证环境：Android 模拟器 `oa_mi_api37`（Android 17，1220×2712，与反馈机型同分辨率），手势导航和三键导航各跑一遍；桌面 1440×900 做前后像素对比。截图在 `docs/mobile/fb1-screenshots/`：`before/` 是修复前（测试实例 3400 上的旧包），`after/` 是修复后，文件名后缀 `-gesture` / `-3btn` 表示导航方式，`desktop/` 是桌面回归。
>
> 手机上的改动都限定在 `max-md:`（< 768px）或手机专用组件里；桌面截图除了通讯录（排序和部门计数是本次有意修改的）以外，差异只有开发环境左下角的 Next 调试图标（约 0.1% 像素）。

## 结果一览

| # | 问题 | 结果 | 主要文件 |
| --- | --- | --- | --- |
| 1 | 通讯录部门筛选无效 | 已修复，总经办只显示 1 人 | `src/lib/contacts.ts`、`contacts/page.tsx` |
| 2 | 拼音分组 + 字母索引 | 已实现 | `src/lib/pinyin.ts`、`contacts/letter-index.tsx` |
| 3 | 左上角「目录」按钮 | 手机顶栏只显示页面标题，部门筛选放在页面内 | `src/components/ui/page.tsx` |
| 4 | 聊天页底部空白、「更多」菜单立即关闭 | 已找到根因并修复，两种导航都验证通过 | `(app)/layout.tsx`、`globals.css` |
| 5 | 日历手机适配 | 新增手机版月 / 周 / 日 / 列表视图，日程弹窗全屏 | `oa/calendar/mobile-calendar.tsx` |
| 6 | 返回 = 退到上一级 | 新增统一的上级路由表，三个返回入口共用 | `src/components/mobile/route-parent.ts`、`nav-stack.ts` |
| 7 | 财务日期筛选排版 | 起止日期一行、快捷按钮一行；仓储流水同样处理 | `finance/date-range-filter.tsx`、`wms/url-filters.tsx` |
| 8 | PMS 项目列表看不到 | 已修复，手机上是项目卡片 | `pms/layout.tsx`、`split-frame.tsx`、`pms/page.tsx` |
| 9 | 项目任务手机化 | 按状态分组的任务列表 + 全屏任务详情 | `pms/mobile-task-list.tsx`、`task-drawer.tsx` |
| 10 | 项目顶栏按钮太多 | 手机顶栏 = 返回 + 标题 + 1 个主操作 + 「更多」面板；客户、商机、供应商详情同样处理 | `mobile/mobile-more.tsx`、`ui/page.tsx` |
| 11 | 常驻通知 | 新渠道 `oa_bg_status`，删除旧渠道；设置页和引导页增加说明和直达入口；关闭该渠道后消息推送不受影响 | `Notifier.java`、`notifications-client.tsx`、`guide-client.tsx` |

## 逐项说明

### 1. 通讯录部门筛选

- **根因**：选中部门时，查询条件包含了该部门及其所有下级部门的成员。总经办是根部门，所有部门都在它下面，所以选总经办时和「全部成员」完全一样，看起来像筛选没生效。左侧的部门人数也是这样累计的。
- **修复**：`contactsDeptScope()` 只返回直属成员；有下级部门时，在列表上方列出下级部门入口（带人数），点进去再看。部门人数改为直属人数。
- **验证**：模拟器上总经办显示 1 人（王芳）。单元测试覆盖直属、叶子部门、未知部门三种情况。
- 截图：`before/01-contacts-dept-gesture.png` → `after/01-contacts-dept-gesture.png`、`after/01-contacts-dept-3btn.png`

### 2. 拼音分组与字母索引

- **做法**：用 ICU 的拼音排序（`Intl.Collator("zh-CN-u-co-pinyin")`）和每个字母的起始字（阿、八、嚓……帀）确定首字母，不引入拼音库。常见多音姓氏单独处理（单 Shan、曾 Zeng、解 Xie、仇 Qiu、区 Ou 等）。先做 NFKC 归一化，全角字母也能分到对应字母；数字、符号和其他文字归到 `#`，排在最后。
- 手机上按字母分组，组标题吸顶；右侧是字母索引条，点按或按住滑动都能跳到对应分组。桌面的表格也按拼音排序，但不分组。
- 单元测试覆盖首字母、多音姓氏、全角、`#` 组排序。
- 截图：`after/01-contacts-gesture.png`、`after/02-contacts-index-tap.png`、`after/01-contacts-3btn.png`

### 3. 左上角「目录」按钮

- 代码里没有叫「目录」的按钮。根据截图判断，反馈指的是手机顶栏上的面包屑「通讯录 › 全部成员」：第一段是一个链接，看起来像按钮，点了会回到通讯录根页。
- **修复**：手机顶栏不再显示面包屑，只显示一个标题（默认取面包屑的最后一级，页面也可以用 `mobileTitle` 单独指定）。上一级统一由返回键负责（见第 6 项）。这个改动对所有使用 `TopBar` 的页面生效。部门筛选在通讯录页面内（部门标签和下级部门入口）。
- 截图：`before/01-contacts-gesture.png` → `after/01-contacts-gesture.png`

### 4. 聊天页底部空白、「更多」菜单立即关闭

两个现象来自同一个原因：状态栏留白。App 沉浸式显示，`body` 上有 `padding-top: var(--sat)`（模拟器上是 50px）。

- **底部空白的根因**：外层容器是 `min-h-screen`（100vh），再加上 body 的 50px 留白，整个文档比屏幕高 50px（修复前 `scrollHeight` 1036，视口 986）。聊天页的消息区自己滚动，手指在顶栏或输入框上滑动时，滚动的是整个文档，于是页面上移 50px，底部露出空白。下拉会把文档滚回顶部，所以空白「下拉后消失」。三键导航和手势导航都一样（视口高度都是 986，App 绘制在导航栏下方，底部由 `--sab` 留白）。
- **菜单关闭的根因**：Radix 的弹层滚动锁（react-remove-scroll-bar）打开菜单时会给 `body[data-scroll-locked]` 注入 `padding-top: 0`，整页瞬间上移 50px。菜单是在 pointerdown 时打开的，随后的 click 落在了位置变化后的页面上，WebView 把焦点移到 body，Radix 把它当成「焦点移出菜单」并关闭菜单，大约 200ms 后关闭，看起来就像一点就关。
- **修复**：
  - `(app)/layout.tsx`：手机布局的最小高度改为 `calc(100dvh - var(--sat))`，文档不再比屏幕高。
  - `globals.css`：用更高优先级的 `html body[data-scroll-locked]` 保持 `padding-top: var(--sat)`，打开菜单 / 弹窗时页面不再跳动。
  - 顺带：顶栏吸顶位置改为状态栏下方，加了一条固定的白色状态栏底色，滚动时内容不会从状态栏图标下面透出来。
- **验证**（同样的步骤：打开与李娜的会话 → 在顶部下拉 → 点「会话设置」，300ms 和 1.5s 时检查菜单）：

  | | 修复前（旧包） | 修复后 |
  | --- | --- | --- |
  | 文档高度 / 视口 | 1036 / 986（两种导航都是） | 986 / 986 |
  | 菜单 300ms 后 | 已关闭 | 打开 |
  | 菜单 1.5s 后 | 已关闭 | 打开；按返回键先关菜单，页面不动 |

- 截图：`before/04-chat-menu-gesture.png`、`before/04-chat-menu-3btn.png` → `after/04-chat-menu-gesture.png`、`after/04-chat-menu-3btn.png`；下拉后：`after/04-chat-pulled-*.png`

### 5. 日历（/oa/calendar）

- **问题**：桌面的 7 列月 / 周网格在手机宽度下每列不到 60px，日程标题逐字换行，周视图完全不可用。
- **做法**：手机上换成单独的组件 `mobile-calendar.tsx`，桌面网格保持不变（`max-md:hidden`）。
  - **月**：紧凑月历（日期 + 彩色圆点），点某天在下方显示当天日程列表。
  - **周**：一行不换行的 7 天日期条（吸顶），下面按天列出整周日程，点日期条滚到那一天。
  - **日**：单列时间轴（00:00–24:00），重叠日程分栏显示，点空白时间段新建日程。
  - **列表**：本月有日程的日期依次列出。
  - 顶部有翻页、今天和新建按钮。手机上切换视图和翻页用 `router.replace`，不产生浏览历史，返回键直接回上一级。
  - 新建 / 查看日程的弹窗在手机上全屏显示，开始 / 结束时间改成上下两行，打开时不自动弹出键盘。
- URL 新增 `view=day` / `view=list`。桌面打开这两种链接时分别按周、月网格显示，数据范围也按周、月取。
- 其他日历相关页面：项目时间线（第 9 项）在手机上改为任务列表。没有找到其他使用 7 列网格的页面。
- 截图：`before/05-calendar-month-*.png`、`before/05-calendar-week-*.png` → `after/05-calendar-{month,week,day,list}-gesture.png`、`after/05-calendar-event-gesture.png`、`after/05-calendar-*-3btn.png`
- 注意：修复前的日历截图右下角有 Next 调试提示「1 Issue」。原因是模拟器时区是 UTC、服务端是 UTC+8，导致时间文本的 hydration 不一致。这是模拟器环境的问题，之后已经把模拟器时区改为 `Asia/Shanghai`，真机不受影响。

### 6. 返回 = 退到上一级

- **问题**：之前的返回是浏览历史后退，回到的是「上一个看过的页面」。从通知进入、从别的模块跳转过来，或者页面改过查询参数之后，返回结果就不对。
- **做法**：`src/components/mobile/route-parent.ts` 是一张集中的上级路由表，Android 返回键、顶栏返回按钮和页面内返回（任务详情左上角）都调用 `navigateBack()`：
  - 会话 `/messages/:id` → 消息列表；审批详情 → 审批列表；项目任务 `?task=` → 项目（保留视图等参数）；项目 → PMS；模块下的列表页 → 工作台（如果是从模块菜单进来的，也接受回到模块菜单）；`/me/*` → 我的；其他详情、新建、编辑页 → 去掉最后一段路径。
  - 一级标签页（消息 / 通讯录 / 工作 / 我的）：App 退到后台。
  - 记录里的上一页正好是上级页面时，用 `router.back()`，保留滚动位置和筛选参数；否则（深链、跨模块进入）用 `replace` 回到默认上级，不会回到无关页面。
  - 返回键的优先级：先关闭最上层的浮层（菜单、弹窗、面板），再交给页面注册的返回处理，最后才按层级返回。
  - M1 的导航记录改为同时记录路径和查询参数。
- **验证**（模拟器，返回键）：会话（深链进入）→ `/messages`；审批详情 → `/oa/approvals?tab=mine`（保留了标签参数）→ `/work`；任务详情 → 项目 → `/pms` → `/work`；在 `/work` 再按返回 → App 退到后台（前台窗口变为桌面）；聊天页打开菜单时按返回，只关菜单、页面不变。
- 单元测试 `tests/mobile/route-parent.test.ts` 覆盖上级路由表和 `resolveBack` 的三种结果。
- 截图：`after/06-approval-detail-gesture.png`、`after/06-approval-back-gesture.png`、`after/09-task-back-gesture.png`、`after/06-project-back-gesture.png`

### 7. 财务日期筛选

- **根因**：快捷按钮、两个日期框和查询按钮都在同一个 `flex-wrap` 行里。手机宽度放不下，开始和结束日期被拆到两行。
- **修复**：手机上分两行：第一行是快捷按钮（本月 / 上月 / 本年 / 全部），第二行是「开始 至 结束 [查询]」，日期框平分宽度。桌面上用 `md:contents` 把分组拆平，排版和原来一样。
- 用到 `DateRangeFilter` 的三个页面（记账凭证、收付款记录、科目余额）同时生效。仓储的库存流水（`UrlDate` 从 / 至）也有同样的问题，已一起改成一行。
- 截图：`before/07-vouchers-*.png`、`before/07-wms-movements-*.png` → `after/07-vouchers-gesture.png`、`after/07-vouchers-3btn.png`、`after/07-payments-gesture.png`、`after/07-wms-movements-gesture.png`

### 8. PMS 项目列表

- **根因**：手机布局下，模块首页显示的是模块菜单（`SplitFrame` 在 root 页面只显示左侧面板）。PMS 的菜单只有「我的任务」，项目列表本身就在 `/pms` 上，所以被隐藏了（见 `before/08-pms-list-gesture.png`，只剩一个「我的任务」）。
- **修复**：`SplitFrame` / `ModuleShell` 新增 `mobileRootContent`，PMS 的首页在手机上直接显示内容。手机上的 `/pms`：标题「项目」，顶部有「我的任务」入口卡片，搜索框占满整行，隐藏视图切换，固定显示项目卡片。
- 截图：`before/08-pms-list-*.png` → `after/08-pms-list-gesture.png`、`after/08-pms-list-3btn.png`

### 9. 项目任务

- 手机上项目页的「看板 / 列表 / 时间线」合并为一个「任务」标签：按状态分组的任务列表（`mobile-task-list.tsx`，已完成组默认折叠），显示负责人、截止日期、优先级。点任务打开 `?task=`。
- 任务详情在手机上全屏显示（顶部留出状态栏，左上角是返回箭头，不显示遮罩和关闭按钮），可以修改状态、负责人、截止日期，也可以看和发评论。返回（箭头或返回键）回到项目，走第 6 项的同一套逻辑。
- 桌面上看板 / 列表 / 时间线不变。
- 截图：`before/09-project-tasks-*.png` → `after/09-project-tasks-gesture.png`、`after/09-task-detail-gesture.png`、`after/09-task-back-gesture.png`、`after/09-*-3btn.png`

### 10. 顶栏按钮太多

- `TopBar` 新增 `mobileActions`（1–2 个主操作）和 `mobileMore`（放进底部「更多」面板的操作）。传了其中任意一个，手机上就不显示桌面的 `actions`。「更多」面板直接复用桌面的按钮和弹窗组件：点完如果没有弹出新的对话框就自动收起；弹出了对话框则保持面板，避免对话框被一起卸载。
- 项目页：手机顶栏 = 返回 + 标题 +「任务」（新建任务）+「更多」（项目群、分享、固定、项目设置等）。
- 在模拟器上逐页测量了 50 个页面的手机顶栏宽度，超出或拥挤的还有：客户详情（5 个按钮，溢出 58px）、商机详情（4 个）、供应商详情（3 个）。这三个页面也改成了「1 个主操作 + 更多」。其余页面最多 2 个按钮，不溢出。
- 顺带修复：客户详情等页面的 `TabsNav` 在手机上被挤成逐字换行，改为横向滚动。
- 截图：`before/10-project-top-*.png`、`before/10-customer-top-*.png` → `after/10-project-top-gesture.png`、`after/10-customer-top-gesture.png`、`after/10-customer-more-gesture.png`、`after/10-customer-top-3btn.png`

### 11. 常驻通知

- **现状和根因**：前台服务的通知原来用 `oa_keepalive` 渠道。代码里虽然是 `IMPORTANCE_MIN`，但 Android 对前台服务通知会把 MIN 提升为 LOW（dumpsys 里是 `importance=2`），所以通知栏一直有一条。渠道创建后，App 不能再修改它的重要性等属性，只能换一个新渠道。
- **修复**（`Notifier.java`）：
  - 新渠道 `oa_bg_status`「后台连接状态」：`IMPORTANCE_MIN`，不显示角标，没有声音、震动和呼吸灯，锁屏 `VISIBILITY_SECRET`。说明文字写明「可以关闭；关闭后后台接收和消息提醒不受影响」。
  - 通知本身：`setSilent(true)`、`setVisibility(SECRET)`、`setShowWhen(false)`、`setLocalOnly(true)`，保留 `PRIORITY_MIN`。
  - 启动时删除旧的 `oa_keepalive` 渠道。
  - 「我的 → 通知」的后台保活分组新增「常驻状态通知」一项，显示当前是「显示」还是「已隐藏」，点击直接打开系统的该渠道设置页（`ACTION_CHANNEL_NOTIFICATION_SETTINGS`，`openMobileChannelSettings("service")`）。下方说明文字同步更新。
  - 后台保活引导新增第 5 步「隐藏常驻通知（可选）」，带状态和直达按钮。
- **验证**：
  - 正式包升级路径：模拟器上先装 0.1.2 正式包并登录（渠道 `oa_keepalive`，importance 2，`vis=PRIVATE`），再覆盖安装 0.1.4：`oa_keepalive` 已删除（`mDeleted=true`），常驻通知改用 `oa_bg_status`，`vis=SECRET`、`SILENT`。登录状态保留。
  - 关闭渠道：从「常驻状态通知」进入系统设置页，关闭「Show notifications」后，渠道 importance=0，`RtService` 仍然是前台服务（`isForeground=true`）。回到桌面，用另一个账号（李娜）发单聊，`oa_dm` 通知正常出现。
  - 系统仍会把 `oa_bg_status` 提升为 LOW（importance 2），这是 Android 的规定，App 无法绕过。所以关键是让用户能一键关闭这个渠道。
- 截图：`before/11-shade-gesture.png`、`before/11-notifications-*.png` → `after/11-notifications-gesture.png`、`after/11-channel-settings-gesture.png`、`after/11-channel-off-gesture.png`、`after/11-push-with-channel-off-gesture.png`、`after/11-guide-gesture.png`

## 只在模拟器上验证过的部分（需要真机复测）

- 小米 HyperOS 对前台服务通知的处理和原生 Android 不同。原生 Android 会把渠道提升为 LOW，HyperOS 可能折叠到「不重要通知」，也可能照常显示。关闭渠道后前台服务是否仍被 HyperOS 保活，需要在真机上确认。HyperOS 也可能限制从 App 直接跳转到单个渠道设置页（失败时会打开 App 通知设置页）。
- 小米的状态栏高度和手势条高度与模拟器不同。第 4 项的修复不依赖具体高度（都读取 `--sat` / `--sab`），但仍需要在真机上实际操作一遍。
- 模拟器的 WebView 是 145；小米系统 WebView 版本可能不同，第 4 项菜单的焦点行为需要在真机上再确认一次。
- 返回键退到后台在模拟器上验证过；小米的「返回手势」和三键返回都会走同一个回调，需要在真机上各试一次。

## 检查

- `pnpm typecheck`：通过
- `pnpm lint`：通过
- `pnpm test`：250 项全部通过（新增 `tests/mobile/route-parent.test.ts`、`tests/lib/contacts-pinyin.test.ts`，覆盖返回层级、拼音分组和部门筛选）
- 桌面 1440×900 回归：13 个页面前后像素对比，除通讯录外差异不超过 0.1%（都是开发环境的 Next 调试图标），截图在 `fb1-screenshots/desktop/`。

## 测试实例与安装包

- 测试实例 `http://192.168.124.39:3400` 已用本分支重新构建 standalone（`scripts/docker/bundle-server.mjs`，77.1 MB）并重启，`/health` 正常，数据和端口不变。
- 0.1.4 正式签名包：`.tmp/device-test/apks/0.1.4/app-release.apk`（versionCode 104，1.14 MB，v2 + v3，证书 SHA-256 `C2:E2:74:F8:…:75:0A`，与 `BUILD.md` 一致）。用 `-PoaVersionName=0.1.4` 构建，没有改根目录 `package.json`。
- 已作为**可选更新**发布到下载页（`pwsh -File .tmp\device-test\publish-0.1.4.ps1`），`/api/mobile/version` 返回 0.1.4。手机上的 0.1.2 / 0.1.3 打开 App 会提示更新，覆盖安装后登录状态保留（模拟器上验证过 0.1.2 → 0.1.4）。

## 小米复测清单

前提：手机连接 `192.168.124.39:3400`，按 App 内提示更新到 0.1.4（或从下载页安装），以 `ceo@demo.com`（王芳）登录。三键导航和手势导航各测一遍，标 ★ 的项目必须两种都测。

| # | 步骤 | 预期 |
| --- | --- | --- |
| 1 | 通讯录 → 点部门「总经办」 | 只显示王芳 1 人；上方列出下级部门入口，点进去显示该部门的人 |
| 2 | 通讯录默认列表；点右侧字母索引、按住上下滑动 | 按 A–Z 分组，组标题吸顶；索引条能跳到对应字母；没有中文名的人在 `#` 组 |
| 3 | 通讯录、审批中心、客户详情等页面的左上角 | 只有返回箭头和页面标题，没有「通讯录 › 全部成员」这样的面包屑 |
| 4 ★ | 打开与李娜的会话，在顶栏或输入框上上下滑动；再点右上角「…」 | 底部不出现空白；菜单保持打开，可以点选项；按返回键先关菜单 |
| 5 | 工作 → 日程会议：切换月 / 周 / 日 / 列表；点某天、点日程、点「+」新建 | 月视图点日期在下方显示当天日程；周视图 7 天一行不换行；日视图有时间轴；日程详情和新建都是全屏，能保存 |
| 6 ★ | 按返回键：会话 → 消息列表；审批详情 → 审批列表；任务详情 → 项目 → 项目列表 → 工作台；在一级标签页按返回 | 每次退到上一级；一级标签页按返回 App 退到后台；从通知点进会话后按返回回到消息列表 |
| 7 | 财务 → 记账凭证 / 收付款记录 / 科目余额；仓储 → 库存流水 | 「开始 至 结束 查询」在同一行，快捷按钮单独一行 |
| 8 | 工作 → 项目 | 显示项目卡片列表，顶部有「我的任务」入口 |
| 9 | 打开「协作平台 2.0 开发」→ 任务；点一个任务；改状态、发评论；按返回 | 任务按状态分组；详情全屏，可修改和评论；返回回到项目 |
| 10 ★ | 项目页、客户详情的右上角「…」 | 顶栏不溢出；「更多」面板里的操作都能用（例如编辑会打开编辑弹窗） |
| 11 | 我的 → 通知 →「常驻状态通知」→ 关闭「允许通知」→ 回到桌面，让李娜发一条单聊 | 常驻通知消失；消息通知照常弹出；回到 App，「常驻状态通知」显示「已隐藏」，连接状态仍为「已连接」 |
| 12 | 锁屏后查看通知 | 锁屏上不显示「后台连接状态」通知（如果渠道没关） |
| 13 | 桌面浏览器打开同一实例，抽查通讯录、日历、项目、凭证 | 桌面排版和之前一样 |

## 已知问题和后续

- 任务详情的评论框占位文字仍是桌面的「Ctrl + Enter 发送」，手机上用发送按钮即可，下一轮再改文案。
- 联调备注：开发环境（`next dev` 三进程、非默认端口）下，后台服务连接的是默认实时端口 1235，模拟器联调时需要额外 `adb reverse tcp:1235 tcp:<实时端口>`。测试实例是单端口网关，不涉及这个问题。
- 系统会把常驻通知渠道提升为 LOW，这是 Android 的规定。想完全不显示，只能由用户关闭该渠道（已提供入口）。
