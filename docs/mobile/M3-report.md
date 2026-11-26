# OA 手机端 M3 报告：白板触屏、审批处理、公告与文档只读

> 对应 `docs/mobile/mobile-plan.md` §M3。验证日期：2026-11-26。上一阶段见 `M2-report.md`。
> 结论：M3 范围内的功能已实现，**全部验收项在模拟器上通过**（Android 16 模拟器 `oa_m0_api36`，下文标注「仅模拟器」）。真机项目（白板帧率、手势与系统返回冲突、软键盘、相机）整理到 `M3-device-checklist.md`。`pnpm typecheck`、`pnpm lint`、`pnpm test`（200 项，含新增触屏容差 10 项）全部通过；桌面 1440×900 前后对比无布局变化。
> M3 收尾（§8）：换账号 / 退出 / 会话过期 / 切换服务器后的后台推送已修正，App 内与手机浏览器可全屏预览 PDF；验收全部在模拟器上通过。

## 0. 结论速览

| 验收项 | 结果 |
| --- | --- |
| 手机打开电脑创建的白板：双指缩放、平移 | **通过（仅模拟器）**：查看模式单指平移、双指缩放 46% → 138% → 46%、双指平移，均不改动白板（revision 不变） |
| 手指画笔、矩形、便签、文字、移动、删除，保存后电脑端可见 | **通过（仅模拟器）**：revision 4 → 13；电脑端（无头 Edge 1440×900）刷新后看到全部改动 |
| 电脑与手机同时编辑：冲突提示且不丢数据 | **通过（仅模拟器）**：另一端先保存后，手机端保存得到 409，显示冲突横幅；服务端保留另一端的修改，手机端修改作为本机草稿保留，可复制到剪贴板 |
| 推送 → 点开卡片 → 通过 → 发起人收到结果卡片 | **通过（仅模拟器）** |
| 驳回 / 评论 / 撤回 | 通过（仅模拟器）：卡片驳回（必填意见）、详情页评论 + 底部操作栏同意、申请人撤回 |
| 公告列表、详情只读 | 通过（仅模拟器） |
| 文档只读（含 IM 分享链接打开）、附件下载 | 通过（仅模拟器）：IM 里的文档卡片在 App 内打开为只读；PDF、TXT 附件经系统下载器保存到 `Download/OA/` |
| 触屏容差单元测试 | 通过：`tests/whiteboard/touch-tolerance.test.ts` 10 项 |
| typecheck / lint / test | 全部通过（test 200 / 200） |
| 桌面 1440×900 前后对比 | 无布局变化（§4.3） |
| Schema / 后端接口 | **未改** |
| debug APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk`（4,771,360 字节，SHA-256 `4C0DF498E88E6DEC46DA1C838A08525C08F0C92B9C54C85DBEC6F5EB562A3FED`，未入库；模拟器上安装的就是这个包） |
| 截图 | `docs/mobile/m3-screenshots/`（§5） |

## 1. 负责人决定的落实情况

| # | 决定 | 做法 |
| --- | --- | --- |
| 1 | 审批在手机上只处理（查看 / 同意 / 驳回 / 评论 / 撤回），不发起 | 手机布局隐藏「发起审批」「重新发起」；工作台入口文案为「查看并处理审批」。电脑端不变 |
| 2 | 公告只读 | 手机布局隐藏发布、编辑、删除、置顶等管理操作；列表与详情按手机排版 |
| 3 | 文档只读 | 手机布局下 `DocView` 强制 `canWrite = false`，有编辑权限的人看到「手机端只读」标签；任务列表勾选框在只读编辑器里不会改动内容（TipTap 只读时回退勾选） |
| 4 | 白板可查看、可编辑 | 默认查看模式，点「编辑」后才出现工具栏 |
| 5 | 只用模拟器 | 所有结果来自模拟器；真机项目见 `M3-device-checklist.md` |
| 6 | 桌面不回归，手机样式只放在 `max-md` 或 `pointer-coarse` 下 | 新样式都带 `max-md:` / `pointer-coarse:` 前缀，或只在 `useIsMobileLayout()` / `useIsMobileApp()` 为真时渲染；鼠标容差、手柄尺寸保持原值并有单元测试 |

## 2. 实现

### 2.1 白板

- **命中容差参数化**（`src/lib/docs/whiteboard/geometry.ts`）：`WHITEBOARD_POINTER_TOLERANCE` 按指针类型给出命中 / 连线吸附 / 手柄尺寸 / 手柄命中四个值（鼠标 7 / 5 / 4 / 7，与改动前一致；笔 10 / 8 / 6 / 12；手指 16 / 12 / 9 / 22），`pointerTolerance(type, scale, kind)` 按缩放换算到白板坐标，`hitsResizeHandle` 统一手柄判定。`canvas.ts` 的绘制参数新增 `handleSize`（默认 4，即 8×8，与原来相同）。
- **多指针与手势**（`whiteboard-canvas.tsx`）：用 Map 跟踪所有触点；第二根手指落下时取消单指操作，进入双指缩放 + 平移（以两指中点为锚点）；橡皮擦在手指抬起时提交。
- **手机查看 / 编辑模式**：手机布局默认查看模式，单指平移；右上角「编辑 / 完成」切换。编辑模式下工具栏移到底部，横向滚动，按钮放大到 40px。
- **长按代替右键**：手指按住 500 ms 且未移动，弹出底部操作面板（打开文档 / 编辑文字 / 复制 / 删除，按元素类型显示）。
- **软键盘**：文字编辑框根据 `visualViewport` 上移，保证在键盘上方可见。
- **图片**：手机上点「上传图片」弹出「从相册选择 / 拍照」，拍照用 `<input capture="environment">`。`AndroidManifest.xml` 增加 `IMAGE_CAPTURE` 的 `<queries>`（Android 11+ 包可见性需要），**没有申请 CAMERA 权限**（由系统相机拍照，App 只拿结果）。白板数据 1 MB 上限、图片 10 MB 上限沿用原逻辑。
- **冲突提示**（`whiteboard-workspace.tsx`）：`expectedRevision` 机制不变。手机上冲突时显示醒目横幅：「版本冲突：白板已被其他人更新」，按钮「复制草稿」（App 内 WebView 不支持 blob 下载，改为经原生 `copyText` 复制 JSON；浏览器里仍是「下载草稿」）和「载入最新版本」。
- 其他：App 内隐藏 PNG 导出（WebView 不能下载 blob）；页面卡片在手机上用路由打开；手机布局下白板高度按屏幕计算。

### 2.2 审批

- 列表（`oa/approvals/page.tsx`）：手机布局用卡片列表（`data-mobile-approval-list`）代替表格，标签页可横向滚动。
- 详情：手机上「等待你审批」操作栏固定在屏幕底部（`DecisionBar`）；页面末尾留出同等高度，不遮挡审批进度；**输入评论时（textarea 获得焦点）操作栏让开**，不挡住输入框和「发送」（测试中发现并修复，§3.2）。手机上评论框占位文字去掉「Ctrl + Enter 发送」。
- 撤回、评论删除按钮在触屏上放大；对话框底部按钮在手机上加高。
- IM 审批卡片的「同意 / 驳回 / 查看详情」按钮在触屏上加高到 40px（`card-view.tsx`）。

### 2.3 公告、文档、工作台、外壳

- 公告列表与详情：手机排版，管理操作隐藏。
- 文档：手机布局只读；隐藏连接状态文字、协作者头像、关系图、历史版本；封面、图标、标题缩小；表格在手机上保持至少 560px 宽，在表格容器内横向滚动（TipTap 会在 `table` 上写内联 `min-width`，所以用了 `!important`）。评论面板在手机上全宽。附件：触屏上按钮放大；App 内隐藏 PDF「预览」（WebView 不能内嵌 PDF，点预览会变成下载），统一走「下载」，由 M1 的 `OADownloadListener` 交给系统下载器。
- 工作台：手机上新增「审批」「公告」入口（显示待办数 / 未读数）；App 内显示「打开 Web 完整版」，经新增的原生方法 `OAShell.openExternal(url)`（`mobile-bridge.ts` 的 `openMobileExternal`）在系统浏览器打开，用于手机端尚未适配的功能。
- 外壳：新增 `components/shell/split-frame.tsx`，手机上模块侧栏只在模块根页面显示（如 `/oa` 显示菜单，进入子页面后只显示内容）；`ContextPanel` 带返回按钮；`ModuleShell` 与文档布局都改用它。`page.tsx` 的页头、属性行在手机上缩小间距。

### 2.4 改动文件

25 个已有文件（+650 / −158 行），新增 `src/app/(app)/work/web-full-link.tsx`、`src/components/shell/split-frame.tsx`、`tests/whiteboard/touch-tolerance.test.ts`。原生层只改了 `AndroidManifest.xml`（`<queries>`）和 `OAShellPlugin.java`（`openExternal`），所以**需要安装本次的 APK**；其余都是 Web 改动，随服务器更新生效。

## 3. 验证过程（仅模拟器）

环境：独立实例（standalone 单端口构建，`OA_DATA_DIR=.tmp/m3-data`，端口 3320），App 连接 `http://10.0.2.2:3320`。触摸操作通过 CDP `Input.dispatchTouchEvent` 发到 App 内 WebView（与真实手指走同一事件路径），系统层操作（通知栏、相机快门、原生确认框）用 `adb shell input`。电脑端用本机无头 Edge（1440×900）。账号：王芳 `ceo@`（审批人）、李娜 `sales@`（申请人）。

