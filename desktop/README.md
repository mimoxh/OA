# 协作平台 OA 桌面客户端（Tauri v2）

基于 **Tauri v2 + Rust + 系统 WebView（Windows WebView2 / macOS WKWebView）** 构建的轻量化桌面客户端壳，复用主仓库的 Web 应用与实时信令能力，并补充系统级桌面体验。

## 已实现能力

- **系统托盘与常驻后台**：点击窗口关闭按钮默认隐藏至系统托盘，左键托盘图标唤醒主窗口，托盘右键菜单支持「打开主窗口」「退出协作平台」。
- **单实例防多开**：重复启动客户端时自动唤醒并聚焦已有主窗口。
- **未读计数联动**：Web 端 `src/lib/desktop-bridge.ts` 自动将 IM 未读数同步到窗口标题与托盘悬浮提示（`set_unread_badge`）。
- **原生系统通知**：收到新消息或音视频来电时优先调用系统原生通知（`show_native_notification`），来电自动拉起主窗口（`focus_main_window`）。
- **自定义服务器地址**：生产构建内置连接引导页（`dist/index.html`），也支持通过环境变量 `OA_SERVER_URL="https://oa.example.com"` 启动直连。

## 前置依赖

- Rust 工具链（`cargo` / `rustc`）
- Windows：Microsoft Edge WebView2 Runtime（Windows 10/11 默认已安装）与 Visual Studio C++ Build Tools
- 在仓库根目录安装依赖，工作区会一并安装桌面 CLI：

```powershell
pnpm install
```

## 常用命令

1. 先在仓库根目录启动 Web + Collab + Realtime 服务：

```powershell
pnpm dev
```

2. 启动桌面客户端开发模式（自动加载 `http://localhost:3000`）：

```powershell
pnpm desktop:dev
```

3. 仅校验 Rust 代码编译：

```powershell
pnpm desktop:check
```

4. 打包发行版安装包（Windows MSI / NSIS 等）：

```powershell
pnpm desktop:build
```
