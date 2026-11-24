mod config;
mod datadir;
mod server;
mod win;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{
    ipc::CapabilityBuilder,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

use config::{DesktopConfig, Mode};
use server::{Server, ServerInfo, Status};

const APP_TITLE: &str = "协作平台 OA";
/// WebView2 默认参数（指定 additional_browser_args 后 wry 不再自动添加）+ 来电铃声需要的自动播放
const BASE_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

struct AppState {
    config: Mutex<DesktopConfig>,
    config_path: PathBuf,
    server: Arc<Server>,
    default_data_dir: PathBuf,
    install_dir: PathBuf,
    launcher_url: Mutex<Option<Url>>,
    /// 启动页下次加载时展示的视图：auto 按配置自动进入；home / settings 由工作空间内跳转而来
    launcher_intent: Mutex<String>,
    /// 本次启动时已按「安全来源」放行的 HTTP 服务器（WebView2 参数只能在创建时指定）
    secure_origins: Vec<String>,
    granted_origins: Mutex<HashSet<String>>,
    quitting: AtomicBool,
}

impl AppState {
    fn config(&self) -> DesktopConfig {
        self.config.lock().unwrap().clone()
    }

    fn update_config(&self, f: impl FnOnce(&mut DesktopConfig)) -> Result<(), String> {
        let mut config = self.config.lock().unwrap();
        f(&mut config);
        config.save(&self.config_path)
    }
}

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// 局域网内的 HTTP 地址在浏览器看来不是安全上下文，摄像头 / 麦克风 / 剪贴板等能力不可用；
/// 桌面端对用户连接过的服务器开启 Chromium 的 unsafely-treat-insecure-origin-as-secure。
fn insecure_origin(url: &Url) -> Option<String> {
    if url.scheme() != "http" {
        return None;
    }
    match url.host_str()? {
        "localhost" | "127.0.0.1" | "[::1]" => None,
        _ => Some(url.origin().ascii_serialization()),
    }
}

fn collect_secure_origins(config: &DesktopConfig) -> Vec<String> {
    let mut origins: Vec<String> = config
        .server_url
        .iter()
        .chain(config.recent_servers.iter())
        .filter_map(|u| Url::parse(u).ok())
        .filter_map(|u| insecure_origin(&u))
        .collect();
    origins.sort();
    origins.dedup();
    origins
}

fn normalize_server_url(raw: &str) -> Result<Url, String> {
    let raw = raw.trim().trim_end_matches('/');
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("http://{raw}") };
    let url = Url::parse(&with_scheme).map_err(|_| "服务器地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("请输入 http 或 https 服务器地址".to_string());
    }
    Ok(url)
}

/// 允许工作空间页面调用桌面桥接命令与拖动窗口，然后导航过去
fn open_workspace(window: &WebviewWindow, url: Url) -> Result<(), String> {
    let state = window.state::<AppState>();
    let origin = url.origin().ascii_serialization();
    let first_time = state.granted_origins.lock().unwrap().insert(origin.clone());
    if first_time {
        window
            .app_handle()
            .add_capability(
                CapabilityBuilder::new(format!("workspace-{}", state.granted_origins.lock().unwrap().len()))
                    .local(false)
                    .window("main")
                    .remote(format!("{origin}/*"))
                    .permission("core:window:allow-start-dragging")
                    .permission("core:window:allow-internal-toggle-maximize")
                    .permission("allow-set-unread-badge")
                    .permission("allow-show-native-notification")
                    .permission("allow-focus-main-window")
                    .permission("allow-desktop-context")
                    .permission("allow-window-action")
                    .permission("allow-window-is-maximized")
                    .permission("allow-open-launcher")
                    .permission("allow-open-data-dir"),
            )
            .map_err(|e| e.to_string())?;
    }
    window.navigate(url).map_err(|e| e.to_string())
}

