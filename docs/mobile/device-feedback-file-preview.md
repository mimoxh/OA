# 真机反馈：文件预览扩展（FB5）

分支 `mimoxh/oa-mobile-research`。本轮把页内预览从 PDF 扩展到 Office、表格、演示文稿、文本 / 代码、图片、音视频和 ZIP。全部在浏览器本地解析：不调用在线预览服务，不加载 CDN，不依赖 LibreOffice。手机（App 与手机浏览器）全屏显示，电脑用居中大弹窗。IM 文件消息和文档附件共用同一个预览窗口（审批没有附件，见 M3 报告 §8）。

**纯 Web 改动，不需要新 APK。** 3400 实例已经换成新包，旧版 App（0.1.0 / 0.1.4）连上就能用。

## 1. 支持的格式

| 类型 | 扩展名 | 渲染方式 | 说明 |
| --- | --- | --- | --- |
| PDF | pdf | pdf.js（沿用，legacy 构建） | 行为与上一轮相同：分段加载、只渲染可见页前后 2 页、双指缩放、加密 / 损坏分类提示 |
| Word | docx | docx-preview（渲染到 Shadow DOM，再做安全清理） | 表格、合并单元格、列表、图片、样式；手机上默认适应宽度，可缩放 |
| 表格 | xlsx / xlsm / xls / ods / csv / tsv | SheetJS（xls 的代码页表按需加载） | 工作表标签、合并单元格、列宽、行号和列号固定、容器内双向滚动；CSV 自动识别 UTF-8 / GBK |
| 演示文稿 | pptx / ppsx | 自研解析（fflate 解压 + DOMParser） | 主题色、版式与母版继承、文本框、形状、组合、表格、图片；显示「第 n / N 页」和每页备注；图表 / SmartArt 显示占位 |
| Markdown | md / markdown | marked（原始 HTML 全部转义） | 提供「预览 / 源码」切换 |
| JSON | json | 格式化后显示 | 解析失败时按原文显示 |
| 文本 / 配置 / 代码 | txt log xml yaml ini conf toml ts js py java go sql sh css html 等 | 纯文本 + 行号 | 自动识别 UTF-8 / UTF-16 / GBK；可切换自动换行；只读取前 1 MB |
| 图片 | png jpg gif webp bmp ico avif svg | `<img>` + blob: 地址 | 双指缩放、拖动、双击放大；电脑上可用滚轮缩放 |
| 音视频 | mp4 m4v webm mov ogv / mp3 wav m4a aac ogg opus flac | 原生 `<video>` / `<audio>` | 服务端支持 Range（206 / 416），可以拖动进度 |
| ZIP | zip | 只读取中央目录 | 目录树、大小、加密标记；不解压任何内容 |
| 不支持 | doc ppt wps rtf rar 7z psd heic avi exe 等 | 打开预览窗口，说明原因并提供「下载」 | 未知扩展名保持原行为（直接下载） |

类型判断在 `src/lib/file-preview/kinds.ts`，先看扩展名，没有扩展名时才看 MIME。浏览器上传时给的 MIME 经常是空的或错的（例如 Windows 会把 `.ts` 报成 `video/mp2t`）。

## 2. 依赖与包体积