### 3.1 白板

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | 打开电脑端创建的白板 `M3 触屏测试白板` | 默认查看模式，无工具栏（`wb-view.png`） |
| 2 | 查看模式单指拖动、双指张开 / 捏合、双指平移 | 视图平移；缩放 46% → 138% → 46%；revision 保持 4，没有误改（`wb-pinch-in.png`） |
| 3 | 点「编辑」 | 底部出现横向滚动工具栏，按钮 40px（`wb-edit-toolbar.png`） |
| 4 | 画笔、矩形、便签（输入「手机便签」）、文字（输入「手机文字」） | 全部创建并自动保存，revision 4 → 10。软键盘弹出时 `visualViewport` 高 550，编辑框位于 391–418px，在键盘上方（`wb-note-keyboard.png`） |
| 5 | 拖动矩形；从右下角外 8px 处拖动缩放 | 移动成功；尺寸 282×239 → 386×346（鼠标容差 7px 时这里点不中，触屏容差 22px 内可以）（`wb-moved-resized.png`） |
| 6 | 在笔迹线外约 7px 处长按 | 弹出「复制 / 删除」面板，删除后笔迹消失，revision 13（`wb-longpress-sheet.png`） |
| 7 | 点「上传图片」→「拍照」 | 打开系统相机 `com.android.camera2/CaptureActivity`；拍照确认后回到 App，白板插入 120×160 的图片，revision 14（`wb-image-sheet.png`、`wb-camera-inserted.png`）。「从相册选择」走同一 `<input type=file>`，未单独拍到相册界面 |
| 8 | 电脑端刷新 | 看到手机上的便签、文字、移动缩放后的矩形和照片（`desktop-wb-after-mobile-edit.png`） |

