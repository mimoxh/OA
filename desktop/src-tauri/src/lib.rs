use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    ipc::CapabilityBuilder,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Url, WebviewWindow, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

struct QuitState(AtomicBool);

fn select_workspace(window: &WebviewWindow, url: &str) -> Result<(), String> {
    let url = Url::parse(url.trim()).map_err(|_| "服务器地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("请输入 http 或 https 服务器地址".to_string());
    }
    let origin = url.origin().ascii_serialization();
    window
        .app_handle()
        .add_capability(
            CapabilityBuilder::new("workspace-bridge")
                .local(false)
                .window("main")
                .remote(format!("{origin}/*"))
                .permission("allow-set-unread-badge")
                .permission("allow-show-native-notification")
                .permission("allow-focus-main-window"),
        )
        .map_err(|error| error.to_string())?;
    window.navigate(url).map_err(|error| error.to_string())
}

#[tauri::command]
fn connect_server(window: WebviewWindow, url: String) -> Result<(), String> {
    select_workspace(&window, &url)
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_unread_badge(app: AppHandle, window: WebviewWindow, count: u32) -> Result<(), String> {
    let tooltip = if count > 0 {
        format!("协作平台 OA ({} 条未读)", count)
    } else {
        "协作平台 OA".to_string()
    };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
    let title = if count > 0 {
        format!("({}) 协作平台 OA", count)
    } else {
        "协作平台 OA".to_string()
    };
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitState(AtomicBool::new(false)))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            connect_server,
            set_unread_badge,
            show_native_notification,
            focus_main_window
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出协作平台", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("协作平台 OA")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => reveal_main_window(app),
                    "quit" => {
                        app.state::<QuitState>().0.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            let server_url = std::env::var("OA_SERVER_URL")
                .ok()
                .filter(|url| !url.trim().is_empty());
            if let (Some(url), Some(window)) = (server_url, app.get_webview_window("main")) {
                if let Err(error) = select_workspace(&window, &url) {
                    eprintln!("无法使用 OA_SERVER_URL，{error}");
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let quitting = window.state::<QuitState>().0.load(Ordering::SeqCst);
                    if !quitting {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OA desktop application");
}