| 依赖 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| docx-preview | 0.4.1 | Apache-2.0 | Word 渲染 |
| jszip | 3.10.2 | MIT（双许可，选 MIT） | docx-preview 的依赖 |
| xlsx（SheetJS CE） | 0.20.3 | Apache-2.0 | 表格解析。npm 上的 0.18.5 已停更并有已知漏洞，因此按 SheetJS 官方说明从 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` 安装（lockfile 记录了 integrity） |
| marked | 17.0.6 | MIT | Markdown（以前已作为间接依赖存在） |
| fflate | 0.8.3 | MIT | 已有依赖，用于 pptx 解压 |

所有渲染器都通过 `React.lazy` / 动态 `import()` 按需加载，只有打开对应类型的文件时才下载。生产构建（`.next-docker/static`）的实测数据：

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 聊天页首屏 JS（1440×900，`performance` 统计） | 23 个，457 KB | 23 个，459 KB |
| 文档页首屏 JS | 24 个，586 KB | 24 个，588 KB |
| 全部静态 JS（原始 / gzip） | 4.10 MB / 1.31 MB | 5.43 MB / 1.78 MB |
| standalone 包 | 77.6 MB（fb4） | 80.1 MB |

按需加载的分块（原始 / gzip）：docx-preview + jszip 263 KB / 75 KB；SheetJS 469 KB / 156 KB；xls 的代码页表 435 KB / 170 KB（只在打开 .xls 时加载）；marked 49 KB / 16 KB；pptx 解析器 38 KB / 15 KB；ZIP 目录读取 9 KB / 4 KB。

注意：`xlsx` 的 tarball 来自 cdn.sheetjs.com。这只影响 `pnpm install`（Docker 构建机需要能访问该域名，或者预先缓存 pnpm store），运行时不访问任何外部地址。

## 3. 安全与大小限制

- **不访问外网**：Word、Markdown、演示文稿里的图片只允许本地生成的 `blob:` 和 `data:image/*`，外链图片不加载（Markdown 显示「[图片：…]」占位）。CSS 里的 `@import` 和外部 `url()` 会被删掉。
- **防 XSS**：docx 渲染结果放进 Shadow DOM，再删除 `script / iframe / object / embed / form / foreignObject / animate` 等元素、`on*` 事件属性、`javascript:` 链接和 `srcdoc`；外部链接加 `target=_blank rel=noopener noreferrer`（`src/lib/file-preview/safe-html.ts`）。Markdown 的原始 HTML 全部转义。文本、代码和 JSON 都作为文本节点渲染。
- **SVG**：只用 `<img src="blob:…">` 显示，脚本不执行，也不加载外部资源（样例里的 `<script>alert()</script>` 和 `javascript:` 链接都没有生效）。文档附件接口对 SVG 返回 `application/octet-stream` 加 `attachment`，所以直接打开链接也不会当页面渲染。上传的 SVG 在文档里作为附件卡片插入，不作为图片节点。
- **音视频**：IM 文件接口只对白名单里的音视频 MIME 内联返回（带 `nosniff`），其他类型仍然是 `application/octet-stream` 加 `attachment`。
- **大小上限**：超过上限时不解析，窗口里说明原因并提供下载（`PREVIEW_LIMITS`）：

  | 类型 | 上限 |
  | --- | --- |
  | Word | 20 MB |
  | xlsx / xls | 15 MB |
  | csv | 10 MB |
  | pptx | 40 MB（解压后总量超过 400 MB 时中止），最多渲染 300 页 |
  | 图片 | 30 MB |
  | SVG | 5 MB |
  | 文本 | 只读取前 1 MB（用 Range 请求） |
  | 表格 | 每个工作表最多 1000 行、100 列、40000 个单元格，超出部分提示下载 |

- **ZIP 压缩炸弹**：只用 Range 读取文件尾部和中央目录（中央目录最多读 8 MB），不解压内容；最多列出 5000 条；解压后总量大于 2 GB，或者压缩比大于 200 且总量大于 100 MB 时，标记为「可疑」。条目名里的 `..` 会被去掉。没有 UTF-8 标记的文件名按 GBK 解码。
- **加密 / 损坏**：解析前先检查文件头。docx / pptx 的外层是 OLE 容器时判定为「文件已加密」，不是 ZIP 时判定为「已损坏」。解析库抛出的错误也会显示为分类提示，并附带「下载文件」。
- **文档附件白名单扩展**（`src/lib/docs/attachment-types.ts`，上限仍是 10 MB）：
  - 新增 svg（必须是 UTF-8 且含 `<svg>`）、mp4 / mov / m4a / mp3 / wav / ogg / webm / flac / aac（签名与扩展名必须一致）、bmp。
  - 新增 OLE 容器（xls / doc / ppt / 加密 OOXML）。
  - 新增文本、配置、代码（UTF-8 或 GBK，含 NUL 的拒绝；html 按 `text/plain` 保存）。
  - 可执行文件等仍返回 415。
- **Range**：`/api/im/files/[id]`（本地存储新增 `readRange`，只读需要的那一段）和 `/api/docs/attachments/[id]` 都支持单段 Range，返回 206 / 416，并带 `Accept-Ranges`。

## 4. 交互

- **手机**：全屏显示。顶栏让出状态栏（`pt-[var(--sat)]`），内容区让出底部导航条（`mb-[var(--sab)]`）。顶栏左侧是关闭，中间是文件名和「类型 · 大小」，右侧是「下载」。PDF、图片和音视频用深色背景，打开时把系统栏图标切成浅色，关闭后恢复。
- **返回键 / Esc**：预览窗口是 Radix Dialog，Android 返回键由 AppRuntime 转成 Esc，先关闭预览，页面不跳走。
- **电脑**：居中弹窗，最大 1200×880，带遮罩，顶栏有文件名、「下载」和关闭。以前电脑上 PDF 在新标签页打开、其他文件直接下载，现在能预览的类型都在弹窗里打开；未知类型仍然直接下载。

## 5. 测试样例位置（3400 实例）

- 生成脚本：`.tmp/device-test/make-fb5-samples.py`（python-docx / openpyxl / python-pptx / Pillow，装在 `.tmp/fb5-venv`）和 `.tmp/device-test/make-fb5-xls.mjs`。音视频由 ffmpeg 生成。文件在 `.tmp/device-test/files/fb5/`。
- 注入：`prepare-data.ts` 新增 FB5 段（幂等，以「文件预览测试样例（FB5）」消息和文档标题判断是否已注入）。
- **李娜 → 王芳单聊**（`cmwxgxqrj0005c8wrk1h13fco`）：采购合同.docx（中文 + 合并单元格表格 + 图片）、销售数据.xlsx（4 个工作表，含 40 列宽表和合并标题）、旧版报表.xls、客户名单-GBK.csv、产品方案.pptx（5 页，含表格、图片和备注）、预览说明.md（含 XSS 样例）、配置.json（压缩成一行）、服务日志.log（3 MB）、示例代码.ts、部署配置.yaml、示意图.png、矢量图标.svg（含脚本和外链）、演示视频.mp4（20 秒，720p）、提示音.mp3、项目资料.zip（中文嵌套目录）、损坏文件.docx、旧版文档.doc。上一轮的 PDF 样例（小 / 大 / 加密 / 损坏）也在这个单聊里。
- **文档**「真机测试文档（多格式预览）」（`/docs/3438e563faf9f479262c2517`，已分享到上面的单聊）：上面 16 个可上传的样例加 3 页小 PDF，共 18 个附件，没有被拒绝的样例。随机字节的 docx 会被白名单拒绝，所以这里的「损坏文件.docx」是截断的 ZIP。

## 6. 截图索引（`docs/mobile/fb5-screenshots/`）

模拟器 `oa_mi_api37`（1220×2712，density 440，CSS 视口 443×986）。App 通过局域网 HTTP `http://192.168.124.39:3400` 连接，王芳登录。手势导航（sat=49，sab=24）和三键导航（sat=49，sab=48）各一套，文件名后缀分别是 `-gesture` 和 `-3btn`：

| 文件 | 内容 |
| --- | --- |
| `00-chat-*` | 单聊里的文件卡片（按类型显示图标，「点击预览」） |
| `01-docx-*` | Word |
| `02-xlsx-*`、`02-xlsx-wide-sheet-*` | xlsx 首个工作表；切到「宽表（40 列）」并横向、纵向滚动后（行号和列号固定） |
| `03-xls-*` | 旧版 xls |
| `04-csv-gbk-*` | GBK CSV（顶部提示编码） |
| `05-pptx-*`、`05-pptx-slide4-*` | 演示文稿首页；第 3–5 页（表格、图片 + 形状、备注入口） |
| `06-md-*`、`07-json-*`、`08-log-*`、`09-code-*` | Markdown / JSON / 3 MB 日志（截断提示） / 代码 |
| `10-svg-*` | SVG（脚本未执行） |
| `11-mp4-*`、`11-mp4-seek-*`、`12-mp3-*` | 视频、拖动到 12 秒后继续播放、音频 |
| `13-zip-*` | ZIP 目录树 |
| `14-corrupt-docx-*`、`15-doc-*` | 损坏文件提示、旧版 .doc 提示 |
| `16-pdf-small-*`、`17-pdf-big-*` | PDF 回归（3 页 / 100 页） |
| `20-doc-*`、`21-doc-png-*`、`22-doc-xlsx-*`、`23-doc-pdf-*` | 文档附件卡片，以及从文档里打开 PNG / xlsx / PDF |
| `emu-gesture.json`、`emu-3btn.json` | 每个预览的顶栏 / 按钮 / 内容区位置、是否压在系统栏下、返回键结果、Range 检查结果 |
| `desktop/desk-{chat,doc}-{before,after}.png` | 电脑 1440×900 回归：聊天页和文档页改动前后对比 |
| `desktop/desk-preview-*.png`、`desktop/desk-{before,after}.json` | 电脑上逐个打开所有样例的弹窗截图，以及首屏 JS 统计 |

测量结果（两种导航方式各 23 个预览）：

- 没有任何控件压在状态栏或导航栏下（`blocked=[]`）。
- 返回键 23/23 次都关闭了预览，并停在原页面。
- 横向无溢出（`scrollWidth = 443`）。
- 视频拖到 12 秒后播放到 14.6 秒，已缓冲 20 秒（1280×720）。
- WebView 里带登录 Cookie 的 Range 请求：`bytes=0-99` 返回 206，`Content-Range: bytes 0-99/4040670`，`Content-Type: video/mp4`，正文 100 字节；越界请求返回 416，`Content-Range: bytes */4040670`。

电脑 1440×900：20 个样例都在 1200×852 的弹窗里打开，并且都有「下载」；页面横向无溢出（`scrollWidth = 1440`）。聊天页和文档页布局与改动前一致，区别只有文件卡片的图标和「点击预览」文字。

真实上传接口检查（在 App 的 WebView 里调用 `POST /api/docs/attachments`）：

| 文件 | 上传结果 | 再次读取 |
| --- | --- | --- |
| svg | 200，`image/svg+xml` | `application/octet-stream`，`attachment` |
| GBK csv | 200，`text/csv; charset=gb18030` | 同左 |
| mp3 | 200，`audio/mpeg` | `inline` |
| exe | 415 | — |

## 7. 验证

- `pnpm typecheck`、`pnpm lint` 通过。
- `pnpm test` 308/308 通过。新增 `tests/file-preview/` 下 7 个文件、29 个用例：
  - 类型分发与大小上限、UTF-8 / GBK / UTF-16 / 截断解码、加密 / 损坏检测。
  - ZIP 目录：真实 zip、GBK 文件名、压缩炸弹、条目上限、路径穿越、损坏文件。
  - HTML / CSS 清理与 Markdown XSS、Range 解析与响应头、表格窗口与合并单元格。
  - 文档附件白名单，以及「手机全屏让出系统栏、渲染器按需加载、两个入口都用统一窗口」的源码检查。
- 3400 实例：
  - 新包在 `.tmp/device-test/standalone-fb5` 构建完成后才执行 `stop.ps1`，然后换目录、执行 `start.ps1`（同一数据目录、同一端口）。停机约 15 秒，旧包保留在 `standalone-pre-fb5`。
  - `http://192.168.124.39:3400/health` 返回 `{"ok":true,"services":{"next":true,"collab":true,"realtime":true}}`。