### 3.2 并发编辑冲突

1. 手机进入编辑模式（基于 revision 15）。
2. 模拟另一端：以 revision 15 为 `expectedRevision` 提交一条新文字「电脑端并发修改」，服务端返回 200，revision 16。
3. 手机上画一个矩形 → 自动保存收到 409 → 显示冲突横幅（`wb-conflict-banner.png`）。此时服务端：revision 16、10 个元素、含「电脑端并发修改」、矩形 3 个（手机端的修改没有覆盖对方）；手机本机草稿：基于 revision 15、10 个元素、矩形 4 个（手机端的修改还在）。
4. 点「复制草稿」→ 原生 `copyText` 收到完整 JSON，提示「草稿已复制到剪贴板」。
5. 点「载入最新版本」→ WebView 原生确认框「载入最新白板会清除当前草稿。是否继续？」→ 确定 → 白板重新加载，状态「已保存」，显示另一端的修改。

说明：「载入最新版本」会丢弃本机草稿（与电脑端原有行为一致，确认框会先提示），所以横幅里写明先复制草稿留底。

### 3.3 审批

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | App 回桌面；李娜在电脑端（无头 Edge，走页面表单）提交通用审批「M3 手机审批-同意测试2」 | 通知栏出现「审批助手」通知，正文为卡片标题（`ap-approve-shade.png`） |
| 2 | 点通知 | 打开审批助手会话，看到待审批卡片（`ap-approve-opened.png`） |
| 3 | 点卡片上的「同意」（按钮高 40px） | 提示「已同意」，审批单 `APPROVED`（`ap-approve-done.png`） |
| 4 | 发起人李娜 | 审批助手收到「你的「M3 手机审批-同意测试2」已审批通过」结果卡片（切换 App 账号查看，`ap-applicant-result.png`） |
| 5 | 卡片「驳回」→ 填写意见 → 确认驳回 | 审批单 SP202611250006（李娜的请假申请）`REJECTED`，意见写入任务记录；李娜收到「已被驳回」结果卡片（`ap-reject-dialog.png`） |
| 6 | 审批列表 → 点卡片进入详情 → 评论 → 底部操作栏「同意」→「确认同意」 | 列表为卡片排版、无横向溢出（`ap-list.png`）；评论发布成功，李娜收到评论通知；审批单 `APPROVED`，操作栏消失 |
| 7 | 李娜打开自己的待审批单 → 「撤回」→ 确认 | 审批单 `WITHDRAWN`（`ap-withdraw-done.png`） |