fn local_server_url(port: u16) -> Url {
    Url::parse(&format!("http://127.0.0.1:{port}/")).expect("本机地址格式固定")
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_launcher(app: &AppHandle, view: &str) {
    let state = app.state::<AppState>();
    *state.launcher_intent.lock().unwrap() = view.to_string();
    let url = state
        .launcher_url
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| Url::parse("http://tauri.localhost/").expect("固定地址"));
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(url);
    }
}

// ───────────────────────── 启动页命令 ─────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherState {
    mode: Option<Mode>,
    server_url: Option<String>,
    recent_servers: Vec<String>,
    port: u16,
    lan: bool,
    data_dir: String,
    default_data_dir: String,
    server: ServerInfo,
    intent: String,
    version: String,
}

#[tauri::command]
fn launcher_state(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>) -> LauncherState {
    // 窗口刚创建时 url() 还是 about:blank，只有启动页自己调用时拿到的才是真实地址
    if let Ok(url) = window.url() {
        *state.launcher_url.lock().unwrap() = Some(url);
    }
    let config = state.config();
    let intent = std::mem::replace(&mut *state.launcher_intent.lock().unwrap(), "home".into());
    LauncherState {
        mode: config.mode,
        server_url: config.server_url,
        recent_servers: config.recent_servers,
        port: config.port,
        lan: config.lan,
        data_dir: state.server.data_dir().display().to_string(),
        default_data_dir: state.default_data_dir.display().to_string(),
        server: state.server.info(),
        intent,
        version: version(&app),
    }
}

#[tauri::command]
fn server_status(state: State<'_, AppState>) -> ServerInfo {
    state.server.info()
}