## 8. 已知限制

- docx-preview 不是排版引擎：分页、页眉页脚、文本框、复杂浮动图片和公式与 Word 有差异；字体用系统字体代替。
- pptx 是简化渲染：没有动画和切换效果，图表、SmartArt 显示占位，艺术字和部分渐变、阴影效果没有实现，字体可能与 PowerPoint 不同（页面底部有提示）。
- 表格只显示单元格的值和合并：不显示条件格式、图表、批注；公式显示缓存值（文件里没有缓存值时为空）。
- .doc / .ppt / WPS 专有格式、加密 Office、RAR / 7z 只提示下载。
- IM 里 MIME 为图片的文件仍走原来的图片消息和图片查看器；文件预览窗口里的图片预览用于文档附件，以及以文件形式发送的图片。
- `HEAD` 请求没有返回 `Content-Length`（GET 正常），不影响播放。
- 模拟器装的是 0.1.0 App，页面会弹出「发现新版本」，并且盖在预览窗口之上。这是现有的更新提示，与本轮改动无关；截图前已经点了「稍后」。

## 9. 小米真机复测清单

1. 王芳登录 App，打开与李娜的单聊，滚到底部的「文件预览测试样例（FB5）」。
2. 逐个点开文件：顶栏的关闭和「下载」不能被状态栏遮住，底部工作表标签、缩放按钮、播放控件不能被导航条遮住；手势导航和三键导航各测一次。
3. 采购合同.docx：表格合并单元格、编号和项目符号列表、图片显示正常；双指缩放或缩放按钮可用。
4. 销售数据.xlsx：可以切换 4 个工作表；「宽表（40 列）」可以横向、纵向滚动，行号和列号固定。旧版报表.xls 和客户名单-GBK.csv 中文不乱码。
5. 产品方案.pptx：显示「第 n / 5 页」，第 4 页有图片，点「备注」能看到备注。
6. 预览说明.md：`<script>` 等内容显示为文字；「危险链接」不可点。矢量图标.svg 不弹窗。
7. 服务日志.log 顶部有「只显示前 1 MB」提示。配置.json 已格式化。示例代码.ts 和部署配置.yaml 中文正常。
8. 演示视频.mp4：可以播放，拖动进度条后能从新位置继续播放。提示音.mp3 可以播放。
9. 项目资料.zip：显示目录树，可以展开和收起。损坏文件.docx 和旧版文档.doc 显示原因和「下载文件」。
10. 每个预览按返回键都应该先关闭预览，并停在聊天页；再按一次才离开聊天页。
11. 在任意预览里点「下载」，应能正常保存（走原来的 `?download=1` 下载流程）。
12. 打开文档「真机测试文档（多格式预览）」，点附件上的「预览」，结果同上。PDF（3 页 / 100 页 / 加密 / 损坏）行为与上一轮一致。