测试中发现并已修复：详情页输入评论时，固定在底部的操作栏被软键盘顶到输入框下方，挡住「发送」按钮。修复后再测：键盘弹出时 `visualViewport` 高 550，操作栏隐藏，「发送」按钮底部在 511px，可见可点；收起键盘后操作栏恢复（`ap-comment-keyboard-fixed.png`）。另外，页面滚到底时审批进度卡片底部在 687px，操作栏顶部在 802px，不再遮挡（`ap-detail-bottom.png`）。

### 3.4 公告、文档、工作台

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | 工作台 | 显示「审批」「公告（4 条未读）」入口和「打开 Web 完整版」（`work-entries.png`） |
| 2 | 公告列表 → 详情 → 返回 | 页面宽 412px 无横向溢出；无管理按钮；返回键回到列表（`ann-list.png`、`ann-detail.png`） |
| 3 | 王芳通过「分享到会话」同一服务端写路径把文档分享给李娜，李娜在 App 里点 IM 中的文档卡片 | 在 App 内打开 `/docs/…`，显示「手机端只读」，所有 `contenteditable` 为 false，标题只读（`doc-im-shared.png`） |
| 4 | 文档里的表格 | 表格 560px，在容器内横向滚动，页面本身不横向溢出（`doc-readonly-table.png`） |
| 5 | 点 TXT、PDF 附件的「下载」 | 系统下载通知「Download complete」，文件在 `/sdcard/Download/OA/`（`doc-attachment-download.png`）；App 内不显示 PDF「预览」 |
| 6 | 未适配页面 `/crm` | 正常打开，无报错，宽 412px（`unadapted-crm.png`） |
| 7 | 点「打开 Web 完整版」 | 系统 Chrome 打开（模拟器上停在 Chrome 首次运行页，`web-full-browser.png`） |
| 8 | `/oa` 模块根页面 | 显示模块菜单和返回按钮；进入子页面后只显示内容 |

### 3.5 检查命令

- `pnpm typecheck`：通过。
- `pnpm lint`：通过（无警告）。
- `pnpm test`：200 / 200 通过（43 个套件）。新增 `tests/whiteboard/touch-tolerance.test.ts`：指针类型映射；鼠标容差保持原值；触屏容差按缩放换算；细笔迹 / 连线线外 12px 鼠标点不中、手指能点中，超出触屏容差仍点不中；图形边缘容差；距右下角 15px 鼠标不触发手柄、手指触发；默认手柄 8×8 与改动前一致，触屏手柄按 `handleSize` 放大。原有 `text-align.test.ts` 12 项继续通过。

## 4. 桌面回归

### 4.1 方法

改动前后各用无头 Edge 以王芳登录，1440×900 截取同一组页面（白板、文档、审批列表、我发起的、已结束审批、待审批详情、公告列表、公告详情、工作台），逐像素对比（RGB 差和大于 30 记为不同）。

### 4.2 结果