/// 切换为本机服务器模式并（按需）启动服务；端口或局域网设置变化时会重启服务
#[tauri::command]
async fn start_server(app: AppHandle, port: u16, lan: bool) -> Result<(), String> {
    if port < 1024 {
        return Err("端口需在 1024–65535 之间".into());
    }
    let state = app.state::<AppState>();
    state.update_config(|c| {
        c.mode = Some(Mode::Server);
        c.port = port;
        c.lan = lan;
    })?;
    let server = Arc::clone(&state.server);
    tauri::async_runtime::spawn_blocking(move || server.start(port, lan))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn restart_server(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let config = state.config();
    let server = Arc::clone(&state.server);
    tauri::async_runtime::spawn_blocking(move || {
        server.stop();
        server.start(config.port, config.lan);
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn enter_server(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    let info = state.server.info();
    if info.status != Status::Running {
        return Err("服务尚未就绪".into());
    }
    open_workspace(&window, local_server_url(info.port))
}

/// 连接已有服务器。返回 "restart" 表示需要重启客户端，以便对该 HTTP 地址启用通话等能力。
#[tauri::command]
async fn connect_server(app: AppHandle, url: String) -> Result<String, String> {
    let url = normalize_server_url(&url)?;
    let state = app.state::<AppState>();
    let text = url.as_str().trim_end_matches('/').to_string();
    state.update_config(|c| {
        c.mode = Some(Mode::Client);
        c.server_url = Some(text.clone());
        c.remember_server(&text);
    })?;

    if state.server.info().status != Status::Stopped {
        let server = Arc::clone(&state.server);
        std::thread::spawn(move || server.stop());
    }

    if let Some(origin) = insecure_origin(&url) {
        if !state.secure_origins.contains(&origin) {
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                handle.request_restart();
            });
            return Ok("restart".into());
        }
    }
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    open_workspace(&window, url)?;
    Ok("ok".into())
}

#[tauri::command]
fn forget_server(state: State<'_, AppState>, url: String) -> Result<(), String> {
    state.update_config(|c| {
        c.recent_servers.retain(|u| u != &url);
        if c.server_url.as_deref() == Some(url.as_str()) {
            c.server_url = None;
        }
    })
}

/// 弹出文件夹选择框，返回实际将使用的位置（取消时为 null）
#[tauri::command]
async fn pick_data_dir(app: AppHandle, window: WebviewWindow) -> Result<Option<datadir::Target>, String> {
    let owner = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    let current = app.state::<AppState>().server.data_dir();
    let start = current.parent().map(|p| p.to_path_buf());
    let picked = tauri::async_runtime::spawn_blocking(move || win::pick_folder(owner, "选择数据目录", start.as_deref()))
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let state = app.state::<AppState>();
    datadir::resolve(&picked, &state.server.data_dir(), &state.install_dir).map(Some)
}

#[tauri::command]
fn default_data_target(state: State<'_, AppState>) -> Result<datadir::Target, String> {
    datadir::inspect(&state.default_data_dir, &state.server.data_dir(), &state.install_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirChange {
    data_dir: String,
    /// 原目录里有数据时才返回，用于提示用户手动清理
    old_dir: Option<String>,
    migrated: bool,
}

/// 更换数据目录：停止服务 →（可选）复制现有数据 → 保存配置 → 按原状态重启服务。失败时保持原目录不变。
#[tauri::command]
async fn change_data_dir(app: AppHandle, path: String, migrate: bool) -> Result<DataDirChange, String> {
    let target = win::simplify_path(PathBuf::from(path.trim()));
    let (current, restart) = {
        let state = app.state::<AppState>();
        let current = state.server.data_dir();
        datadir::validate(&target, &current, &state.install_dir)?;
        let restart = state.config().mode == Some(Mode::Server) && state.server.info().status != Status::Stopped;
        (current, restart)
    };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let config = state.config();
        state.server.stop();
        let current_has_data = datadir::has_data(&current);
        let migrate = migrate && !datadir::has_workspace(&target) && current_has_data;
        let outcome = if migrate {
            datadir::copy_workspace(&current, &target)
        } else {
            std::fs::create_dir_all(&target).map_err(|e| format!("无法创建 {}：{e}", target.display()))
        }
        .and_then(|_| {
            let custom = (!datadir::same_path(&target, &state.default_data_dir)).then(|| target.display().to_string());
            state.update_config(|c| c.data_dir = custom)
        });
        if outcome.is_ok() {
            state.server.set_data_dir(target.clone());
        }
        if restart {
            state.server.start(config.port, config.lan);
        }
        outcome.map(|_| DataDirChange {
            data_dir: state.server.data_dir().display().to_string(),
            old_dir: current_has_data.then(|| current.display().to_string()),
            migrated: migrate,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn allow_firewall(app: AppHandle) -> Result<(), String> {
    let port = app.state::<AppState>().config().port;
    tauri::async_runtime::spawn_blocking(move || win::add_firewall_rule(port))
        .await
        .map_err(|e| e.to_string())?
}

// ───────────────────────── 工作空间页面可用的命令 ─────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopContext {
    mode: Option<Mode>,
    server_url: Option<String>,
    server: Option<ServerInfo>,
    version: String,
}

#[tauri::command]
fn desktop_context(app: AppHandle, state: State<'_, AppState>) -> DesktopContext {
    let config = state.config();
    let is_server = config.mode == Some(Mode::Server);
    let server = is_server.then(|| state.server.info());
    DesktopContext {
        mode: config.mode,
        server_url: if is_server {
            server.as_ref().map(|s| local_server_url(s.port).as_str().trim_end_matches('/').to_string())
        } else {
            config.server_url
        },
        server,
        version: version(&app),
    }
}

#[tauri::command]
fn window_action(window: WebviewWindow, action: String) -> Result<(), String> {
    let result = match action.as_str() {
        "minimize" => window.minimize(),
        "toggle_maximize" => match window.is_maximized() {
            Ok(true) => window.unmaximize(),
            _ => window.maximize(),
        },
        // 关闭按钮只隐藏到托盘：本机服务器模式下服务需要继续为同事提供访问
        "close" => window.hide(),
        _ => return Err("未知的窗口操作".into()),
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn window_is_maximized(window: WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn open_launcher(app: AppHandle, view: String) {
    let view = if view == "settings" { "settings" } else { "home" };
    show_launcher(&app, view);
}

#[tauri::command]
fn open_data_dir(state: State<'_, AppState>, path: Option<String>) {
    // 启动页可指定打开迁移前的旧目录；工作空间页面只能打开当前目录
    let dir = path.map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(|| state.server.data_dir());
    let _ = std::fs::create_dir_all(&dir);
    win::open_in_explorer(&dir);
}

#[tauri::command]
fn set_unread_badge(app: AppHandle, window: WebviewWindow, count: u32) -> Result<(), String> {
    let tooltip = if count > 0 { format!("{APP_TITLE} ({count} 条未读)") } else { APP_TITLE.to_string() };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
    let title = if count > 0 { format!("({count}) {APP_TITLE}") } else { APP_TITLE.to_string() };
    let _ = window.set_title(&title);
    Ok(())
}

#[tauri::command]
fn show_native_notification(app: AppHandle, title: String, body: String) -> Result<bool, String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn focus_main_window(app: AppHandle) -> Result<(), String> {
    reveal_main_window(&app);
    Ok(())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "服务器与工作空间设置", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出协作平台", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &settings_item, &separator, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip(APP_TITLE)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal_main_window(app),
            "settings" => {
                show_launcher(app, "settings");
                reveal_main_window(app);
            }
            "quit" => {
                app.state::<AppState>().quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                reveal_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    tray_builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            launcher_state,
            server_status,
            start_server,
            restart_server,
            enter_server,
            connect_server,
            forget_server,
            allow_firewall,
            pick_data_dir,
            change_data_dir,
            default_data_target,
            desktop_context,
            window_action,
            window_is_maximized,
            open_launcher,
            open_data_dir,
            set_unread_badge,
            show_native_notification,
            focus_main_window
        ])
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("desktop.json");
            let mut config = DesktopConfig::load(&config_path);
            // 环境变量直连（开发调试用）
            if let Some(url) = std::env::var("OA_SERVER_URL").ok().filter(|u| !u.trim().is_empty()) {
                if let Ok(url) = normalize_server_url(&url) {
                    config.mode = Some(Mode::Client);
                    config.server_url = Some(url.as_str().trim_end_matches('/').to_string());
                }
            }
            let secure_origins = collect_secure_origins(&config);
            let default_data_dir = win::simplify_path(app.path().app_local_data_dir()?.join("workspace"));
            let data_dir = config.data_dir.as_ref().map(PathBuf::from).unwrap_or_else(|| default_data_dir.clone());
            let install_dir = win::simplify_path(app.path().resource_dir()?);
            let server = Arc::new(Server::new(install_dir.join("server"), data_dir));

            if config.mode == Some(Mode::Server) {
                let server = Arc::clone(&server);
                let (port, lan) = (config.port, config.lan);
                std::thread::spawn(move || server.start(port, lan));
            }

            let mut browser_args = BASE_BROWSER_ARGS.to_string();
            if !secure_origins.is_empty() {
                browser_args.push_str(" --unsafely-treat-insecure-origin-as-secure=");
                browser_args.push_str(&secure_origins.join(","));
            }

            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                server,
                default_data_dir,
                install_dir,
                launcher_url: Mutex::new(None),
                launcher_intent: Mutex::new("auto".into()),
                secure_origins,
                granted_origins: Mutex::new(HashSet::new()),
                quitting: AtomicBool::new(false),
            });

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(APP_TITLE)
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 640.0)
                .center()
                .decorations(false)
                .shadow(true)
                // 关闭 Tauri 的原生拖放拦截，否则 WebView2 里 HTML5 拖拽（看板、侧栏排序、文件拖入）全部失效
                .disable_drag_drop_handler()
                .additional_browser_args(&browser_args)
                .build()?;
            win::append_user_agent(&window, format!("OADesktop/{}", app.package_info().version));

            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if !window.state::<AppState>().quitting.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building OA desktop application");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // 先让服务把协同文档写入数据库再退出；壳异常退出时由作业对象兜底结束子进程
            app.state::<AppState>().server.stop();
        }
    });
}