| 页面 | 像素差异 | 说明 |
| --- | --- | --- |
| 公告详情 | 0.04% | 时间 / 数据 |
| 公告列表 | 0.19% | 时间 / 数据 |
| 已结束审批详情 | 0.04% | 时间 / 数据 |
| 审批列表 / 我发起的 | 0.76% | 测试新增了审批数据 |
| 文档 | 1.54% | 「最后编辑于」相对时间等 |
| 工作台 | 0.87% | 待办数、未读数 |
| 待审批详情 | 2.28% | 改动前后不是同一张审批单（原来那张在测试中被驳回）；人工比对：操作栏仍在内容区内、评论占位仍带「Ctrl + Enter 发送」（`desktop-approval-detail.png`） |
| 白板 | 10.54% | 白板内容被手机测试修改；人工比对：工具栏、缩放条、布局不变 |

逐张人工查看过，所有差异都来自数据或时间，没有布局、尺寸或样式变化。

### 4.3 结论

桌面不回归。鼠标的命中容差和手柄尺寸由单元测试锁定为原值。

## 5. 截图

`docs/mobile/m3-screenshots/`（手机截图缩小到 540px 宽）：

- 白板：`wb-view`、`wb-pinch-in`、`wb-edit-toolbar`、`wb-note-keyboard`、`wb-moved-resized`、`wb-longpress-sheet`、`wb-image-sheet`、`wb-camera-inserted`、`wb-conflict-banner`
- 审批：`ap-approve-shade`、`ap-approve-opened`、`ap-approve-done`、`ap-reject-dialog`、`ap-applicant-result`、`ap-list`、`ap-detail-bottom`、`ap-comment-keyboard-fixed`、`ap-withdraw-done`
- 文档、公告、工作台：`doc-im-shared`、`doc-readonly-table`、`doc-attachment-download`、`ann-list`、`ann-detail`、`work-entries`、`web-full-browser`、`unadapted-crm`
- 桌面：`desktop-wb-after-mobile-edit`、`desktop-approval-detail`、`desktop-doc`

## 6. 遗留问题与待负责人决定

1. **（已在 M3 收尾解决，见 §8.2）（M2 遗留，本次发现）切换账号后后台连接仍是旧账号。** 测试脚本清 Cookie 后在 App 里换账号登录、不重启 App，`RtService` 仍用旧账号的 rt 令牌，新账号收不到后台推送；强制停止并重开 App 后正常。原因：`RtService` 只在建立连接时用 Cookie 换令牌。建议在登录 / 退出时由页面调用原生方法重连后台服务（改动在原生层，需要新 APK）。正常的「退出登录」流程是否同样受影响未单独验证。是否放进 M4，请负责人决定。
2. **（已在 M3 收尾解决，见 §8.3）App 内不能预览 PDF。** 只提供下载，下载后由系统应用打开。模拟器上没有验证系统 PDF 阅读器能否打开（模拟器未装）。如需 App 内预览，需要引入 PDF 渲染（如 pdf.js），工作量另估。
3. **冲突时「载入最新版本」会丢弃本机草稿。** 与电脑端一致，确认框和横幅都提示先复制草稿。是否需要自动合并（例如只合并新增元素），请负责人决定。
4. **「从相册选择」** 走系统文件选择器，模拟器上只验证了拍照路径；相册路径列入真机清单。
5. **真机项目**（白板帧率、系统返回手势与画布手势冲突、软键盘、相机、长按与系统选字冲突）见 `M3-device-checklist.md`，按负责人决定放到 M4 之后统一做。

## 7. 提交

- 分支 `mimoxh/oa-mobile-research`，M3 提交在 M2 提交 `12b76be` 之后（提交号见 `git log`）。
- 测试脚本（本机 `.tmp/`，未入库）：`m3-app.mjs`（CDP 触摸驱动）、`m3-run.mjs` + `m3-s*.mjs`（各步骤）、`m3-submit.mjs`（电脑端提交审批）、`m3-tapnotif.mjs`（点通知）、`m3-share.ts`（分享文档到会话）、`m3-shots.mjs` + `m3-diff.mjs`（桌面截图与对比）。
- M3 收尾提交在 M3 提交 `ec444ae` 之后。测试脚本（本机 `.tmp/`，未入库）：`m3b-acct.mjs`（App 内退出 / 登录 / 推送状态 / 通知栏读取）、`m3b-expire.mjs`（让会话失效）、`m3b-mkpdf.mjs`（生成测试 PDF）、`m3b-sendfile.ts`（发送文件消息）、`m3b-pdf.mjs` / `m3b-pdfdl.mjs` / `m3b-docpdf.mjs`（App 内 PDF 预览、下载、文档附件）、`m3b-mweb.mjs`（手机浏览器与电脑端）、`m3b-desklogout.mjs`（电脑端退出与附件链接）。

## 8. M3 收尾：换账号后的后台推送、App 内 PDF 预览

> 验证日期：2026-11-26。环境同 §3（独立实例端口 3320，Android 16 模拟器 `oa_m0_api36`），结果都是「仅模拟器」。解决 §6 的第 1、2 项。

### 8.1 结论速览

| 验收项 | 结果 |
| --- | --- |
| A 退出 → 登录 B：私信、群 @、审批只提醒 B，锁屏后台 | **通过（仅模拟器）**：分别给 A、B 各发私信 / 群 @ / 审批，锁屏下只出现 B 的 3 条（`m3b-01-lock-B-only`、`m3b-01-shade-B-only`） |
| 只退出不登录 | **通过（仅模拟器）**：后台服务进入 `signed_out`，通知栏里旧账号的提醒被清掉，实时服务 `bgConnections` 为 0；之后给 A 发私信 / 群 @ / 审批，锁屏下没有任何提醒 |
| 会话过期 / 401 | **通过（仅模拟器）**：篡改 `oa_session` 后换令牌得到 401，后台服务进入 `unauthorized`，弹出「OA 登录已失效」通知（`m3b-02-session-expired`）；75 秒内令牌请求次数保持不变（不再每 30 秒重试）。点通知进入登录页，重新登录后恢复 `connected` |
| 切换服务器 | **通过（仅模拟器）**：「我的 → 切换服务器」回到启动页（`m3b-03-launcher`），页面里的实时连接随即断开；连上另一个地址后旧账号的提醒被清掉，新服务器上的账号只收到自己的提醒（`m3b-04-server-switch-A-only`） |
| 原生单元测试 | 通过：`PushSessionTest` 9 / 9（`gradlew testDebugUnitTest`） |
| IM 文件消息、文档附件的 PDF 在 App 内全屏预览 | **通过（仅模拟器）**：滚动、双指缩放、双击放大 / 还原、页码、顶栏「下载」、Android 返回键关闭 |
| 审批附件 | **不适用**：审批表单字段只有 text / textarea / number / date / select / user（`ApprovalFlow.formSchema`），数据模型里没有附件，没有可预览的入口 |
| 局域网 HTTP | 通过：App 连 `http://10.0.2.2:3320`，PDF 与 pdf.js 资源同源加载，带登录 Cookie |
| 18.4 MB / 100 页不卡死，有进度 | **通过（仅模拟器）**：进度条显示百分比和字节数，约 6.3 秒出第一页；加载期间无长任务或最长 56 ms，50 ms 定时器最大间隔 94 ms |
| 加密 / 损坏文件 | 通过：分别提示「该 PDF 已加密」「无法解析该文件」，并给出「下载文件」按钮；下载保存到 `Download/OA/` |
| 手机浏览器 | 通过：无头 Edge 412×915 触屏模拟，大文件预览、损坏文件提示都正常 |
| 电脑端 | 不变：IM 文件仍是下载链接，文档附件「预览」仍在新标签页打开；1440×900 九个页面前后像素对比最大 0.01% |
| typecheck / lint / test | 全部通过（test 200 / 200） |
| Schema / 后端业务接口 | **未改**（新增只读静态资源路由 `/api/pdfjs/*`） |

### 8.2 换账号与后台推送

问题根源：`RtService` 只在建立连接时用 WebView 的 Cookie 换 rt 令牌，之后不再关心页面里的登录状态；401 时每 30 秒重试一次。

- **账号判定**抽成不依赖 Android 的 `PushSession.java`：`gate(cookie)` 给出 `SIGNED_OUT`（没有 Cookie）/ `BLOCKED`（这个 Cookie 已被拒绝或已用来退出）/ `PROCEED`；`onUnauthorized(cookie)` 记住被拒的 Cookie；`onTokenUser(userId)` 发现令牌里的账号与上次不同；`onWebSession(userId, cookie)` 处理页面报告的登录 / 退出；`forget()` 用于切换服务器。
- **账号变化时清理**（`RtService.resetIdentity`）：作废当前连接代次并关闭旧 WebSocket、清空 `shownSeq` 去重表、清掉本 App 的全部提醒、删除该服务器的补拉游标。补拉游标改为按「服务器 + 账号」分别保存（`ServerStore.getLastSync / setLastSync`），换账号后不会用旧账号的游标补拉。
- **页面通知原生层**：新增 `OAShell.setSessionUser({ userId })`。页面进入登录态时报告当前账号（`RealtimeProvider`），「我的 → 退出登录」和侧栏「退出登录」先报告 `null` 再调用 `logout()`，登录页挂载时也报告 `null`（兜底 Cookie 被其他方式清掉的情况）。「切换服务器」先断开页面实时连接再打开启动页。
- **401**：不再重试，状态 `unauthorized`；App 在后台时发一条「OA 登录已失效」通知（系统通道，点开进入 `/login`）。页面重新登录后 Cookie 变化，`gate` 自动放行。
- **切换服务器**：`MainActivity.switchTo` 清掉旧服务器的提醒与游标；`RtService` 收到新服务器地址时调用 `resetIdentity`。
- 诊断：`getPushState()` 新增 `userId`、`tokenRequests`，新状态 `signed_out`、`unauthorized`。

### 8.3 App 内 PDF 预览

**方案选择：pdf.js（`pdfjs-dist@6.5.438`，legacy 构建）在页面内渲染。** 理由：

1. Android WebView 不能内嵌显示 PDF（`<iframe>` / 新标签页都会变成下载），系统没有可调用的内置阅读器；原生方案（`PdfRenderer` 或第三方 SDK）要先把文件下载到本地、按平台各写一套，iOS 以后还要再写一遍。
2. pdf.js 在 App 的 WebView 和手机浏览器里是同一份代码，PDF 走同源请求、自动带登录 Cookie，局域网 HTTP 无需额外配置。
3. legacy 构建兼容较旧的 WebView 内核；只在打开预览时按需加载（动态 `import`），不增加其他页面的首屏体积。

实现：

- `src/components/mobile/pdf-viewer.tsx`：`PdfViewer` 全屏 Radix 对话框（Android 返回键与 Esc 关闭，沿用 `AppRuntime` 的返回键处理）。加载中显示进度条和「正在加载 32%（5.9 MB / 18.4 MB）」，下载完显示「正在解析…」。只渲染可见页前后 2 页，单页画布限制在 800 万像素以内；纵向滚动翻页，底部显示「当前页 / 总页数」和缩放倍数。双指缩放过程中只做 CSS 缩放，松手后按新倍数重排并重绘，保持手指下的内容不动；双击放大到 2.5 倍或还原，最大 4 倍。错误分类：加密、无法解析、401 / 403 / 404，均给出「下载文件」。
- 入口：IM 文件消息（`message-item.tsx`）在手机布局或 App 内对 PDF 显示「点击预览」并打开预览，其他文件仍直接下载；文档附件（`file-attachment.tsx`）的「预览」在手机布局或 App 内打开页内预览（M3 中 App 内只能下载）。电脑端两处都保持原样。
- pdf.js 运行时资源（worker、CMap、标准字体、JPX / JBIG2 解码 wasm、ICC）由新路由 `src/app/api/pdfjs/[...path]/route.ts` 从 `node_modules/pdfjs-dist` 按白名单读取。standalone 产物追踪不到这些文件，`scripts/desktop/pdfjs-assets.mjs` 在 Docker 与桌面端打包时复制进产物（205 个文件，约 4.5 MB）。

### 8.4 PDF 验收过程与数据

测试文件由 `.tmp/m3b-mkpdf.mjs` 生成，王芳在私信里发给李娜，李娜在 App 内打开（`m3b-pdf-01-im-file-bubbles`）：

| 文件 | 大小 | 结果 |
| --- | --- | --- |
| 小文件-3页.pdf（含中文 CMap 字体） | 4.5 KB | 约 1.0 秒显示「1 / 3」（`m3b-pdf-02-small`）；上滑到「3 / 3」；双指放大到 400%，文字清晰（`m3b-pdf-03-small-pinch-zoom`）；双击还原；返回键关闭预览，仍在会话页 |
| 大文件-100页.pdf（每页一张噪点图） | 18.4 MB | 两次测量 6.4 / 6.3 秒出第一页，进度 0% → 99% 连续更新（`m3b-pdf-04-large-progress`）；长任务两次分别为 0 次、6 × 56 ms，50 ms 定时器最大间隔 94 / 73 ms；跳到中间显示「51 / 100」，此时只有第 49–54 页有画布（`m3b-pdf-05-large-page51`）；双指放大（`m3b-pdf-06-large-zoom`）、双击还原、返回键关闭 |
| 加密文件.pdf（需要密码） | 3.5 KB | 约 0.9 秒显示「该 PDF 已加密」与「下载文件」（`m3b-pdf-07-encrypted`） |
| 损坏文件.pdf | 39.1 KB | 约 0.4 秒显示「无法解析该文件」与「下载文件」（`m3b-pdf-08-corrupt`）；点「下载文件」后系统下载器保存到 `Download/OA/损坏文件.pdf`（40,009 字节，与原文件一致） |
| 文档附件「M3 测试附件.pdf」 | 747.5 KB | 文档里点「预览」（`m3b-pdf-09-doc-attachment`），约 1.2 秒显示「1 / 8」（`m3b-pdf-10-doc-preview`）；返回键关闭后仍在文档页 |

手机浏览器（无头 Edge，412×915，触屏模拟，李娜登录）：大文件预览显示「1 / 100」（`m3b-pdf-11-mobile-browser`），损坏文件显示错误与下载按钮。电脑端（1440×900）IM 文件气泡仍是 `<a download>` 下载链接（`m3b-desktop-im-files`），文档附件「预览」仍是 `target=_blank` 链接（`m3b-desktop-doc`）；侧栏「退出登录」正常回到 `/login`。

说明：模拟器访问的是本机回环地址，6 秒左右的加载时间主要是 WebView 读取 18 MB 的耗时；真机走 Wi-Fi 时受带宽影响，列入真机清单。

### 8.5 桌面回归

用改动前的提交（M3 `ec444ae`）和改动后的代码分别构建 standalone，在同一份数据上用无头 Edge 以王芳登录，1440×900 截取 9 个页面逐像素对比（RGB 差和大于 30 记为不同）：IM 文件会话、群聊、消息列表、文档（含 PDF 附件）、文档列表、工作台、设置、通讯录、收件箱。8 个页面 0.00%，收件箱 0.01%（相对时间）。桌面不回归。

### 8.6 检查命令

- `pnpm typecheck`、`pnpm lint`：通过。
- `pnpm test`：200 / 200 通过。
- `gradlew testDebugUnitTest assembleDebug`：通过，`PushSessionTest` 9 / 9。
- debug APK：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`（4,774,259 字节，SHA-256 `B0DE3BF5BF69B9281DA2FAF548C715E54588DDE414104E7B0BD1578CC60B83B8`，未入库；本次改了原生层，必须用新包；模拟器上安装的就是这个包）。

### 8.7 遗留问题与待负责人决定

1. **手机浏览器的返回手势不会关闭 PDF 预览。** 在手机浏览器里按返回会离开当前页（与图片查看等其他浮层一致），需要点左上角关闭。App 内的 Android 返回键正常关闭预览。如需浏览器返回也先关闭浮层，可以统一给浮层加一层浏览历史，影响所有弹窗，建议单独评估。
2. **大文件整份下载。** pdf.js 目前等整份文件下载完再显示第一页（18 MB 在模拟器上约 6 秒）。如果局域网较慢，可以让文件接口支持 HTTP Range，pdf.js 就能先显示前几页；这需要改后端文件接口，本次没有做。
3. **后台服务的 `lastError` 保留最近一次错误**，换账号后不会清空，只用于诊断，不影响提醒。
4. 真机项目见 `M3-device-checklist.md` §6（换账号推送）、§7（PDF 预览）。
